import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { requireRole, ROLES_CAN_COMMENT, AuthorizationError } from '@/lib/auth/roles';
import { getTrend } from '@/lib/store';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/trends/[id]/room/comment
//   body: { body, anchorType?, anchorRef?, parentId? }
//   Posts a comment to the trend's active room. Auto-opens the room
//   if it doesn't exist yet (matches POST /room semantics). Role-gated:
//   viewer-role users get 403.

interface CommentBody {
  body?: string;
  anchorType?: string;
  anchorRef?: string;
  parentId?: string;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentContext();
  if (!auth?.brand || !auth.org || !auth.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    await requireRole(auth.org.id, auth.user.id, ROLES_CAN_COMMENT);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: 'forbidden', reason: err.reason }, { status: 403 });
    }
    throw err;
  }

  const { id } = await ctx.params;
  const trend = await getTrend(id);
  if (!trend || trend.brandId !== auth.brand.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const data = (await req.json().catch(() => null)) as CommentBody | null;
  const body = (data?.body ?? '').trim().slice(0, 2000);
  if (!body) return NextResponse.json({ error: 'empty_body' }, { status: 400 });

  // Auto-open room
  const room = await prisma.trendRoom.upsert({
    where: { trendId: id },
    create: {
      trendId: id,
      brandId: auth.brand.id,
      orgId: auth.org.id,
      status: 'open',
    },
    update: {},
  });

  const comment = await prisma.roomComment.create({
    data: {
      roomId: room.id,
      userId: auth.user.id,
      parentId: data?.parentId,
      anchorType: data?.anchorType ?? 'general',
      anchorRef: data?.anchorRef,
      body,
    },
  });

  return NextResponse.json(comment);
}
