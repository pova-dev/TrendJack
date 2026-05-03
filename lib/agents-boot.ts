// Production boot — wires the agentic pipeline into the live runtime.
//
// Runs once per Node process (idempotent via a module-level flag) when
// the dashboard layout first renders. The cron (lib/cron.ts) drives
// Scout polling; Scout publishes to STREAMS.rawSignals; Filter / Verifier
// / Architect subscribe and process from there.
//
// Architecture during the migration window:
//   - Scout publishes raw signals to the bus (dryRun=false)
//   - The legacy synchronous score+persist loop in lib/ingest.ts still
//     writes the DB, so dashboard data continues to flow.
//   - Filter Agent subscribes and re-scores in parallel — currently
//     produces telemetry only (does not double-write to DB). Once we've
//     verified parity over a full ingest cycle the inline score+persist
//     in lib/ingest.ts can be deleted in favor of the Filter Agent path.
//   - Verifier subscribes to scoredTrends and stubs (no premium-AI calls
//     until ANTHROPIC_API_KEY / etc. are wired in via the verifier
//     adapter swap).
//   - Architect monitors pending() for stuck messages.

import 'server-only';
import { getBus } from '@/src/core/state';
import { startFilterAgent } from '@/src/agents/filter';
import { startVerifierAgent, stubVerifier, makeLlmVerifier } from '@/src/agents/verifier';
import { aiHealth } from '@/lib/ai/provider';
import { startArchitectAgent } from '@/src/agents/architect';
import { bootstrapConnectors } from '@/src/connectors';
import { getBrand, persistScoredTrend, getTrend } from './store';
import { enrichSignal } from './enrichment';
import { startPushDeliveryWorker } from './push-delivery';
import { startBattleCardAgent } from '@/src/agents/battlecard';
import { getOrgCredentials } from './credentials';
import { prisma } from './db';
import type { RawSignal, ScoreResult } from '@/src/core/scoring/types';

interface AgentRunState {
  startedAt: Date;
  filterRunning: boolean;
  verifierRunning: boolean;
  architectRunning: boolean;
  stuckMessages: number;
}

declare global {
  var __tj_agents_boot__: AgentRunState | undefined;
}

export function bootAgents(): AgentRunState {
  if (globalThis.__tj_agents_boot__) {
    return globalThis.__tj_agents_boot__;
  }

  bootstrapConnectors();

  const bus = getBus();

  startFilterAgent({
    bus,
    loadBrand: async (brandId) => getBrand(brandId),
    enrichSignal: async (signal, brandId) => enrichSignal(signal, brandId),
    persistTrend: async (signal, scoreResult, brandId) => {
      await persistScoredTrend(signal, scoreResult, brandId);
    },
  });

  // Pick the LLM-backed Verifier when env-level credentials exist;
  // org-level credentials override per-call inside the adapter. If
  // nothing is configured we fall through to the stub (echoes title +
  // URL only — no fabrication, no premium-AI calls).
  const health = aiHealth({});
  const aiReady = health.anthropic || health.openai || health.google || health.openrouter;
  startVerifierAgent({
    bus,
    adapter: aiReady ? makeLlmVerifier() : stubVerifier,
  });

  let stuckMessages = 0;
  startArchitectAgent({
    bus,
    onStuck: () => { stuckMessages++; },
    monitorGroups: ['filter-agent', 'verifier-agent', 'push-delivery', 'battlecard-agent'],
  });

  // Push-delivery worker — subscribes to STREAMS.alerts and fans out
  // Web Push notifications to PushSubscription rows for the alerted
  // brand. Idle when PUSH_VAPID_* env vars are missing.
  startPushDeliveryWorker();

  // Battle-Card agent — subscribes to STREAMS.lineage. The lineage-cron
  // emits dilutive / competitor-claimed reports each tick; agent
  // generates strategy cards via premium AI (with saturation>0.6
  // short-circuit + 6h debounce). Always boots — runChat() falls back
  // to per-org credentials threaded through loadTrendContext, so an
  // org with API keys configured via the UI works even without
  // env-level keys at boot time.
  {
    startBattleCardAgent({
      bus,
      loadBrand: async (brandId) => getBrand(brandId),
      loadTrendContext: async (trendId) => {
        const t = await getTrend(trendId);
        if (!t) return { currentCardGeneratedAt: null, signal: null, scoreResult: null, orgId: null, credentials: {} };
        const brandRow = await prisma.brand.findUnique({ where: { id: t.brandId }, select: { orgId: true } });
        const card = await prisma.battleCard.findFirst({
          where: { trendId, supersededAt: null },
          orderBy: { generatedAt: 'desc' },
          select: { generatedAt: true },
        });
        const credentials = brandRow?.orgId ? await getOrgCredentials(brandRow.orgId) : {};
        const signal: RawSignal = {
          source: t.source,
          title: t.title,
          summary: t.summary,
          hashtags: t.hashtags,
          lineage: t.lineage,
          catalyst: t.catalyst,
          firstSeenAt: new Date(t.firstSeenAt),
          velocity: t.velocity,
          reach: Number(t.reach),
          sentiment: t.sentiment,
          competitorClaimants: t.competitorClaimants,
          formatFatigue: t.formatFatigue ?? 0,
          examples: t.examples,
          url: t.url,
          externalId: t.sourceRef,
        };
        const scoreResult: ScoreResult = {
          scores: t.scores,
          rationale: t.rationale,
          recommendation: t.recommendation,
          recommendationReason: t.recommendationReason,
          peakWindowEnd: t.peakWindowEnd ? new Date(t.peakWindowEnd) : new Date(),
          jackingScore: t.scores.jackingScore ?? 0,
          brandKeywordHit: t.brandKeywordHit ?? false,
          matchedBrandKeywords: t.matchedBrandKeywords ?? [],
        };
        return {
          currentCardGeneratedAt: card?.generatedAt.getTime() ?? null,
          signal,
          scoreResult,
          orgId: brandRow?.orgId ?? null,
          credentials,
        };
      },
      persistCard: async ({ trendId, brandId, orgId, card, promptVersion, costUsd }) => {
        await prisma.battleCard.updateMany({
          where: { trendId, supersededAt: null },
          data: { supersededAt: new Date() },
        });
        await prisma.battleCard.create({
          data: {
            trendId, brandId, orgId,
            verdict: card.verdict,
            verdictReason: card.verdictReason,
            payload: JSON.stringify(card),
            cost: costUsd,
            promptVersion,
          },
        });
      },
      persistShortCircuitCard: async ({ trendId, brandId, orgId, verdict, verdictReason, saturationScore, competitorClaimants }) => {
        const card = {
          trendId, brandId, verdict, verdictReason,
          saturationScore, competitorClaimants,
          angleOptions: [], counterClaim: null, doNotDo: [],
          generatedAt: new Date(),
          provider: 'system', model: 'short-circuit',
        };
        await prisma.battleCard.updateMany({
          where: { trendId, supersededAt: null },
          data: { supersededAt: new Date() },
        });
        await prisma.battleCard.create({
          data: {
            trendId, brandId, orgId,
            verdict, verdictReason,
            payload: JSON.stringify(card),
            cost: 0,
            promptVersion: 'short-circuit',
          },
        });
      },
    });
  }

  const state: AgentRunState = {
    startedAt: new Date(),
    filterRunning: true,
    verifierRunning: true,
    architectRunning: true,
    get stuckMessages() { return stuckMessages; },
  } as AgentRunState;

  globalThis.__tj_agents_boot__ = state;

  // eslint-disable-next-line no-console
  console.log('[agents-boot] Filter + Verifier + Architect started — bus subscribed');
  return state;
}

export function getAgentState(): AgentRunState | null {
  return globalThis.__tj_agents_boot__ ?? null;
}
