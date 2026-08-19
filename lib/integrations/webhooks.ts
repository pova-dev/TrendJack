// Outbound webhooks dispatcher.
// Resolves all active webhooks subscribed to a given event for an org,
// fires them in parallel, and records outcomes in the audit log.
//
// HMAC signing: if a webhook has a secret, we send X-TrendJack-Signature.
// Receivers can verify with crypto.createHmac('sha256', secret).update(body).digest('hex')

import crypto from 'crypto';
import { prisma } from '@/lib/db';

// Audit 2026-05-29 D4 — failures were swallowed entirely. Now we log
// failures + non-2xx responses to the audit log so operators can see what
// happened, and the retry worker (when it lands) has something to read.
async function logDelivery(orgId: string, target: { id: string; url: string }, event: string, status: 'ok' | 'http_error' | 'network_error', detail?: string) {
  try {
    await prisma.auditLog.create({
      data: {
        orgId,
        action: status === 'ok' ? 'webhook.delivered' : 'webhook.failed',
        target: target.id,
        meta: JSON.stringify({ url: target.url, event, status, detail: detail?.slice(0, 500) }),
      },
    });
  } catch {
    // Audit log insert failed. Last-resort console — better than silent.
    console.error('[webhooks] failed to write audit log', { orgId, target, event, status, detail });
  }
}

export async function fireWebhooks(orgId: string, event: string, payload: unknown) {
  const hooks = await prisma.webhook.findMany({ where: { orgId, active: true } });
  const targets = hooks.filter(h => {
    try { return (JSON.parse(h.events) as string[]).includes(event); }
    catch { return false; }
  });
  if (!targets.length) return;

  const body = JSON.stringify({ event, ts: new Date().toISOString(), payload });
  await Promise.allSettled(
    targets.map(async h => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (h.secret) {
        const sig = crypto.createHmac('sha256', h.secret).update(body).digest('hex');
        headers['x-trendjack-signature'] = sig;
      }
      try {
        const res = await fetch(h.url, { method: 'POST', headers, body });
        if (!res.ok) {
          await logDelivery(orgId, h, event, 'http_error', `${res.status} ${res.statusText}`);
        } else {
          // Only log successful deliveries when explicitly enabled — too
          // noisy otherwise. Failure logging is always on.
          if (process.env.TJ_WEBHOOK_LOG_SUCCESS === '1') {
            await logDelivery(orgId, h, event, 'ok', String(res.status));
          }
        }
      } catch (e) {
        await logDelivery(orgId, h, event, 'network_error', (e as Error).message);
      }
    }),
  );
}
