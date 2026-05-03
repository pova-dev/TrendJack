// Resonance Agent.
//
// Computes:
//   1. The "Why Now" justification — operator-readable string explaining
//      the FIT vs CRINGE balance and the recommended angle.
//   2. The Ironic Alignment multiplier — boosts S_max for brands whose
//      voice rewards anti-marketing humor on a given trend.
//   3. (Phase 7+) Brand Persona Vector match — Pinecone-backed cosine
//      similarity between trend embedding and brand-memory vectors.
//
// This v1 is rule-based — fast, hermetic, no LLM cost. Phase 7+ swaps
// in a vector adapter for finer-grained matching.

import type { BrandProfile } from '@/types';
import type { ScoreResult, RawSignal } from '@/src/core/scoring';

export interface ResonanceResult {
  /** Operator-readable "why now" string. */
  whyNow: string;
  /** Multiplier ≥ 1.0 for S_max numerator. Tuned per brand voice. */
  ironicAlignmentMultiplier: number;
  /** Conflicts between brand voice and trend tone — surfaces in UI. */
  conflicts: Array<{ axis: 'voice' | 'audience' | 'topic'; reason: string }>;
}

const ANTI_CLICHE_VOICES = /anti-?clich|sharp|direct|wry|self-aware|irony/i;
const HEAVY_HUMOR_HOOKS = ['humor', 'comedy', 'wit', 'irony', 'meme'];

export function analyzeResonance(
  signal: RawSignal,
  scoreResult: ScoreResult,
  brand: BrandProfile,
): ResonanceResult {
  const conflicts: ResonanceResult['conflicts'] = [];

  const fit    = scoreResult.scores.brandFit;
  const cringe = scoreResult.scores.cringe;
  const risk   = scoreResult.scores.risk;
  const tonal  = scoreResult.scores.tonalFit;

  // Conflict detection ---------------------------------------------------
  if (cringe >= 0.40 && fit >= 0.50) {
    conflicts.push({
      axis: 'voice',
      reason: `trend tone (cringe ${(cringe * 100).toFixed(0)}%) conflicts with brand voice — rewrite required before shipping`,
    });
  }
  if (tonal < 0.40 && fit >= 0.50) {
    conflicts.push({
      axis: 'voice',
      reason: `topic fits brand but tone doesn't — pivot to a different angle`,
    });
  }
  if (signal.competitorClaimants.length >= 1) {
    conflicts.push({
      axis: 'topic',
      reason: `${signal.competitorClaimants.length} competitor(s) already in the conversation`,
    });
  }

  // Ironic alignment multiplier -----------------------------------------
  // For brands with anti-cliché voice, trends where the smart move is
  // self-aware humor get a +20% multiplier on S_max. Computed once and
  // surfaced for both the UI and the Filter Agent's enrichSignal hook.
  const voiceFitsIrony = ANTI_CLICHE_VOICES.test(brand.tone.voice);
  const trendInvitesIrony =
    cringe < 0.20 &&                                                // trend itself isn't cringey
    (HEAVY_HUMOR_HOOKS.some(h => signal.title.toLowerCase().includes(h)) ||
     signal.competitorClaimants.length > 0);                        // OR competitor stumble = irony fuel
  const ironicAlignmentMultiplier = (voiceFitsIrony && trendInvitesIrony) ? 1.20 : 1.00;

  // Why Now string -------------------------------------------------------
  const phaseLabel =
    scoreResult.recommendation === 'POST_NOW'   ? 'post window is open'    :
    scoreResult.recommendation === 'PREP_1H'    ? 'draft within the hour'   :
    scoreResult.recommendation === 'MONITOR'    ? 'watch for spike or angle change' :
    scoreResult.recommendation === 'SAFE_PIVOT' ? 'pivot rather than direct take'   :
    scoreResult.recommendation === 'ESCALATE'   ? 'escalate to brand/legal' :
                                                  'no action recommended';

  const fitLabel = fit >= 0.70 ? 'strong brand-fit'
                 : fit >= 0.50 ? 'moderate brand-fit'
                 : fit >= 0.30 ? 'weak brand-fit'
                 :              'off-brand';
  const cringeLabel = cringe < 0.20 ? 'clean tone'
                    : cringe < 0.40 ? 'low cringe'
                    : cringe < 0.70 ? 'moderate cringe — rewrite required'
                    :                'high cringe — would fail brand-voice review';
  const ironyTail = ironicAlignmentMultiplier > 1
    ? '. Brand voice rewards self-aware angle — irony multiplier active.'
    : '';

  const whyNow = `${fitLabel}, ${cringeLabel}, risk ${(risk * 100).toFixed(0)}%. ${phaseLabel.charAt(0).toUpperCase() + phaseLabel.slice(1)}${ironyTail}`;

  return {
    whyNow,
    ironicAlignmentMultiplier,
    conflicts,
  };
}
