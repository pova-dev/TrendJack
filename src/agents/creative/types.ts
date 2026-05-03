// Creative Agent — Template-Hook-Context model.
//
// Replaces the prior "freeform prose with brand-prompt injection" pattern
// (which produced cringe drafts because the LLM had nothing to push back
// against). The new model is structurally typed:
//
//   compose(template, hook, context) → TypedDraft
//
//   template — channel skeleton (X-thread-3, IG-carousel-5, TikTok-script-30s, …)
//   hook     — angle / POV (challenger, educator, comedian, expert-reaction, …)
//   context  — verified claims + brand voice + audience + forbidden angles
//
// Slot-level validators run AT FILL TIME — a slot citing a fact must
// include {claimId, sourceUrl}; a hook slot must pass tonal-fit ≥ 0.6.
// Voice violations are caught structurally, not by post-hoc cringe scoring.

import type { BrandProfile } from '@/types';
import type { VerifiedClaim } from '@/src/agents/verifier/types';
import type { ScoreResult, RawSignal } from '@/src/core/scoring';

export type Channel = 'x' | 'instagram' | 'tiktok' | 'linkedin' | 'youtube' | 'reddit';

export type SlotKind =
  | 'hook'         // opening line / scroll-stopper
  | 'body'         // main argument or narrative
  | 'evidence'     // citation-required slot — value must reference a VerifiedClaim
  | 'cta'          // call to action
  | 'caption'      // image/video caption
  | 'visual_brief' // production direction (shot list, on-screen text)
  | 'audio_brief'  // audio direction (voiceover, music vibe)
  | 'sfx';         // sound-effect cues

export interface SlotConstraint {
  /** Soft cap on words / characters. Filler must respect this. */
  maxWords?: number;
  maxChars?: number;
  /** Phrases the slot must NOT contain. Brand-banned phrases override. */
  bannedPhrases?: string[];
  /** When true, the slot MUST cite a VerifiedClaim — model output that
   *  doesn't include {claimId, sourceUrl} fails validation and the
   *  entire draft is rejected. */
  requireCitation?: boolean;
  /** Minimum tonal-fit score for this slot's text (0..1). */
  minTonalFit?: number;
  /** Tone descriptor: 'punchy' | 'curious' | 'wry' | etc. — guides the LLM. */
  toneHint?: string;
}

export interface TemplateSlot {
  id: string;
  kind: SlotKind;
  /** Operator-readable description shown in the slot editor. */
  description: string;
  constraints: SlotConstraint;
  /** Optional 1-3 in-context exemplars to show the LLM what "good" looks
   *  like for this slot in this brand's voice. */
  examples?: string[];
}

export interface Template {
  id: string;
  /** UI label. */
  label: string;
  channel: Channel;
  /** Format hint for media routing (Phase 7 multi-model media router). */
  format: 'text' | 'image' | 'carousel' | 'short_video' | 'long_video' | 'audio';
  /** Recommended duration / length. */
  recommendedDurationSec?: number;
  recommendedSlideCount?: number;
  /** Ordered slots — these become typed fields the LLM fills. */
  slots: TemplateSlot[];
  /** Hooks compatible with this template. Cross-product with brand-fit
   *  in the Hook selector. */
  compatibleHooks: HookId[];
}

export type HookId =
  /** "Why [Brand] is doing the opposite of [Trend]" */
  | 'challenger'
  /** "The tech / story behind [Trend], explained" */
  | 'educator'
  /** Self-aware, anti-marketing wit. Only when CRINGE is low. */
  | 'comedian'
  /** "Here's what we'd actually do — and why." */
  | 'expert_reaction'
  /** "[Trend] proves [Brand]'s thesis from [N months ago]." */
  | 'told_you_so'
  /** Acknowledge without engaging the controversy. SAFE_PIVOT default. */
  | 'meta_observer'
  /** Take a defined stance contrasting the noise. SAFE_PIVOT positional. */
  | 'positional';

export interface Hook {
  id: HookId;
  label: string;
  /** One-line angle description. */
  angle: string;
  /** Risk profile — used to gate selection per brand. */
  riskLevel: 'safe' | 'edgy' | 'spicy';
  /** Predicate: does this hook fit the brand? */
  fitsBrand: (b: BrandProfile) => boolean;
}

export interface Context {
  signal: RawSignal;
  scoreResult: ScoreResult;
  brand: BrandProfile;
  /** Citation-backed claims from the Verifier. */
  claims: VerifiedClaim[];
  /** Unverified claims — listed for the LLM to AVOID, never to use. */
  forbiddenClaims: Array<{ key: string; reason: string }>;
  /** Optional Resonance output — "why now" justification + brand persona. */
  resonance?: {
    whyNow: string;
    ironicAlignmentMultiplier: number;
  };
}

export interface FilledSlot {
  slotId: string;
  value: string;
  /** When the slot has requireCitation=true, this MUST reference a real claim. */
  citedClaimId?: string;
  citedSourceUrl?: string;
  /** Any validator warnings (e.g. word-count exceeded, soft tone-fit miss). */
  warnings: string[];
}

export interface TypedDraft {
  templateId: string;
  hookId: HookId;
  channel: Channel;
  slots: FilledSlot[];
  /** Computed summary metrics for the dashboard / drawer UI. */
  totalWordCount: number;
  hasUnresolvedCitations: boolean;
  /** When false, validation failed and the draft cannot ship. */
  isShippable: boolean;
  /** Validation reasons (pass + fail) — surfaces in the drawer. */
  validation: Array<{ slotId: string; ok: boolean; reason: string }>;
}
