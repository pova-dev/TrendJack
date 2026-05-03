// Barrel exports for the scoring layer. Callers should import from here:
//
//   import { score, type RawSignal, type ScoringContext } from '@/src/core/scoring';
//   import { matchKeyword, matchStem } from '@/src/core/scoring';
//   import { computeJackingScore, shouldGenerateContent } from '@/src/core/scoring';

export { score, predictPeakWindowEnd } from './engine';
export type { RawSignal, ScoringContext, ScoreResult, TopicalFitResult } from './types';

// Matchers (used by ingest, watchlist, dedupe).
export { matchKeyword, matchStem } from './matchers';

// Jacking Score / S_max (Filter Agent + Creative Agent + Verifier triggers).
export {
  computeJackingScore,
  computeSignalStrength,
  shouldGenerateContent,
  shouldAutoVerify,
  DEFAULT_JACKING_THRESHOLD,
  AUTO_VERIFY_THRESHOLD,
  type JackingScoreInput,
  type SignalStrengthInput,
} from './jacking-score';

// Vocabularies — exported so future tooling can introspect / extend.
export { CRISIS_STEMS, CONTROVERSY_STEMS, INFLAMMATORY_STEMS, ANXIETY_STEMS } from './risk';
export { CLICHE_STEMS, AD_SPEAK_STEMS, HYPE_STEMS, FORCED_SLANG_TRIGGERS } from './cringe';

// Individual axis functions — exposed for tests + advanced callers who want
// to compose their own pipelines (e.g. a "what-if" tuner).
export { computeTopicalFit, computeTopicalFitDetailed } from './topical-fit';
export { computeTonalFit, computeAudienceOverlap } from './tonal-fit';
export { computeRisk } from './risk';
export { computeCringe } from './cringe';
export {
  computeVirality,
  computeTiming,
  computeFirstMover,
  computeSaturation,
  estimateAssetEffort,
  estimateApprovalEffort,
  estimateProductionEffort,
} from './axes';
export { decide } from './decide';

// Helpers — exported because UI code (e.g. ScoreChip) uses pct() too.
export { clamp01, round, pct, formatBig, sigmoid01 } from './helpers';
