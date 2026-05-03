import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { requireRole, ROLES_CAN_COMMENT, AuthorizationError, type Role } from '@/lib/auth/roles';
import { getTrend } from '@/lib/store';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/trends/[id]/room/vote
//   body: { angleId }
//   Casts a role-weighted vote for the angle. Idempotent — same user
//   voting again on the same angle just refreshes the row.
//
// Role weights (the operator's vote weight on the room's tally):
//   owner / admin / strategist  → weight 3   (decision-makers)
//   operator                     → weight 2   (executors)
//   approver                     → weight 1   (review-only — counted but light)
//   viewer                       → forbidden (can't vote)

const ROLE_WEIGHT: Record<Role, number> = {
  owner: 3, admin: 3, strategist: 3,
  operator: 2,
  approver: 1,
  viewer: 0,
};

interface VoteBody { angleId?: string }

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentContext();
  if (!auth?.brand || !auth.org || !auth.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let role: Role;
  try {
    const m = await requireRole(auth.org.id, auth.user.id, ROLES_CAN_COMMENT);
    role = m.role;
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
  const data = (await req.json().catch(() => null)) as VoteBody | null;
  const angleId = data?.angleId?.trim();
  if (!angleId) return NextResponse.json({ error: 'missing_angle' }, { status: 400 });

  const room = await prisma.trendRoom.findUnique({ where: { trendId: id } });
  if (!room) return NextResponse.json({ error: 'no_room' }, { status: 404 });
  if (room.status !== 'open') return NextResponse.json({ error: 'room_closed' }, { status: 409 });

  const weight = ROLE_WEIGHT[role] ?? 1;
  const vote = await prisma.roomVote.upsert({
    where: { roomId_userId_angleId: { roomId: room.id, userId: auth.user.id, angleId } },
    create: { roomId: room.id, userId: auth.user.id, angleId, weight },
    update: { weight },
  });

  // Tally + return so the UI can update without re-fetching the room.
  const allVotes = await prisma.roomVote.findMany({ where: { roomId: room.id } });
  const tally = new Map<string, { weight: number; voters: number }>();
  for (const v of allVotes) {
    const cur = tally.get(v.angleId) ?? { weight: 0, voters: 0 };
    cur.weight += v.weight;
    cur.voters += 1;
    tally.set(v.angleId, cur);
  }

  return NextResponse.json({
    vote,
    tally: Array.from(tally.entries()).map(([angleId, t]) => ({ angleId, ...t })),
  });
}
