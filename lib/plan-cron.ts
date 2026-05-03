// Plan-lifecycle cron — runs once per process, ticks every 5 min.
//
// Two responsibilities:
//   1. Auto-expire plans whose `expiresAt` has passed (peakWindowEnd).
//      Status flips to 'expired'; calibration agent picks this up via
//      a synthetic negative-polarity feedback event (the system thought
//      ship; trend died — composer was wrong, learn from it).
//
//   2. Phase-aware downgrade: when a plan's underlying trend has flipped
//      to `cascadePhase === 'decaying'`, supersede the plan immediately.
//      The composer should not have produced a plan for a decaying
//      trend, but the trend may have moved AFTER composition. Stops
//      operators from approving stale plans on dead trends.
//
// Idempotent — multiple ticks against the same plan are no-ops once
// status moves out of 'pending_approval' / 'draft'.

import 'server-only';
import { prisma } from './db';
import { getBus } from '@/src/core/state';
import { STREAMS } from '@/src/core/state/streams';

const TICK_MS = 5 * 60_000;
let started = false;

export function startPlanLifecycleCron(): void {
  if (started) return;
  started = true;

  void runOnce();
  const t = setInterval(runOnce, TICK_MS);
  if (t.unref) t.unref();
  // eslint-disable-next-line no-console
  console.log('[plan-cron] started — first sweep now, then every 5min');
}

async function runOnce(): Promise<void> {
  try {
    const now = new Date();

    // 1. Expire plans past their peakWindowEnd.
    const expired = await prisma.shipItPlan.findMany({
      where: {
        status: { in: ['draft', 'pending_approval'] },
        expiresAt: { lte: now },
      },
      select: { id: true, trendId: true, brandId: true, orgId: true, expiresAt: true },
    });
    for (const p of expired) {
      await prisma.shipItPlan.update({
        where: { id: p.id },
        data: { status: 'expired', decisionReason: 'Auto-expired — peak window passed without approval.' },
      });
      // Synthetic negative-polarity feedback: the composer was wrong.
      // Calibration learns to be more conservative on similar trends.
      await emitNegativeCalibrationSignal(p.brandId, p.trendId);
    }

    // 2. Phase-aware downgrade — pending plans on now-decaying trends.
    const pending = await prisma.shipItPlan.findMany({
      where: { status: { in: ['draft', 'pending_approval'] } },
      select: { id: true, trendId: true, brandId: true },
    });
    for (const p of pending) {
      const trend = await prisma.trend.findUnique({
        where: { id: p.trendId },
        select: { cascadePhase: true, predictedPeakConfidence: true },
      });
      if (!trend) continue;
      if (trend.cascadePhase === 'decaying' && (trend.predictedPeakConfidence ?? 0) >= 0.5) {
        await prisma.shipItPlan.update({
          where: { id: p.id },
          data: {
            status: 'superseded',
            decisionReason: 'Auto-superseded — cascade phase flipped to decaying.',
          },
        });
        await emitNegativeCalibrationSignal(p.brandId, p.trendId);
      }
    }

    if (expired.length > 0 || pending.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[plan-cron] swept · expired=${expired.length} · pending-checked=${pending.length}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[plan-cron] tick failed:', (err as Error).message);
  }
}

/** Emit a synthetic negative-polarity feedback event so the calibration
 *  engine learns from auto-rejected plans. The features snapshot is
 *  reconstructed from the trend's current row. */
async function emitNegativeCalibrationSignal(brandId: string, trendId: string): Promise<void> {
  const trend = await prisma.trend.findUnique({ where: { id: trendId } });
  if (!trend) return;
  const scores = safeJsonParse(trend.scores);
  const bus = getBus();
  await bus.publish(STREAMS.operatorFeedback, {
    brandId,
    trendId,
    userId: 'system:plan-cron',
    action: 'reject',
    polarity: -1,
    features: {
      fit: numField(scores, 'brandFit'),
      velocity: trend.velocity,
      firstMover: numField(scores, 'firstMover'),
      risk: numField(scores, 'risk'),
      cringe: numField(scores, 'cringe'),
      saturation: numField(scores, 'saturation'),
      cascadePhase: (trend.cascadePhase as 'pre-launch' | 'fast-growing-initial' | 'peaking' | 'decaying' | null) ?? null,
      brandKeywordHit: trend.brandKeywordHit ?? false,
      recommendation: trend.recommendation,
      opportunity: numField(scores, 'opportunity'),
    },
    reason: 'plan-cron auto-rejection',
    emittedAt: new Date(),
  });
}

function safeJsonParse(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s); } catch { return null; }
}
function numField(o: Record<string, unknown> | null, k: string): number {
  if (!o) return 0;
  const v = o[k];
  return typeof v === 'number' ? v : 0;
}
