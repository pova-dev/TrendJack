import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { requireRole, ROLES_CAN_APPROVE, AuthorizationError } from '@/lib/auth/roles';
import { getTrend } from '@/lib/store';
import { prisma } from '@/lib/db';
import { getBus } from '@/src/core/state';
import { STREAMS } from '@/src/core/state/streams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Outcome reporting endpoint.
//
// POST /api/trends/[id]/outcome
//   body: { postUrl?, postEngagement, performanceMultiple? }
//
// Operator manually reports what actually happened after they shipped.
// Closes the prediction → ship → measure → train loop. The values
// flow into:
//   1. Trend.performanceMultiple + postEngagement (audit/UI)
//   2. STREAMS.operatorFeedback (high-fidelity training signal —
//      polarity is +1 with weight scaled by performanceMultiple)
//
// `performanceMultiple` is operator-supplied: their estimate of
// "actual engagement / typical engagement for this brand". 1.0 = met
// expectations; 2.0 = doubled them; 0.5 = half. Calibration treats
// > 1.2 as strongly positive, < 0.8 as strongly negative.

interface OutcomeBody {
  postUrl?: string;
  postEngagement?: number;       // raw count (likes + reposts + replies)
  performanceMultiple?: number;  // operator's vs-expectation estimate
  notes?: string;
}

const POSITIVE_THRESHOLD = 1.2;
const NEGATIVE_THRESHOLD = 0.8;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentContext();
  if (!auth?.brand || !auth.org || !auth.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // Outcomes are decision-level data — same role as plan approvals.
  try {
    await requireRole(auth.org.id, auth.user.id, ROLES_CAN_APPROVE);
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

  const data = (await req.json().catch(() => null)) as OutcomeBody | null;
  if (!data) return NextResponse.json({ error: 'missing_body' }, { status: 400 });

  const performanceMultiple = typeof data.performanceMultiple === 'number' && Number.isFinite(data.performanceMultiple)
    ? Math.max(0, Math.min(20, data.performanceMultiple))
    : null;
  const postEngagement = typeof data.postEngagement === 'number' && Number.isFinite(data.postEngagement)
    ? Math.max(0, Math.round(data.postEngagement))
    : null;

  // Persist to the Trend row.
  await prisma.trend.update({
    where: { id },
    data: {
      ...(performanceMultiple != null ? { performanceMultiple } : {}),
      ...(postEngagement != null ? { postEngagement: BigInt(postEngagement) } : {}),
    },
  });

  // Audit
  await prisma.auditLog.create({
    data: {
      orgId: auth.org.id,
      userId: auth.user.id,
      action: 'trend.outcome.reported',
      target: id,
      meta: JSON.stringify({ performanceMultiple, postEngagement, postUrl: data.postUrl, notes: data.notes }),
    },
  });

  // Calibration loopback — emit operatorFeedback with polarity weighted
  // by the operator's vs-expectation estimate. This is the highest-
  // fidelity training signal in the system: the operator literally
  // shipped this AND told us how it performed.
  if (performanceMultiple != null) {
    const polarity: -1 | 0 | 1 =
      performanceMultiple > POSITIVE_THRESHOLD ? 1 :
      performanceMultiple < NEGATIVE_THRESHOLD ? -1 :
      0;

    if (polarity !== 0) {
      // trend.scores is already parsed (Trend type, not Prisma row).
      const scores = trend.scores as unknown as Record<string, unknown>;
      const bus = getBus();
      await bus.publish(STREAMS.operatorFeedback, {
        brandId: trend.brandId,
        trendId: id,
        userId: auth.user.id,
        action: polarity > 0 ? 'approve' : 'reject',
        polarity,
        features: {
          fit: numField(scores, 'brandFit'),
          velocity: trend.velocity,
          firstMover: numField(scores, 'firstMover'),
          risk: numField(scores, 'risk'),
          cringe: numField(scores, 'cringe'),
          saturation: numField(scores, 'saturation'),
          cascadePhase: (trend.cascadePhase as 'pre-launch' | 'fast-growing-initial' | 'peaking' | 'decaying' | null | undefined) ?? null,
          brandKeywordHit: trend.brandKeywordHit ?? false,
          recommendation: trend.recommendation,
          opportunity: numField(scores, 'opportunity'),
        },
        reason: `outcome:perfMult=${performanceMultiple.toFixed(2)}`,
        emittedAt: new Date(),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    performanceMultiple,
    postEngagement,
  });
}

function numField(o: Record<string, unknown>, k: string): number {
  const v = o[k];
  return typeof v === 'number' ? v : 0;
}
