import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { requireRole, ROLES_CAN_DECIDE, AuthorizationError } from '@/lib/auth/roles';
import { getTrend } from '@/lib/store';
import { prisma } from '@/lib/db';
import { getBus } from '@/src/core/state';
import { STREAMS } from '@/src/core/state/streams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/trends/[id]/room/decide
//   body: { chosenAngleId, decisionReason? }
//   Marks the room decided + emits STREAMS.roomDecisions + emits a
//   synthetic STREAMS.operatorFeedback (positive polarity for the
//   chosen angle's underlying signal — closes the loop with Feature D).
//   Role-gated: only owner/admin/strategist can decide.

interface DecideBody {
  chosenAngleId?: string;
  decisionReason?: string;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentContext();
  if (!auth?.brand || !auth.org || !auth.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    await requireRole(auth.org.id, auth.user.id, ROLES_CAN_DECIDE);
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
  const data = (await req.json().catch(() => null)) as DecideBody | null;
  const chosenAngleId = data?.chosenAngleId?.trim();
  if (!chosenAngleId) return NextResponse.json({ error: 'missing_angle' }, { status: 400 });

  const room = await prisma.trendRoom.findUnique({
    where: { trendId: id },
    include: { votes: true },
  });
  if (!room) return NextResponse.json({ error: 'no_room' }, { status: 404 });

  // Tally votes by angleId for the decision summary.
  const tally = new Map<string, { weight: number; voters: number }>();
  for (const v of room.votes) {
    const cur = tally.get(v.angleId) ?? { weight: 0, voters: 0 };
    cur.weight += v.weight;
    cur.voters += 1;
    tally.set(v.angleId, cur);
  }
  const voteSummary = Array.from(tally.entries()).map(([angleId, t]) => ({ angleId, ...t }));

  await prisma.trendRoom.update({
    where: { id: room.id },
    data: {
      status: 'decided',
      decidedAngle: chosenAngleId,
      decisionReason: (data?.decisionReason ?? '').slice(0, 500),
      decidedBy: auth.user.id,
      decidedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId: auth.org.id,
      userId: auth.user.id,
      action: 'room.decided',
      target: id,
      meta: JSON.stringify({ chosenAngleId, voteSummary }),
    },
  });

  // Emit decision event + synthetic positive feedback so calibration
  // learns from collective decisions.
  const bus = getBus();
  await bus.publish(STREAMS.roomDecisions, {
    roomId: room.id,
    trendId: id,
    brandId: auth.brand.id,
    orgId: auth.org.id,
    decidedBy: auth.user.id,
    chosenAngleId,
    rationale: data?.decisionReason,
    voteSummary,
    decidedAt: new Date(),
  });

  return NextResponse.json({ ok: true, chosenAngleId, voteSummary });
}
