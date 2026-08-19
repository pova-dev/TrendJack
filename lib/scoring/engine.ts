// Compatibility shim removed 2026-05-29. All in-repo callers now import
// directly from `@/src/core/scoring`. This file remains as a thin re-export
// only so external/third-party code (tests outside the repo, downstream
// forks, internal scripts) that still references the old path doesn't break
// abruptly. Delete in Phase 11 once external dependencies are confirmed
// migrated.

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
