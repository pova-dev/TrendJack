import { NextRequest, NextResponse } from 'next/server';
import { recordAction, getTrend, logAudit } from '@/lib/store';
import { getCurrentContext } from '@/lib/auth';
import { publishBrandTrend } from '@/lib/realtime/bus';
import { fireWebhooks } from '@/lib/integrations/webhooks';
import { fireTelegramForOrg } from '@/lib/integrations/telegram';
import { prisma } from '@/lib/db';
import type { ActionType } from '@/types';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentContext();
  if (!auth?.brand || !auth.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const type = body.type as ActionType;
  const ALLOWED: ActionType[] = ['save', 'dismiss', 'snooze', 'follow', 'assign', 'export', 'approve', 'reject', 'generate', 'pin', 'unpin'];
  if (!ALLOWED.includes(type)) return NextResponse.json({ error: 'invalid_action' }, { status: 400 });

  const trend = await getTrend(id);
  if (!trend || trend.brandId !== auth.brand.id) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Pin is a state mutation, not just an audit log entry. Toggle.
  if (type === 'pin' || type === 'unpin') {
    const next = type === 'pin' ? !trend.pinned : false;
    await prisma.trend.update({ where: { id }, data: { pinned: next } });
    publishBrandTrend(auth.brand.id, { type: 'trend.updated', brandId: auth.brand.id, trendId: id, reason: type });
  } else {
    await recordAction(id, type, auth.user.id, body.payload);
    if (type === 'dismiss') {
      publishBrandTrend(auth.brand.id, { type: 'trend.dismissed', brandId: auth.brand.id, trendId: id });
    } else {
      publishBrandTrend(auth.brand.id, { type: 'trend.updated', brandId: auth.brand.id, trendId: id, reason: type });
    }
  }

  await logAudit({ orgId: auth.org.id, userId: auth.user.id, action: `trend.${type}`, target: id });

  // Outbound notifications — fire-and-forget
  const eventName = `trend.${type}`;
  fireWebhooks(auth.org.id, eventName, { trend, by: auth.user.email }).catch(() => {});
  fireTelegramForOrg(auth.org.id, eventName, { trend: { ...trend, openUrl: trend.url } }).catch(() => {});

  return NextResponse.json({ ok: true });
}
