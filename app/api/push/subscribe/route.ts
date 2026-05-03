import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/push/subscribe — accept a Web Push subscription from the
// browser and stash it for later delivery.
//
// Phase-12 stub: this endpoint validates and acks the subscription
// shape but doesn't yet persist it. Persistence + delivery require:
//   1. A push_subscription table on the brand (one-to-many — one user
//      can have multiple devices).
//   2. VAPID keys in env (PUSH_VAPID_PUBLIC, PUSH_VAPID_PRIVATE).
//   3. A delivery worker that subscribes to STREAMS.alerts and uses
//      the web-push npm package to fan out to subscriptions.
//
// All three are mechanical follow-ups; the current scaffold lets the
// browser register a SW + capture a subscription so we can wire
// delivery without changing the client side.

interface PushSubscriptionShape {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}

export async function POST(req: NextRequest) {
  const auth = await getCurrentContext();
  if (!auth?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sub = (await req.json().catch(() => null)) as PushSubscriptionShape | null;
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: 'invalid_subscription' }, { status: 400 });
  }

  // TODO Phase-12: persist to push_subscription table.
  return NextResponse.json({
    ok: true,
    accepted: { endpoint: sub.endpoint.slice(0, 60) + '…' },
    note: 'Subscription captured. Persistence + VAPID delivery wiring is the next step.',
  });
}
