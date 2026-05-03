// Backwards-compat shim. The real scoring engine moved to src/core/scoring/
// during the agentic refactor (Phase 1). All existing imports keep working
// unchanged because this file re-exports the public surface.
//
// New code should import directly from `@/src/core/scoring` to benefit from
// the more focused module boundaries (e.g. `import { CRISIS_STEMS }` to
// introspect the risk vocab without pulling in the whole engine).
//
// This shim will be deleted after Phase 11 once all callers have migrated.

export {
  score,
  predictPeakWindowEnd,
  matchKeyword,
  matchStem,
  computeJackingScore,
  shouldGenerateContent,
  DEFAULT_JACKING_THRESHOLD,
} from '@/src/core/scoring';

export type {
  RawSignal,
  ScoringContext,
  ScoreResult,
  TopicalFitResult,
  JackingScoreInput,
} from '@/src/core/scoring';
