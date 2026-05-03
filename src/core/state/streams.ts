// Stream identifier definitions. Each stream is typed at compile time so a
// publisher can't push the wrong shape and a consumer can't subscribe to
// something the publisher never emits.
//
// Adding a new stream:
//   1. Add the message type interface below.
//   2. Add a StreamId<T> constant in the STREAMS object.
//   3. Use STREAMS.foo as the first argument to bus.publish() / bus.subscribe().

import type { RawSignal, ScoreResult } from '@/src/core/scoring/types';
import type { SourceId } from '@/types';

/** Phantom-typed stream identifier — carries its message type in T. */
export interface StreamId<T> {
  readonly name: string;
  /** Phantom type marker — never accessed at runtime. Used by the type-checker
   *  to bind the stream id to its message type so publish/subscribe are
   *  type-safe. */
  readonly __t?: T;
}

// ---------------------------------------------------------------------------
// Message shapes per stream.

/** Emitted by Scout agents (one per connector) for every fresh poll result. */
export interface RawSignalMessage {
  signal: RawSignal;
  brandId: string;
  /** Connector that produced this — useful for telemetry + per-source budget. */
  connectorId: string;
  /** Wall-clock when Scout pulled this from the source. */
  fetchedAt: Date;
}

/** Emitted by FilterAgent after scoring + brand-fit gating. */
export interface ScoredTrendMessage {
  signal: RawSignal;
  scoreResult: ScoreResult;
  brandId: string;
  /** Org id resolved from brand. Used by the Verifier Agent to budget-gate
   *  premium-AI calls per org via lib/ai/budget. Optional during the
   *  migration window — adapters fall back to "no orgId" (Infinity quota)
   *  when this isn't present, which matches pre-budget behavior. */
  orgId?: string;
  /** Brand's risk tolerance ('low' | 'medium' | 'high'). Threaded through
   *  so the Verifier can set its claim-confidence floor per-brand:
   *  conservative brands reject 0.5 confidence claims, aggressive brands
   *  accept down to 0.2. Optional during migration — Verifier falls back
   *  to the default 0.30 floor when unset. */
  brandRiskTolerance?: string;
  fetchedAt: Date;
  /** Did the trend clear the Jacking Score threshold? Drives Verifier eligibility. */
  shouldVerify: boolean;
}

/** Emitted by VerifierAgent after claim extraction + per-claim source citations. */
export interface VerifiedTrendMessage {
  signal: RawSignal;
  scoreResult: ScoreResult;
  brandId: string;
  /** Each claim is citation-backed; unverified ones are explicitly marked. */
  claims: Array<{
    key: string;
    value: string;
    sourceUrl: string;
    quotedSpan: string;
    confidence: number;
  }>;
  unverifiedClaims: Array<{ key: string; reason: string }>;
}

/** Emitted by LineageAgent after tracing a trend back to its origin post. */
export interface LineageMessage {
  trendId: string;
  brandId: string;
  /** Origin post (Patient Zero) — the earliest detected source of the trend. */
  patientZero: {
    source: SourceId;
    url: string;
    publishedAt: Date;
    /** Short excerpt (first 200 chars of the originating post). */
    excerpt: string;
  };
  /** All cross-source siblings detected for this trend (by URL/title overlap). */
  siblings: Array<{ source: SourceId; url: string; firstSeenAt: Date }>;
  /** Competitor share-of-voice in this trend's lineage (0..1). >0.40 → SAT high. */
  competitorShareOfVoice: number;
  competitorClaimants: string[];
  /** True if competitors dominate (>40%) — Filter Agent uses this to set
   *  saturation high and flag the trend as "Dilutive". */
  isDilutive: boolean;
}

/** Emitted by ResonanceAgent after analyzing brand-fit vs cringe tension. */
export interface ResonanceMessage {
  trendId: string;
  brandId: string;
  /** Numeric resonance score (0..1) — how well does this trend fit the
   *  brand's persona vector? */
  resonance: number;
  /** "Why now" justification — operator-readable explanation of the
   *  FIT vs CRINGE balance and the recommended angle. */
  whyNow: string;
  /** Conflicts detected between brand voice and trend tone. */
  conflicts: Array<{ axis: 'voice' | 'audience' | 'topic'; reason: string }>;
}

/** Emitted by CringeDecayAgent when a trend's cringe-rise outpaces its
 *  velocity-rise — early warning that the trend has tipped from "cool" to
 *  "cringe" even if absolute volume is still growing. */
export interface CringeDecayMessage {
  trendId: string;
  brandId: string;
  /** Slope of cringe over time (per-hour delta). */
  cringeSlope: number;
  /** Slope of velocity over time (per-hour delta). */
  velocitySlope: number;
  /** True iff cringeSlope > velocitySlope (relatively). */
  hasPeaked: boolean;
}

/** Emitted when a TrendRoom decides on an angle (Feature E). The
 *  decision finalizer publishes after the room reaches quorum / is
 *  manually decided. The agent that subscribes also publishes a
 *  synthetic OperatorFeedbackMessage so the calibration engine learns
 *  from collective decisions. */
export interface RoomDecisionMessage {
  roomId: string;
  trendId: string;
  brandId: string;
  orgId: string;
  decidedBy: string;            // userId
  chosenAngleId: string;        // BattleCard angle id or Draft variant id
  rationale?: string;
  voteSummary: { angleId: string; weight: number; voters: number }[];
  decidedAt: Date;
}

/** Emitted by ShipItComposer (Feature F) when an autonomous plan is
 *  composed for an operator to approve. */
export interface ShipItPlanMessage {
  planId: string;
  trendId: string;
  brandId: string;
  orgId: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'shipped' | 'expired' | 'superseded';
  chosenAngleRef: string;       // "<battleCardId>:<angleIndex>"
  draftVariantId?: string;
  proposedScheduleAt: Date;
  expiresAt: Date;
  emittedAt: Date;
}

/** Emitted by lib/store.recordAction whenever an operator acts on a trend.
 *  Drives the Calibration Engine (Feature D) — each event is a labeled
 *  training pair (signal feature snapshot + operator decision polarity)
 *  that the calibration agent rolls up into per-(brand × axis × bucket)
 *  estimators. The estimator nudges `opportunity` ranking via an
 *  out-of-engine multiplier; CVS is never touched (CLAUDE.md rule 4). */
export interface OperatorFeedbackMessage {
  brandId: string;
  trendId: string;
  userId: string;
  /** Action taken — same union as the existing ActionType in @/types. */
  action: 'save' | 'dismiss' | 'snooze' | 'follow' | 'assign' | 'export'
        | 'approve' | 'reject' | 'generate' | 'pin' | 'unpin';
  /** Implicit polarity:
   *    save / approve / pin / generate  → +1
   *    dismiss / reject                  → -1
   *    snooze / unpin / follow / assign  →  0 (neutral; logged but not
   *                                            re-weighted into buckets)  */
  polarity: -1 | 0 | 1;
  /** Feature snapshot at the moment of action — what the operator SAW.
   *  Stored as raw numbers so re-bucketing later doesn't lose history. */
  features: {
    fit: number;
    velocity: number;
    firstMover: number;
    risk: number;
    cringe: number;
    saturation: number;
    cascadePhase: 'pre-launch' | 'fast-growing-initial' | 'peaking' | 'decaying' | null;
    brandKeywordHit: boolean;
    recommendation: string;
    opportunity: number;
  };
  /** Optional operator-supplied "why" — captured by a future "Why dismissed?"
   *  modal. Helps disambiguate "bad recommendation" from "I shipped this
   *  elsewhere already" (Phase 1 ships without the modal). */
  reason?: string;
  emittedAt: Date;
}

/** Emitted by ArchitectAgent / FilterAgent for "POST_NOW" + crisis events. */
export interface AlertMessage {
  brandId: string;
  source: SourceId;
  level: 'info' | 'warn' | 'critical';
  title: string;
  body: string;
  trendId?: string;
  emittedAt: Date;
}

// ---------------------------------------------------------------------------
// Registered streams. Add new ones here.

export const STREAMS = {
  rawSignals:      { name: 'tj.signals.raw'      } as StreamId<RawSignalMessage>,
  scoredTrends:    { name: 'tj.trends.scored'    } as StreamId<ScoredTrendMessage>,
  verifiedTrends:  { name: 'tj.trends.verified'  } as StreamId<VerifiedTrendMessage>,
  lineage:         { name: 'tj.trends.lineage'   } as StreamId<LineageMessage>,
  resonance:       { name: 'tj.trends.resonance' } as StreamId<ResonanceMessage>,
  cringeDecay:     { name: 'tj.trends.cringe-decay' } as StreamId<CringeDecayMessage>,
  alerts:          { name: 'tj.alerts'           } as StreamId<AlertMessage>,
  operatorFeedback:{ name: 'tj.operator.feedback'} as StreamId<OperatorFeedbackMessage>,
  roomDecisions:   { name: 'tj.room.decisions'   } as StreamId<RoomDecisionMessage>,
  shipItPlans:     { name: 'tj.shipit.plans'     } as StreamId<ShipItPlanMessage>,
} as const;

export type StreamName = (typeof STREAMS)[keyof typeof STREAMS]['name'];
