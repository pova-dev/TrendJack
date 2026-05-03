// Push-delivery worker.
//
// Subscribes to STREAMS.alerts and, for each AlertMessage, fans out a
// Web Push notification to every PushSubscription whose brandId matches
// the alert. The SW (public/sw.js) renders a system notification on
// receipt; clicking it opens the trend's drawer.
//
// Failure handling:
//   - 410 Gone or 404 Not Found from the push service → the subscription
//     is dead (browser revoked, user uninstalled, key rotated). Delete
//     the row immediately so we don't keep hitting it.
//   - Any other error → bump failCount; after 5 consecutive failures
//     the subscription is pruned. This keeps the table from growing
//     stale in the face of transient outages.
//
// The worker is idempotent — calling startPushDeliveryWorker() twice in
// the same Node process is a no-op via a module-level flag, so the
// dashboard layout's bootAgents() call can be re-rendered safely.

import 'server-only';
import { prisma } from './db';
import { getBus } from '@/src/core/state';
import { STREAMS } from '@/src/core/state/streams';
import { ensureVapidConfigured, webpush } from './push-vapid';

const MAX_FAIL_COUNT = 5;
let started = false;

interface AlertPayload {
  title: string;
  body: string;
  level: 'info' | 'warn' | 'critical';
  trendId?: string;
  brandId: string;
  emittedAt: number; // ms epoch
}

export function startPushDeliveryWorker(): void {
  if (started) return;
  started = true;

  if (!ensureVapidConfigured()) {
    // No keys → log once, stay idle. The /api/push/public-key endpoint
    // will report `configured: false` and the InstallPrompt will skip
    // its subscribe step accordingly.
    // eslint-disable-next-line no-console
    console.log('[push-delivery] no VAPID keys configured — worker idle');
    return;
  }

  const bus = getBus();
  bus.subscribe(STREAMS.alerts, async (msg) => {
    try {
      await deliverAlert(msg.body);
      await bus.ack(STREAMS.alerts.name, msg.id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[push-delivery] tick failed:', (err as Error).message);
    }
  }, { group: 'push-delivery' });

  // eslint-disable-next-line no-console
  console.log('[push-delivery] started — subscribed to STREAMS.alerts');
}

async function deliverAlert(alert: {
  brandId: string;
  level: 'info' | 'warn' | 'critical';
  title: string;
  body: string;
  trendId?: string;
  emittedAt: Date;
}): Promise<void> {
  const subs = await prisma.pushSubscription.findMany({
    where: { brandId: alert.brandId },
  });
  if (subs.length === 0) return;

  const payload: AlertPayload = {
    title: alert.title,
    body: alert.body,
    level: alert.level,
    trendId: alert.trendId,
    brandId: alert.brandId,
    emittedAt: alert.emittedAt.getTime(),
  };
  const payloadJson = JSON.stringify(payload);

  // Fan out in parallel. Each subscription's failure is isolated so a
  // single dead device doesn't block the rest.
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payloadJson,
          { TTL: 60 * 60 }, // 1h — alerts past this are stale
        );
        if (s.failCount > 0) {
          await prisma.pushSubscription.update({
            where: { id: s.id },
            data: { failCount: 0, lastSeenAt: new Date() },
          });
        } else {
          await prisma.pushSubscription.update({
            where: { id: s.id },
            data: { lastSeenAt: new Date() },
          });
        }
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          // Subscription is dead — prune immediately.
          await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
          return;
        }
        const next = s.failCount + 1;
        if (next >= MAX_FAIL_COUNT) {
          await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
        } else {
          await prisma.pushSubscription.update({
            where: { id: s.id },
            data: { failCount: next },
          });
        }
      }
    }),
  );
}
