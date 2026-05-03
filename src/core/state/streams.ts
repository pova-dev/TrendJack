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
} as const;

export type StreamName = (typeof STREAMS)[keyof typeof STREAMS]['name'];
