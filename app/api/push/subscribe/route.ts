import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/push/subscribe — accept a Web Push subscription from the
// browser and persist it for later delivery.
//
// We upsert on `endpoint` because browsers re-issue the same endpoint
// when the user re-subscribes with the same VAPID key, so a re-install
// or a permission re-grant doesn't create a stale duplicate row.
//
// Persistence is per (brand × user × endpoint). The push-delivery
// worker (lib/push-delivery.ts) subscribes to STREAMS.alerts and fans
// out AlertMessages to all PushSubscriptions matching the alert's
// brandId.

interface PushSubscriptionShape {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}

export async function POST(req: NextRequest) {
  const auth = await getCurrentContext();
  if (!auth?.user || !auth?.brand) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sub = (await req.json().catch(() => null)) as PushSubscriptionShape | null;
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: 'invalid_subscription' }, { status: 400 });
  }

  const userAgent = req.headers.get('user-agent')?.slice(0, 200) ?? null;
  const expiresAt = sub.expirationTime ? new Date(sub.expirationTime) : null;

  // Upsert on endpoint — same device re-subscribing should refresh the
  // keys + lastSeenAt, not create a duplicate row.
  const row = await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: {
      brandId: auth.brand.id,
      userId: auth.user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent,
      expiresAt,
    },
    update: {
      brandId: auth.brand.id,
      userId: auth.user.id,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent,
      expiresAt,
      lastSeenAt: new Date(),
      failCount: 0,
    },
  });

  return NextResponse.json({ ok: true, id: row.id });
}

export async function DELETE(req: NextRequest) {
  const auth = await getCurrentContext();
  if (!auth?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get('endpoint');
  if (!endpoint) return NextResponse.json({ error: 'missing_endpoint' }, { status: 400 });

  await prisma.pushSubscription.deleteMany({
    where: { endpoint, userId: auth.user.id },
  });
  return NextResponse.json({ ok: true });
}
