import { NextRequest, NextResponse } from 'next/server';
import { getBoard, getDefaultBoard, listBoardsForBrand, saveBoard } from '@/lib/store';
import { getCurrentContext } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const ctx = await getCurrentContext();
  if (!ctx?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (id) {
    // getBoard now requires brandId; returns null on cross-tenant access.
    const b = await getBoard(id, ctx.brand.id);
    if (!b) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(b);
  }
  const def = await getDefaultBoard(ctx.brand.id, ctx.user.id);
  if (!def) return NextResponse.json({ error: 'no_board' }, { status: 404 });
  return NextResponse.json(def);
}

export async function POST(req: NextRequest) {
  const ctx = await getCurrentContext();
  if (!ctx?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json();
  const saved = await saveBoard({ ...body, brandId: ctx.brand.id, ownerId: ctx.user.id });
  return NextResponse.json(saved);
}

export async function PUT(req: NextRequest) {
  // Same handler as POST — used by the column builder for save/replace.
  return POST(req);
}
