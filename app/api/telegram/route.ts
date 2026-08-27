import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentContext } from '@/lib/auth';
import { logAudit } from '@/lib/store';
import { requireCapability, guardErrorResponse } from '@/lib/auth/guard';

export async function GET() {
  const ctx = await getCurrentContext();
  if (!ctx?.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const items = await prisma.telegramConnection.findMany({ where: { orgId: ctx.org.id }, orderBy: { createdAt: 'desc' } });
  // Don't echo the token back to the client.
  return NextResponse.json(items.map(t => ({
    id: t.id, name: t.name, defaultChatId: t.defaultChatId,
    events: JSON.parse(t.events) as string[], active: t.active,
    botTokenMasked: maskToken(t.botToken),
    createdAt: t.createdAt,
  })));
}

export async function POST(req: NextRequest) {
  // Permission gate. Deny-by-default: this route mutates state, so it must
  // name the capability it needs. See lib/auth/capabilities.ts.
  try { await requireCapability('credential:write'); }
  catch (e) { const denied = guardErrorResponse(e); if (denied) return denied; throw e; }

  const ctx = await getCurrentContext();
  if (!ctx?.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json();
  if (!body.botToken || !body.defaultChatId) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }
  const created = await prisma.telegramConnection.create({
    data: {
      orgId: ctx.org.id,
      name: body.name ?? 'Default',
      botToken: body.botToken,
      defaultChatId: body.defaultChatId,
      events: JSON.stringify(body.events ?? ['trend.post_now', 'trend.escalate', 'draft.shipped']),
    },
  });
  await logAudit({ orgId: ctx.org.id, userId: ctx.user.id, action: 'telegram.create', target: created.id });
  return NextResponse.json({
    id: created.id, name: created.name, defaultChatId: created.defaultChatId,
    events: JSON.parse(created.events), active: created.active,
    botTokenMasked: maskToken(created.botToken),
  });
}

export async function DELETE(req: NextRequest) {
  // Permission gate. Deny-by-default: this route mutates state, so it must
  // name the capability it needs. See lib/auth/capabilities.ts.
  try { await requireCapability('resource:delete'); }
  catch (e) { const denied = guardErrorResponse(e); if (denied) return denied; throw e; }

  const ctx = await getCurrentContext();
  if (!ctx?.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  await prisma.telegramConnection.deleteMany({ where: { id, orgId: ctx.org.id } });
  await logAudit({ orgId: ctx.org.id, userId: ctx.user.id, action: 'telegram.delete', target: id });
  return NextResponse.json({ ok: true });
}

function maskToken(t: string): string {
  if (t.length <= 8) return '••••';
  return t.slice(0, 4) + '••••' + t.slice(-4);
}
