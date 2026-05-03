// Battle-Card Agent — subscribes to STREAMS.lineage and generates a
// Win/Loss strategy card when a trend is dilutive (competitor SoV ≥
// 40%) or has explicit competitor claimants.
//
// Cost gating (per Rational Thinker roadmap, Feature C, three layers):
//   1. runChat() inside the generator already enforces per-org daily
//      budget via lib/ai/budget. Skipped here.
//   2. saturation > 0.6 short-circuits to a deterministic 'ignore'
//      verdict — no LLM call.
//   3. 6h debounce: if a trend already has a current (non-superseded)
//      card less than 6h old, skip regeneration.
//
// Persistence: writes to the BattleCard table with @unique on trendId,
// supersedes the previous card by setting supersededAt.

import 'server-only';
import type { StateBus } from '@/src/core/state';
import { STREAMS } from '@/src/core/state/streams';
import type { BrandProfile } from '@/types';
import { generateBattleCard } from './generator';
import { PROMPT_VERSION } from './prompts.v1';
import type { BattleCard } from './schema';

const DEBOUNCE_MS = 6 * 60 * 60 * 1000;
const SATURATION_IGNORE_FLOOR = 0.6;

export interface BattleCardAgentDeps {
  bus: StateBus;
  /** Returns the brand profile for a brandId. Same shape as Filter Agent uses. */
  loadBrand: (brandId: string) => Promise<BrandProfile | null>;
  /** Looks up the current (non-superseded) card and the underlying trend
   *  + scoreResult for the generator. Implemented by lib/agents-boot
   *  to avoid a Prisma import inside the agent boundary. */
  loadTrendContext: (trendId: string) => Promise<{
    /** ms epoch — null when no current card */
    currentCardGeneratedAt: number | null;
    /** raw signal reconstructed from the Trend row */
    signal: import('@/src/core/scoring/types').RawSignal | null;
    /** scoring result reconstructed from the persisted scores JSON */
    scoreResult: import('@/src/core/scoring/types').ScoreResult | null;
    /** orgId the trend's brand belongs to */
    orgId: string | null;
    /** brand-scoped credentials for the runChat call */
    credentials: Record<string, string>;
  }>;
  /** Persist a freshly-generated card. Sets supersededAt on the previous
   *  card for this trend (if any) and inserts a new row. */
  persistCard: (input: {
    trendId: string;
    brandId: string;
    orgId: string;
    card: BattleCard;
    promptVersion: string;
    costUsd: number;
  }) => Promise<void>;
  /** Persist a deterministic short-circuit card (no LLM cost). Same
   *  supersession behavior. */
  persistShortCircuitCard: (input: {
    trendId: string;
    brandId: string;
    orgId: string;
    verdict: 'ignore' | 'monitor';
    verdictReason: string;
    saturationScore: number;
    competitorClaimants: string[];
  }) => Promise<void>;
}

export interface BattleCardAgentHandle {
  stop: () => void;
}

export function startBattleCardAgent(deps: BattleCardAgentDeps): BattleCardAgentHandle {
  const unsub = deps.bus.subscribe(
    STREAMS.lineage,
    async (msg) => {
      const body = msg.body;
      try {
        // Trigger filter: only act on dilutive lineage events OR cards
        // where competitors are present. Other lineage events (cluster
        // formation without competitor presence) are not battle-card
        // material.
        const hasCompetitor = body.competitorClaimants.length > 0;
        if (!body.isDilutive && !hasCompetitor) {
          await deps.bus.ack(STREAMS.lineage.name, msg.id);
          return;
        }

        // Debounce: skip if there's a recent card for this trend.
        const ctx = await deps.loadTrendContext(body.trendId);
        if (ctx.currentCardGeneratedAt && Date.now() - ctx.currentCardGeneratedAt < DEBOUNCE_MS) {
          await deps.bus.ack(STREAMS.lineage.name, msg.id);
          return;
        }
        if (!ctx.signal || !ctx.scoreResult || !ctx.orgId) {
          // Couldn't reconstruct context — drop with ack (the trend may
          // have been deleted between lineage emit and our consume).
          await deps.bus.ack(STREAMS.lineage.name, msg.id);
          return;
        }

        const brand = await deps.loadBrand(body.brandId);
        if (!brand) {
          await deps.bus.ack(STREAMS.lineage.name, msg.id);
          return;
        }

        // Saturation short-circuit: deterministic ignore — no LLM cost.
        if (ctx.scoreResult.scores.saturation > SATURATION_IGNORE_FLOOR) {
          await deps.persistShortCircuitCard({
            trendId: body.trendId,
            brandId: body.brandId,
            orgId: ctx.orgId,
            verdict: 'ignore',
            verdictReason: `Saturation ${Math.round(ctx.scoreResult.scores.saturation * 100)}% — competitor SoV ${Math.round(body.competitorShareOfVoice * 100)}%. Doubling-down would be dilutive.`,
            saturationScore: ctx.scoreResult.scores.saturation,
            competitorClaimants: body.competitorClaimants,
          });
          await deps.bus.ack(STREAMS.lineage.name, msg.id);
          return;
        }

        // Generate via LLM.
        const result = await generateBattleCard({
          signal: ctx.signal,
          scoreResult: ctx.scoreResult,
          brand,
          brandId: body.brandId,
          orgId: ctx.orgId,
          credentials: ctx.credentials,
        });

        if (result.ok) {
          await deps.persistCard({
            trendId: body.trendId,
            brandId: body.brandId,
            orgId: ctx.orgId,
            card: result.card,
            promptVersion: result.promptVersion,
            costUsd: result.costUsd,
          });
        } else if (result.error === 'budget_exhausted') {
          // Soft-fail: persist a monitor card with a clear note so the
          // operator knows budget exhaustion (not a real verdict).
          await deps.persistShortCircuitCard({
            trendId: body.trendId,
            brandId: body.brandId,
            orgId: ctx.orgId,
            verdict: 'monitor',
            verdictReason: 'Battle-card skipped — daily AI budget exhausted for this org.',
            saturationScore: ctx.scoreResult.scores.saturation,
            competitorClaimants: body.competitorClaimants,
          });
        }
        // Other errors: log and skip silently. Lineage will fire again
        // on the next cycle.

        await deps.bus.ack(STREAMS.lineage.name, msg.id);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[battlecard-agent] failed to process ${msg.id}:`, (err as Error).message);
      }
    },
    { group: 'battlecard-agent' },
  );

  // eslint-disable-next-line no-console
  console.log(`[battlecard-agent] started — prompt version ${PROMPT_VERSION}`);
  return { stop: () => unsub() };
}

export type { BattleCard, BattleCardVerdict, BattleCardAngle } from './schema';
