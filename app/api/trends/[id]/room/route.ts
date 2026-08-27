import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { getTrend } from '@/lib/store';
import { prisma } from '@/lib/db';
import { requireCapability, guardErrorResponse } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/trends/[id]/room — fetch the active room + comments + votes
//   404 when no room exists yet (operator clicks "Open room" to create)
// POST /api/trends/[id]/room — open the room (idempotent — returns existing
//   if @unique constraint hits)

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentContext();
  if (!auth?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const trend = await getTrend(id);
  if (!trend || trend.brandId !== auth.brand.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const room = await prisma.trendRoom.findUnique({
    where: { trendId: id },
    include: {
      comments: { orderBy: { createdAt: 'asc' } },
      votes: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!room) return NextResponse.json({ error: 'no_room' }, { status: 404 });
  return NextResponse.json(room);
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Permission gate. Deny-by-default: this route mutates state, so it must
  // name the capability it needs. See lib/auth/capabilities.ts.
  try { await requireCapability('room:comment'); }
  catch (e) { const denied = guardErrorResponse(e); if (denied) return denied; throw e; }

  const auth = await getCurrentContext();
  if (!auth?.brand || !auth.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const trend = await getTrend(id);
  if (!trend || trend.brandId !== auth.brand.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Idempotent — upsert by trendId.
  const room = await prisma.trendRoom.upsert({
    where: { trendId: id },
    create: {
      trendId: id,
      brandId: auth.brand.id,
      orgId: auth.org.id,
      status: 'open',
    },
    update: {},  // existing row returned unchanged
    include: {
      comments: { orderBy: { createdAt: 'asc' } },
      votes: { orderBy: { createdAt: 'asc' } },
    },
  });
  return NextResponse.json(room);
}
