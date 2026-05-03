import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentContext } from '@/lib/auth';
import { logAudit } from '@/lib/store';
import crypto from 'crypto';

export async function GET() {
  const ctx = await getCurrentContext();
  if (!ctx?.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const hooks = await prisma.webhook.findMany({ where: { orgId: ctx.org.id }, orderBy: { createdAt: 'desc' } });
  return NextResponse.json(hooks);
}

export async function POST(req: NextRequest) {
  const ctx = await getCurrentContext();
  if (!ctx?.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json();
  const created = await prisma.webhook.create({
    data: {
      orgId: ctx.org.id,
      name: body.name ?? 'Webhook',
      url: body.url,
      events: JSON.stringify(body.events ?? ['trend.dismiss', 'draft.shipped']),
      secret: body.secret ?? crypto.randomBytes(24).toString('hex'),
    },
  });
  await logAudit({ orgId: ctx.org.id, userId: ctx.user.id, action: 'webhook.create', target: created.id });
  return NextResponse.json(created);
}

export async function DELETE(req: NextRequest) {
  const ctx = await getCurrentContext();
  if (!ctx?.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  await prisma.webhook.deleteMany({ where: { id, orgId: ctx.org.id } });
  await logAudit({ orgId: ctx.org.id, userId: ctx.user.id, action: 'webhook.delete', target: id });
  return NextResponse.json({ ok: true });
}
