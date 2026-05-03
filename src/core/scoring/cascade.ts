// Cascade phase predictor — implements the R₀-based "social cascade"
// model from the audit spec.
//
// Idea: instead of just measuring current velocity, estimate the
// reproduction number R from a trend's TrendSample time-series. R is
// the average number of new "infected" users per existing infection
// per time unit:
//
//     R ≈ (new_infections in last window) / (cumulative at window start)
//
// Translated to social signals:
//
//     R ≈ (Δreach in last hour) / (reach at hour start)
//
// Phase classification:
//
//     R > 1.5    Fast-growing initial   — IDEAL for trend-jacking
//     R 1.0-1.5  Steady growth          — solid window
//     R 0.5-1.0  Plateau                — past peak, viable for late takes
//     R < 0.5    Decay                  — fizzling out, low ROI
//     R unknown  No samples yet         — fall back to plain velocity
//
// Self-correction: weight recent samples higher than older ones (linear
// decay). A two-week-old sample shouldn't influence today's R estimate.

export type CascadePhase = 'pre-launch' | 'fast-growing-initial' | 'steady' | 'plateau' | 'decay';

export interface TrendTimeSample {
  /** Time the sample was taken. */
  sampledAt: Date;
  /** Cumulative reach at sample time. */
  reach: number;
  /** Velocity at sample time (per-hour or per-tick proxy). */
  velocity: number;
}

export interface CascadeAnalysis {
  /** Reproduction number — null if too few samples. */
  R: number | null;
  /** Phase classification — never null; falls back to 'pre-launch'. */
  phase: CascadePhase;
  /** Number of samples used. */
  sampleCount: number;
  /** Plain-English label for UI. */
  reason: string;
}

const FAST_GROWING_THRESHOLD = 1.5;
const STEADY_THRESHOLD = 1.0;
const PLATEAU_THRESHOLD = 0.5;

/**
 * Estimate R₀ and classify cascade phase from a TrendSample time-series.
 *
 * Returns CascadeAnalysis even when we have <2 samples (R=null, phase
 * defaults to 'pre-launch') so callers don't need to special-case the
 * cold-start.
 */
export function analyzeCascade(samples: TrendTimeSample[]): CascadeAnalysis {
  // Sort by sampledAt ASC so [0] is oldest, [n-1] is newest.
  const sorted = [...samples].sort((a, b) => a.sampledAt.getTime() - b.sampledAt.getTime());

  if (sorted.length < 2) {
    return {
      R: null,
      phase: 'pre-launch',
      sampleCount: sorted.length,
      reason: sorted.length === 0
        ? 'no time-series data yet — using plain velocity for VEL_eff'
        : 'only 1 sample so far — need a second to compute R',
    };
  }

  // Use the most recent two samples for R₀ estimation. Earlier samples
  // help with self-correction (smoothing) but for the headline number
  // we want responsiveness — the trend's R right now matters more than
  // its R averaged over a week.
  const earlier = sorted[sorted.length - 2];
  const latest  = sorted[sorted.length - 1];

  const reachStart = earlier.reach;
  const reachEnd   = latest.reach;
  const deltaReach = Math.max(0, reachEnd - reachStart);

  // R = Δn / n_start. If reachStart is 0 we can't compute a ratio, so
  // fall back to "is velocity rising?" as a coarse proxy.
  let R: number;
  if (reachStart === 0) {
    // Fresh trend with no prior reach — velocity-based fallback.
    // Map velocity acceleration to a synthetic R: rising velocity → R>1.
    const velRatio = earlier.velocity > 0 ? latest.velocity / earlier.velocity : (latest.velocity > 0 ? 2 : 0);
    R = velRatio;
  } else {
    R = deltaReach / reachStart;
  }

  const phase: CascadePhase =
    R >= FAST_GROWING_THRESHOLD ? 'fast-growing-initial' :
    R >= STEADY_THRESHOLD       ? 'steady'              :
    R >= PLATEAU_THRESHOLD      ? 'plateau'             :
                                  'decay';

  const reason =
    phase === 'fast-growing-initial' ? `R≈${R.toFixed(2)} — fast-growing initial phase, ideal jack window` :
    phase === 'steady'               ? `R≈${R.toFixed(2)} — steady growth, solid post window` :
    phase === 'plateau'              ? `R≈${R.toFixed(2)} — plateau, late entry only` :
                                       `R≈${R.toFixed(2)} — decay, low ROI`;

  return {
    R: Math.max(0, R),
    phase,
    sampleCount: sorted.length,
    reason,
  };
}

/**
 * Cringe-Decay predictor — separate from cascade analysis.
 *
 * Premise: a trend "tips" from cool to cringe when cringe markers in
 * the discussion start outpacing engagement growth. We track per-sample
 * cringe (computed from the title/body at sample time) vs velocity.
 * If cringe is rising faster than velocity, the trend has peaked even
 * if the volume is still climbing.
 *
 * Returns true when cringeSlope > velocitySlope (both normalized).
 */
export interface CringeDecaySample {
  sampledAt: Date;
  cringe: number;     // 0..1
  velocity: number;
}

export interface CringeDecayAnalysis {
  cringeSlope: number;     // per-hour delta
  velocitySlope: number;   // per-hour delta (normalized)
  hasPeaked: boolean;
  reason: string;
}

export function analyzeCringeDecay(samples: CringeDecaySample[]): CringeDecayAnalysis | null {
  if (samples.length < 2) return null;

  const sorted = [...samples].sort((a, b) => a.sampledAt.getTime() - b.sampledAt.getTime());
  const earliest = sorted[0];
  const latest   = sorted[sorted.length - 1];

  const hours = Math.max(0.5, (latest.sampledAt.getTime() - earliest.sampledAt.getTime()) / 3_600_000);
  const cringeSlope   = (latest.cringe   - earliest.cringe)   / hours;
  // Normalize velocity to [0,1] roughly so slopes are comparable.
  const velNorm = (v: number) => Math.tanh(v / 500);
  const velocitySlope = (velNorm(latest.velocity) - velNorm(earliest.velocity)) / hours;

  const hasPeaked = cringeSlope > 0 && cringeSlope > velocitySlope;
  const reason = hasPeaked
    ? `cringe rising at ${cringeSlope.toFixed(3)}/h, faster than velocity — trend tipped to cringe`
    : `cringe ${cringeSlope >= 0 ? 'rising' : 'falling'} ${cringeSlope.toFixed(3)}/h, velocity ${velocitySlope.toFixed(3)}/h — still healthy`;

  return { cringeSlope, velocitySlope, hasPeaked, reason };
}
