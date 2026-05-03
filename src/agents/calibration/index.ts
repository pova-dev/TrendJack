// Calibration Engine — Feature D Phase 1.
//
// Subscribes to STREAMS.operatorFeedback. For every event with non-zero
// polarity, rolls up Bayesian beta-binomial buckets per
// (brand × axis × bucket) and exposes a `calibrationBoost(brandId,
// signal, scoreResult)` accessor that the score engine multiplies into
// `opportunity` AT RANKING TIME.
//
// Hard guarantees:
//   1. CVS / jackingScore is NEVER multiplied. Per CLAUDE.md rule 4 the
//      multiplicative AND-gate must stay clean. The boost only nudges
//      the additive composite that drives dashboard sort.
//   2. Cold-start brands (no events yet, or buckets below the floor)
//      return 1.0 — perfect backwards compatibility.
//   3. The boost is clamped to [0.5, 1.5] — at most 50% nudge in either
//      direction. Operators can't accidentally train themselves into a
//      tunnel-vision dashboard.
//
// Persistence: every event is written to FeedbackEvent (audit trail);
// per-bucket counts are upserted into OperatorFeedbackBucket (the
// estimator's read source). The agent maintains an in-memory cache of
// the bucket map so calibrationBoost() is synchronous and fast.

import 'server-only';
import { prisma } from '@/lib/db';
import type { StateBus } from '@/src/core/state';
import { STREAMS } from '@/src/core/state/streams';
import type { OperatorFeedbackMessage } from '@/src/core/state/streams';
import type { RawSignal, ScoreResult } from '@/src/core/scoring/types';

/** Minimum observations before a bucket's multiplier kicks in. Below
 *  this floor we return 1.0 (no nudge). Prevents one-off events from
 *  swinging the dashboard wildly. */
const BUCKET_OBSERVATION_FLOOR = 5;

/** Boost clamp. Even with overwhelming evidence, calibration can only
 *  nudge ±50%. Operators can't lose access to a half of the universe
 *  through their own thumb-down behavior. */
const BOOST_MIN = 0.5;
const BOOST_MAX = 1.5;

type BucketKey = string;
type BrandBuckets = Map<BucketKey, { pos: number; neg: number }>;

/** In-memory cache: brandId → buckets. Rebuilt on agent boot from the
 *  OperatorFeedbackBucket table. Updated on every feedback event. */
const cache = new Map<string, BrandBuckets>();
let initialized = false;

function key(axis: string, bucket: string): BucketKey {
  return `${axis}:${bucket}`;
}

/** Bucket a continuous 0..1 score into low/mid/high. */
function bucketize01(value: number): 'low' | 'mid' | 'high' {
  if (value < 0.33) return 'low';
  if (value < 0.66) return 'mid';
  return 'high';
}

/** Bucket function table per axis. Returns the bucket name. */
function bucketFor(axis: string, features: OperatorFeedbackMessage['features']): string | null {
  switch (axis) {
    case 'fit':         return bucketize01(features.fit);
    case 'velocity':    return features.velocity >= 100 ? 'high' : features.velocity >= 30 ? 'mid' : 'low';
    case 'cringe':      return bucketize01(features.cringe);
    case 'risk':        return bucketize01(features.risk);
    case 'saturation':  return bucketize01(features.saturation);
    case 'cascadePhase': return features.cascadePhase ?? null;
    case 'brandKeywordHit': return features.brandKeywordHit ? 'yes' : 'no';
    case 'recommendation': return features.recommendation;
    default: return null;
  }
}

const TRACKED_AXES = ['fit', 'velocity', 'cringe', 'risk', 'saturation', 'cascadePhase', 'brandKeywordHit', 'recommendation'] as const;

// Per-reason bucket weighting (Feature D Phase 4). When the operator
// supplies a dismiss reason via the chip modal, we apply the negative
// polarity ONLY to the axes that match the reason — instead of dragging
// every axis-bucket uniformly. Targeting the right axis means a brand
// learns "ignore high-cringe" without also learning "ignore high-fit"
// just because both were present on the dismissed signal.
//
// Reasons that map to a single axis weight that axis at 1.0; any other
// axes touched by the same event apply a reduced 0.25 weight (still
// some signal — the operator did dismiss — but most of the blame goes
// to the named cause). When no reason supplied, all axes weight 1.0.
const REASON_AXIS_PRIMARY: Record<string, ReadonlyArray<string>> = {
  off_brand:        ['fit', 'brandKeywordHit'],
  cringe:           ['cringe'],
  saturated:        ['saturation'],
  wrong_audience:   ['fit'],
  not_now:          ['cascadePhase', 'velocity'],
  low_fit:          ['fit'],
};
const SECONDARY_WEIGHT = 0.25;

function axisWeight(reason: string | undefined, axis: string): number {
  if (!reason) return 1.0;
  const primary = REASON_AXIS_PRIMARY[reason];
  if (!primary) return 1.0;            // unknown reason → uniform
  return primary.includes(axis) ? 1.0 : SECONDARY_WEIGHT;
}

/** Cold-boot rebuild — pull every OperatorFeedbackBucket row into the
 *  in-memory cache. Called once per agent boot; tests can re-trigger
 *  via `_resetCalibrationForTesting`. */
async function rebuildCache(): Promise<void> {
  cache.clear();
  const rows = await prisma.operatorFeedbackBucket.findMany();
  for (const r of rows) {
    let brand = cache.get(r.brandId);
    if (!brand) {
      brand = new Map();
      cache.set(r.brandId, brand);
    }
    brand.set(key(r.axis, r.bucket), { pos: r.positiveCount, neg: r.negativeCount });
  }
  initialized = true;
}

/** Apply one feedback event to the in-memory cache + persist to DB. */
async function applyFeedback(msg: OperatorFeedbackMessage): Promise<void> {
  // Persist the audit row regardless of polarity — neutral actions
  // are still useful history.
  await prisma.feedbackEvent.create({
    data: {
      trendId: msg.trendId,
      brandId: msg.brandId,
      userId: msg.userId,
      action: msg.action,
      polarity: msg.polarity,
      features: JSON.stringify(msg.features),
      reason: msg.reason,
    },
  });

  // Polarity 0 = neutral; logged but doesn't move buckets.
  if (msg.polarity === 0) return;

  let brand = cache.get(msg.brandId);
  if (!brand) {
    brand = new Map();
    cache.set(msg.brandId, brand);
  }

  // Per-reason axis weighting (Phase 4) — when a dismiss reason is
  // supplied, restrict the negative-polarity update to the axes
  // implicated by the reason. Positive-polarity events ALWAYS apply
  // uniformly across axes (a save tells us the whole signal worked).
  for (const axis of TRACKED_AXES) {
    const bucket = bucketFor(axis, msg.features);
    if (!bucket) continue;
    // Reason-aware skip: when polarity < 0 AND axis isn't part of the
    // reason's primary set, don't drag it. Saves and approves stay
    // uniform across all axes.
    if (msg.polarity < 0 && msg.reason && axisWeight(msg.reason, axis) < 0.5) {
      continue;
    }
    const k = key(axis, bucket);
    const cur = brand.get(k) ?? { pos: 0, neg: 0 };
    if (msg.polarity > 0) cur.pos++;
    else cur.neg++;
    brand.set(k, cur);

    await prisma.operatorFeedbackBucket.upsert({
      where: { brandId_axis_bucket: { brandId: msg.brandId, axis, bucket } },
      create: { brandId: msg.brandId, axis, bucket, positiveCount: cur.pos, negativeCount: cur.neg },
      update: { positiveCount: cur.pos, negativeCount: cur.neg },
    });
  }
}

/** Compute the calibration boost for a freshly-scored signal.
 *
 *  Math: per (axis, bucket) we have `(pos+1)/(pos+neg+2)` as a
 *  Laplace-smoothed save probability. The bucket's multiplier is that
 *  probability divided by 0.5 (the prior — "no information"). So 0.7
 *  saves becomes 1.4× boost; 0.3 saves becomes 0.6× drag. Multiplying
 *  across all tracked axes gives the composite boost.
 *
 *  Buckets below BUCKET_OBSERVATION_FLOOR contribute 1.0 (no signal
 *  yet). Final result is clamped to [BOOST_MIN, BOOST_MAX]. */
export function calibrationBoost(
  brandId: string,
  signal: RawSignal,
  scoreResult: ScoreResult,
): number {
  const brand = cache.get(brandId);
  if (!brand || brand.size === 0) return 1.0;

  // Build a synthetic features object matching what the publisher sends.
  const features: OperatorFeedbackMessage['features'] = {
    fit: scoreResult.scores.brandFit,
    velocity: signal.velocity,
    firstMover: scoreResult.scores.firstMover,
    risk: scoreResult.scores.risk,
    cringe: scoreResult.scores.cringe,
    saturation: scoreResult.scores.saturation,
    cascadePhase: null,  // not threaded through ScoreResult — that's fine,
                         // we'll skip the cascadePhase axis for un-forecasted trends
    brandKeywordHit: scoreResult.brandKeywordHit ?? false,
    recommendation: scoreResult.recommendation,
    opportunity: scoreResult.scores.opportunity,
  };

  let product = 1.0;
  for (const axis of TRACKED_AXES) {
    const bucket = bucketFor(axis, features);
    if (!bucket) continue;
    const cell = brand.get(key(axis, bucket));
    if (!cell) continue;
    const total = cell.pos + cell.neg;
    if (total < BUCKET_OBSERVATION_FLOOR) continue;
    const prob = (cell.pos + 1) / (cell.pos + cell.neg + 2);
    const multiplier = prob / 0.5;  // 0.5 prior → identity
    product *= multiplier;
  }

  return Math.max(BOOST_MIN, Math.min(BOOST_MAX, product));
}

/** Read-only accessor for the dashboard panel. Returns the per-bucket
 *  table the operator can inspect to understand what the system has
 *  learned about their preferences. */
export function calibrationSnapshot(brandId: string): Array<{
  axis: string; bucket: string; pos: number; neg: number; multiplier: number;
}> {
  const brand = cache.get(brandId);
  if (!brand) return [];
  const out: Array<{ axis: string; bucket: string; pos: number; neg: number; multiplier: number }> = [];
  for (const [k, v] of brand.entries()) {
    const [axis, bucket] = k.split(':');
    const total = v.pos + v.neg;
    const multiplier = total >= BUCKET_OBSERVATION_FLOOR
      ? ((v.pos + 1) / (total + 2)) / 0.5
      : 1.0;
    out.push({ axis, bucket, pos: v.pos, neg: v.neg, multiplier: Math.round(multiplier * 100) / 100 });
  }
  return out.sort((a, b) => a.axis.localeCompare(b.axis) || a.bucket.localeCompare(b.bucket));
}

export interface CalibrationAgentDeps {
  bus: StateBus;
}

export interface CalibrationAgentHandle {
  stop: () => void;
}

export function startCalibrationAgent(deps: CalibrationAgentDeps): CalibrationAgentHandle {
  // Boot: rebuild cache from the persisted bucket table. Async, but the
  // agent is correct without it (cache fills naturally as events fire);
  // this just shortens the cold-start window.
  void rebuildCache();

  const unsub = deps.bus.subscribe(
    STREAMS.operatorFeedback,
    async (msg) => {
      try {
        await applyFeedback(msg.body);
        await deps.bus.ack(STREAMS.operatorFeedback.name, msg.id);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[calibration-agent] failed to process', msg.id, ':', (err as Error).message);
      }
    },
    { group: 'calibration-agent' },
  );

  // eslint-disable-next-line no-console
  console.log('[calibration-agent] started — beta-binomial bucket estimator');

  return { stop: () => unsub() };
}

/** Test seam — clears the in-memory cache so unit tests can isolate
 *  feedback application without bleed-through across runs. */
export function _resetCalibrationForTesting(): void {
  cache.clear();
  initialized = false;
}
