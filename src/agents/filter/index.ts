// Filter Agent.
//
// Consumes raw signals from the Scout via STREAMS.rawSignals, computes
// the full scoring (including CVS / Jacking Score with R / Sp / SAT_eff
// inputs when available), and publishes scored trends downstream via
// STREAMS.scoredTrends.
//
// Triggers two side-channel streams when thresholds are crossed:
//   - STREAMS.alerts        on POST_NOW + crisis-mode trends
//   - shouldVerify=true     when CVS ≥ AUTO_VERIFY_THRESHOLD (Phase 6 Verifier
//                           subscribes to scoredTrends and acts on this flag)
//
// This agent is the canonical "one place where scoring happens". The
// legacy synchronous path in lib/ingest.ts still scores inline for now
// (so the dashboard stays populated during the transition); when this
// agent is fully wired into production we'll delete that inline path.
//
// Composition:
//   - Cross-source spillover lookup is computed once per batch by the
//     Architect (Phase 8); for now we pass crossSourceCount=1 by default.
//     Filter Agent re-scores when the spillover lookup changes.
//   - Reproduction rate is computed from the trend's TrendSample series
//     by the Architect — when present, Filter passes it through.

import type { BrandProfile } from '@/types';
import type { RawSignal, ScoreResult } from '@/src/core/scoring';
import { score, AUTO_VERIFY_THRESHOLD } from '@/src/core/scoring';
import type { StateBus, RawSignalMessage } from '@/src/core/state';
import { STREAMS } from '@/src/core/state';

export interface FilterAgentDeps {
  bus: StateBus;
  /** Brand resolver — Filter Agent doesn't load brands directly; the
   *  Architect supplies them via this function so multi-tenant Filter
   *  workers can share a brand cache. */
  loadBrand: (brandId: string) => Promise<BrandProfile | null>;
  /** Optional cascade-input enricher. Returns R, Sp, hoursSinceClaim for
   *  a given trend. Default returns no enrichment (CVS reduces to S_max). */
  enrichSignal?: (signal: RawSignal, brandId: string) => Promise<{
    reproductionRate?: number;
    crossSourceCount?: number;
    hoursSinceCompetitorClaim?: number;
    brandPostCountForTrend?: number;
  }>;
  /** Consumer group name on the bus. Defaults to 'filter-agent'. */
  consumerGroup?: string;
}

export interface FilterAgentHandle {
  stop: () => void;
}

/**
 * Start the Filter Agent. Subscribes to STREAMS.rawSignals and runs
 * indefinitely until the returned handle's stop() is called.
 */
export function startFilterAgent(deps: FilterAgentDeps): FilterAgentHandle {
  const group = deps.consumerGroup ?? 'filter-agent';
  const enrich = deps.enrichSignal ?? (async () => ({}));

  const unsub = deps.bus.subscribe(
    STREAMS.rawSignals,
    async (msg) => {
      const body: RawSignalMessage = msg.body;
      try {
        const brand = await deps.loadBrand(body.brandId);
        if (!brand) {
          // Drop with ack — brand was deleted between Scout publish and
          // Filter consume. Don't redeliver; the trend has nowhere to go.
          await deps.bus.ack(STREAMS.rawSignals.name, msg.id);
          return;
        }

        const enrichment = await enrich(body.signal, body.brandId);
        const scoreResult = score(body.signal, {
          brand,
          ...enrichment,
        });

        await deps.bus.publish(STREAMS.scoredTrends, {
          signal: body.signal,
          scoreResult,
          brandId: body.brandId,
          fetchedAt: body.fetchedAt,
          shouldVerify: scoreResult.jackingScore >= AUTO_VERIFY_THRESHOLD,
        });

        // Side-channel: POST_NOW or ESCALATE → emit an alert event.
        // The dashboard renders these immediately; push notifications
        // wire to this stream in Phase 8.
        if (scoreResult.recommendation === 'POST_NOW' || scoreResult.recommendation === 'ESCALATE') {
          await deps.bus.publish(STREAMS.alerts, {
            brandId: body.brandId,
            source: body.signal.source,
            level: scoreResult.recommendation === 'ESCALATE' ? 'critical' : 'warn',
            title: scoreResult.recommendation === 'POST_NOW'
              ? `🔥 POST_NOW: ${body.signal.title.slice(0, 60)}`
              : `⚠ ESCALATE: ${body.signal.title.slice(0, 60)}`,
            body: scoreResult.recommendationReason,
            emittedAt: new Date(),
          });
        }

        await deps.bus.ack(STREAMS.rawSignals.name, msg.id);
      } catch (err) {
        // Don't ack on error — let the bus redelivery loop pick it up.
        // Architect Agent (Phase 8) reads pending() to surface stuck
        // messages and DLQ-route after maxRedeliveries.
        const reason = (err as Error).message;
        // eslint-disable-next-line no-console
        console.error(`[filter-agent] failed to process ${msg.id}:`, reason);
      }
    },
    { group, consumerName: `filter-${process.pid ?? 'inproc'}` },
  );

  return {
    stop: () => unsub(),
  };
}

/**
 * One-shot scoring helper for callers that already have a brand + signal
 * and don't want the bus indirection. Used by the legacy ingest path
 * (lib/ingest.ts) and by tests.
 */
export function scoreRawSignal(
  signal: RawSignal,
  brand: BrandProfile,
  enrichment: {
    reproductionRate?: number;
    crossSourceCount?: number;
    hoursSinceCompetitorClaim?: number;
    brandPostCountForTrend?: number;
  } = {},
): ScoreResult {
  return score(signal, { brand, ...enrichment });
}
