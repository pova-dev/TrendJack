import { NextResponse } from 'next/server';
import { requireBrand } from '@/lib/auth';
import { addAccount, isPlatform, listAccounts, removeAccount } from '@/lib/social/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireBrand();
  return NextResponse.json({ items: await listAccounts(ctx.brand.id) });
}

export async function POST(req: Request) {
  const ctx = await requireBrand();
  const body = await req.json().catch(() => null) as {
    platform?: string; handle?: string; isOwn?: boolean; competitorName?: string;
  } | null;

  if (!body?.platform || !isPlatform(body.platform)) {
    return NextResponse.json({ error: 'platform must be instagram, facebook or youtube' }, { status: 400 });
  }
  if (!body.handle?.trim()) {
    return NextResponse.json({ error: 'handle is required' }, { status: 400 });
  }

  const account = await addAccount({
    brandId: ctx.brand.id,
    platform: body.platform,
    handle: body.handle,
    isOwn: !!body.isOwn,
    competitorName: body.isOwn ? null : (body.competitorName?.trim() || body.handle.trim()),
  });

  return NextResponse.json({ id: account.id, handle: account.handle });
}

export async function DELETE(req: Request) {
  const ctx = await requireBrand();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const removed = await removeAccount(ctx.brand.id, id);
  if (!removed) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
