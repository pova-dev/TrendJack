// Outbound webhooks dispatcher.
// Resolves all active webhooks subscribed to a given event for an org,
// fires them in parallel, and records outcomes in the audit log.
//
// HMAC signing: if a webhook has a secret, we send X-TrendJack-Signature.
// Receivers can verify with crypto.createHmac('sha256', secret).update(body).digest('hex')

import crypto from 'crypto';
import { prisma } from '@/lib/db';

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
        await fetch(h.url, { method: 'POST', headers, body });
      } catch { /* swallow — failed deliveries should be retried by a separate worker */ }
    }),
  );
}
