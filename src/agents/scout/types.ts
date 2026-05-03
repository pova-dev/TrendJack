// Scout Agent — types.
//
// The Scout's job is the simplest in the pipeline: pull from every
// configured connector and emit normalized RawSignals. It does NO scoring,
// NO persistence, NO brand-fit decisions. Those belong to the Filter Agent.
//
// Multiple Scouts can run in parallel (one per source) — they don't share
// state with each other; each owns its own connector + backoff state.

import type { RawSignal } from '@/src/core/scoring/types';
import type { Connector } from '@/lib/connectors/types';

export interface ScoutContext {
  brandId: string;
  brandName: string;
  /** Brand-keyword search terms — passed to connectors as their primary
   *  fan-out queries. */
  brandKeywords: string[];
  /** Competitor names — secondary fan-out + competitorClaimants tagging. */
  competitors: string[];
  /** Theme keywords — tertiary fan-out. */
  themes: string[];
  /** Lookback window. Connectors should ignore content older than this. */
  since: Date;
  /** Per-org credential bag (X bearer token, Reddit UA, YouTube key, etc). */
  credentials: Record<string, string>;
}

export interface ScoutPollOutcome {
  /** ID of the connector that produced this outcome. */
  connectorId: string;
  /** Source kind (e.g. 'reddit', 'news'). */
  source: string;
  /** Wall-clock latency for this poll. */
  latencyMs: number;
  /** Successfully fetched signals (empty if !ok). */
  signals: RawSignal[];
  /** True iff connector returned ok=true. */
  ok: boolean;
  /** If !ok, the connector-supplied reason string. */
  reason?: string;
}

export interface ScoutRunReport {
  brandId: string;
  startedAt: Date;
  totalLatencyMs: number;
  outcomes: ScoutPollOutcome[];
  /** Convenience accessor — flattened list of all RawSignals across sources. */
  signals: RawSignal[];
  /** Connector IDs whose latest poll failed. */
  failed: string[];
}

/** Function shape for any connector run by a Scout. Lets us swap in mocks
 *  for tests without using the full Connector class. */
export type ConnectorFn = (ctx: ScoutContext) => Promise<{
  ok: boolean;
  signals: RawSignal[];
  reason?: string;
}>;

/** Builds a ConnectorFn from any object satisfying the Connector interface. */
export function connectorFn(c: Connector): ConnectorFn {
  return async (ctx) => {
    const result = await c.poll({
      since: ctx.since,
      brandKeywords: ctx.brandKeywords,
      competitors: ctx.competitors,
      themes: ctx.themes,
      limit: 50,
      credentials: ctx.credentials,
    });
    if (result.ok) {
      return { ok: true, signals: result.signals };
    }
    return { ok: false, signals: [], reason: result.reason };
  };
}
