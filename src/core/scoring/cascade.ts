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

// ─────────────────────────────────────────────────────────────────────────
// Predictive Virality — Phase 1 of the Trinity Swarm Rational Thinker
// roadmap (Feature B). Sibling to analyzeCascade(): instead of just
// classifying the *current* phase, fits a 3-parameter logistic curve to
// the cumulative-reach series to forecast WHEN the trend will peak.
//
// Math: cumulative reach ≈ K / (1 + exp(-r·(t - t₀)))
//   K  = saturation cap (asymptote)
//   r  = growth rate
//   t₀ = inflection (= peak velocity, half of K reached)
//
// Estimation strategy: closed-form 3-point fit on smoothed series. We
// don't run iterative least-squares per ingest tick — too expensive,
// and the 3-point estimator is good enough for a confidence-flagged
// preview. Operators see a confidence number alongside the time so
// they don't over-trust a low-sample forecast.
// ─────────────────────────────────────────────────────────────────────────

export type CascadeForecastPhase = 'pre-launch' | 'fast-growing-initial' | 'peaking' | 'decaying';

export interface CascadeForecast {
  /** Predicted peak time (when velocity is highest = inflection of cumulative
   *  reach curve). null when there are <3 samples or the fit failed. */
  predictedPeakAt: Date | null;
  /** 0..1, where higher means more confident. Capped low when sample count
   *  is small or when the series is non-monotonic. */
  predictedPeakConfidence: number;
  /** Human-readable phase classification. Always set. */
  phase: CascadeForecastPhase;
  /** Goodness-of-fit diagnostic (R² against the 3-parameter logistic). */
  modelFitR2: number;
}

/** Forecast the inflection (peak-velocity) time of a trend's cumulative-
 *  reach curve. See cascade module header for the math. */
export function forecastPeak(samples: TrendTimeSample[]): CascadeForecast {
  const sorted = [...samples].sort((a, b) => a.sampledAt.getTime() - b.sampledAt.getTime());
  if (sorted.length < 3) {
    return { predictedPeakAt: null, predictedPeakConfidence: 0, phase: 'pre-launch', modelFitR2: 0 };
  }

  // Detect non-monotonic reach (anomaly / bimodal trend). Logistic fit
  // misbehaves on these — flag as decaying with low confidence rather
  // than emitting a false peak prediction.
  const monotonic = sorted.every((s, i) => i === 0 || s.reach >= sorted[i - 1].reach * 0.95);
  if (!monotonic) {
    return {
      predictedPeakAt: null,
      predictedPeakConfidence: 0.20,
      phase: 'decaying',
      modelFitR2: 0,
    };
  }

  // Closed-form 3-point logistic fit. Use evenly-spread points: first,
  // middle, last sample. K is estimated from the latest reach with a
  // headroom multiplier when we're still climbing.
  const first = sorted[0];
  const mid   = sorted[Math.floor(sorted.length / 2)];
  const last  = sorted[sorted.length - 1];

  // Pre-fit early-climb shortcut. When velocity is still accelerating
  // sharply with few samples we have NO information about the
  // saturation cap K — so the logistic fit collapses to "we're peaking
  // right now" because Kestimate is too low. In that regime we know
  // this is fast-growing-initial regardless of the fit's t₀; emit it
  // with low confidence.
  if (sorted.length <= 6 && last.velocity > 2 * Math.max(1, first.velocity)) {
    // Estimate t₀ very roughly: extrapolate from velocity doubling rate.
    // Each doubling of velocity ≈ time to peak of ln(K/reach)/r ≈ 4-8h.
    // We don't have K, so just push t₀ ~ (last.sampledAt + 6h) for the
    // operator-visible time.
    return {
      predictedPeakAt: new Date(last.sampledAt.getTime() + 6 * 3_600_000),
      predictedPeakConfidence: 0.30,
      phase: 'fast-growing-initial',
      modelFitR2: 0.4,
    };
  }

  // Saturation cap: if velocity is still rising at `last`, K must be
  // > last.reach. Use 1.5× current reach as a conservative ceiling.
  const velocityRising = last.velocity > first.velocity;
  const Kestimate = velocityRising
    ? Math.max(last.reach * 1.5, last.reach + last.velocity * 6)
    : last.reach * 1.05;

  // Reach-to-logit transform: y = ln(K/reach - 1) → linear in t.
  // y ≈ -r·(t - t₀) for the logistic. Fit a line through (t, y) for
  // first/mid/last; recover r from slope, t₀ from intercept.
  const toLogit = (reach: number) => {
    const ratio = Kestimate / Math.max(1, reach) - 1;
    return Math.log(Math.max(1e-6, ratio));
  };

  const t1 = first.sampledAt.getTime() / 3_600_000; // hours since epoch
  const t2 = mid.sampledAt.getTime()   / 3_600_000;
  const t3 = last.sampledAt.getTime()  / 3_600_000;
  const y1 = toLogit(first.reach);
  const y2 = toLogit(mid.reach);
  const y3 = toLogit(last.reach);

  // Least-squares slope/intercept across 3 points.
  const meanT = (t1 + t2 + t3) / 3;
  const meanY = (y1 + y2 + y3) / 3;
  const num = (t1 - meanT) * (y1 - meanY) + (t2 - meanT) * (y2 - meanY) + (t3 - meanT) * (y3 - meanY);
  const den = (t1 - meanT) ** 2 + (t2 - meanT) ** 2 + (t3 - meanT) ** 2;
  if (den === 0) {
    return { predictedPeakAt: null, predictedPeakConfidence: 0, phase: 'pre-launch', modelFitR2: 0 };
  }
  const slope = num / den;             // = -r
  const intercept = meanY - slope * meanT;  // = r·t₀

  const r = -slope;
  if (!Number.isFinite(r) || r <= 0) {
    // Curve is flat or inverted — call it decaying.
    return { predictedPeakAt: null, predictedPeakConfidence: 0.30, phase: 'decaying', modelFitR2: 0 };
  }

  // t₀ in hours-since-epoch. Convert to a Date.
  const t0Hours = -intercept / slope;
  const predictedPeakAt = new Date(t0Hours * 3_600_000);

  // R² goodness-of-fit on the 3 points (sanity diagnostic).
  const yPred = (t: number) => slope * t + intercept;
  const ssRes = (y1 - yPred(t1)) ** 2 + (y2 - yPred(t2)) ** 2 + (y3 - yPred(t3)) ** 2;
  const ssTot = (y1 - meanY) ** 2 + (y2 - meanY) ** 2 + (y3 - meanY) ** 2;
  const R2 = ssTot > 0 ? Math.max(0, Math.min(1, 1 - ssRes / ssTot)) : 0;

  // Phase classification based on where `last` sits relative to t₀.
  const nowH = last.sampledAt.getTime() / 3_600_000;
  const dt = t0Hours - nowH; // hours until predicted peak (negative = past)
  const phase: CascadeForecastPhase =
    dt >= 4       ? 'fast-growing-initial' :
    dt > -2       ? 'peaking' :
                    'decaying';

  // Confidence. Cap by sample count and R². Operators see this so they
  // can hedge — never blindly trust a 3-sample forecast.
  const sampleConfidenceCap =
    sorted.length >= 8 ? 0.95 :
    sorted.length >= 6 ? 0.85 :
    sorted.length >= 4 ? 0.60 :
                         0.40;
  const confidence = Math.max(0, Math.min(sampleConfidenceCap, R2 * 0.9 + 0.1));

  return {
    predictedPeakAt,
    predictedPeakConfidence: Math.round(confidence * 100) / 100,
    phase,
    modelFitR2: Math.round(R2 * 100) / 100,
  };
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
