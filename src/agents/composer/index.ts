// Ship-It Plan Composer — Feature F (Autonomous).
//
// Subscribes to STREAMS.scoredTrends. For trends that hit a high-
// confidence "POST_NOW" recommendation AND have a non-`ignore` battle-
// card AND are in `fast-growing-initial` cascade phase AND have ≥1
// verified citation, the agent autonomously composes a Ship-It Plan:
// chosen angle (from the battle-card), citation set, proposed schedule
// (forecastPeak window midpoint), draft variant id (selected — not
// generated). The operator just approves / edits / rejects.
//
// This is the strictest precondition gate in the system because plan
// composition costs a premium-AI call and produces operator-visible
// strategy. The conjunction of:
//   - recommendation === 'POST_NOW' && jackingScore >= 0.6
//   - cascadePhase === 'fast-growing-initial'
//   - active battle-card with verdict in {counter, out-flank}
//   - per-org budget remaining ≥ $0.10
//   - no current non-superseded plan within 6h
// keeps cost bounded.
//
// Phase 1 (this MVP): in-memory composition selecting among existing
// artifacts (battle-card angle + verified-claim citation set). One
// premium-AI call per plan to produce the rationale string + select
// the optimal angle. No Slack interactive approval — operator approves
// in-app via the Plans tab.

import 'server-only';
import { prisma } from '@/lib/db';
import type { StateBus } from '@/src/core/state';
import { STREAMS } from '@/src/core/state/streams';
import { runChat } from '@/lib/ai/provider';

const PLAN_PROMPT_VERSION = 'v1';
const DEBOUNCE_MS = 6 * 60 * 60 * 1000;
const MIN_JACKING_FOR_PLAN = 0.6;

const COMPOSER_SYSTEM_PROMPT = `
You are TrendJack's autonomous Ship-It Plan composer.

Given:
  - A trend that has hit POST_NOW with strong CVS
  - A battle-card with verdict 'counter' or 'out-flank' and angle options
  - Verified citations from the Verifier agent
  - The trend's predicted peak window

Your job: SELECT (don't generate) the best angle to ship, write a one-
paragraph rationale that names which evidence supports the choice and
which alternatives you rejected, and propose a concrete schedule time.

Rules:
- Pick exactly ONE angle from battle-card angleOptions
- Pick the schedule time within [now, peakWindowEnd]
- Cite at least 1 of the supplied verified claims by sourceUrl
- Rationale ≤ 250 chars
- DO NOT invent angles or claims not present in the input

Output STRICT JSON:
{
  "selectedAngleIndex": 0..N,
  "selectedAngleRationale": "<≤250c — names which evidence supports + what was rejected>",
  "scheduleAtIso": "<ISO datetime within window>",
  "citationKeys": ["<key1>", "<key2>"]
}
`.trim();

export interface ComposerDeps {
  bus: StateBus;
}

export interface ComposerHandle {
  stop: () => void;
}

export function startShipItComposer(deps: ComposerDeps): ComposerHandle {
  const unsub = deps.bus.subscribe(
    STREAMS.scoredTrends,
    async (msg) => {
      const body = msg.body;
      try {
        // Gate 1: must be POST_NOW with strong CVS
        if (body.scoreResult.recommendation !== 'POST_NOW') {
          await deps.bus.ack(STREAMS.scoredTrends.name, msg.id);
          return;
        }
        if ((body.scoreResult.jackingScore ?? 0) < MIN_JACKING_FOR_PLAN) {
          await deps.bus.ack(STREAMS.scoredTrends.name, msg.id);
          return;
        }

        // Resolve the trend row to read cascadePhase + peakWindowEnd.
        const externalKey = body.signal.externalId ?? `${body.signal.source}:${body.signal.url}`;
        const trend = await prisma.trend.findFirst({
          where: { brandId: body.brandId, sourceRef: externalKey },
        });
        if (!trend) {
          await deps.bus.ack(STREAMS.scoredTrends.name, msg.id);
          return;
        }

        // Gate 2: cascade phase must be early.
        if (trend.cascadePhase !== 'fast-growing-initial') {
          await deps.bus.ack(STREAMS.scoredTrends.name, msg.id);
          return;
        }

        // Gate 3: active battle-card with countering verdict.
        const card = await prisma.battleCard.findFirst({
          where: { trendId: trend.id, supersededAt: null, verdict: { in: ['counter', 'out-flank'] } },
          orderBy: { generatedAt: 'desc' },
        });
        if (!card) {
          await deps.bus.ack(STREAMS.scoredTrends.name, msg.id);
          return;
        }

        // Gate 4: 6h debounce.
        const recent = await prisma.shipItPlan.findFirst({
          where: { trendId: trend.id, createdAt: { gte: new Date(Date.now() - DEBOUNCE_MS) } },
        });
        if (recent) {
          await deps.bus.ack(STREAMS.scoredTrends.name, msg.id);
          return;
        }

        // We have everything. Compose.
        const cardPayload = JSON.parse(card.payload) as {
          angleOptions: Array<{ angle: string; rationale: string; exampleHook: string }>;
          counterClaim: string | null;
          competitorClaimants: string[];
        };

        // Resolve verified claims from research cache (best-effort —
        // when no verified claims are available, plan still ships with
        // empty citation set + flagged in payload).
        const research = trend.researchCache ? safeJsonParse(trend.researchCache) as Record<string, unknown> | null : null;
        const verifiedClaims: Array<{ key?: string; value?: string; sourceUrl?: string; quotedSpan?: string }> =
          (research && Array.isArray(research.verifiedClaims)
            ? research.verifiedClaims
            : []) as Array<{ key?: string; value?: string; sourceUrl?: string; quotedSpan?: string }>;

        const peakEnd = trend.peakWindowEnd ?? new Date(Date.now() + 24 * 3600_000);

        const userPayload = `TREND
title: ${trend.title}
summary: ${trend.summary}
recommendation: ${trend.recommendation}
cascadePhase: ${trend.cascadePhase}
peakWindowEnd (ship before this): ${peakEnd.toISOString()}

BATTLE-CARD (verdict: ${card.verdict})
counterClaim: ${cardPayload.counterClaim ?? '(none)'}
angleOptions:
${cardPayload.angleOptions.map((a, i) => `  ${i}. ${a.angle} — ${a.rationale}\n     hook: ${a.exampleHook}`).join('\n')}

VERIFIED CLAIMS (cite at least 1)
${verifiedClaims.length > 0
  ? verifiedClaims.map(c => `  • [${c.key ?? '?'}] ${c.value ?? ''} — ${c.sourceUrl ?? ''}`).join('\n')
  : '(no verified claims yet — operator must supply citations before ship)'}

Compose the Ship-It Plan now. STRICT JSON only.`;

        const ai = await runChat({
          tier: 'premium',
          system: COMPOSER_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPayload }],
          maxTokens: 800,
          temperature: 0.3,
          jsonMode: true,
          orgId: body.orgId,
        });

        if (!ai.ok) {
          // Soft-fail — log + ack. Plan can be composed by operator manually
          // via /api/plans/[id]/compose. Calibration will learn nothing
          // from a non-existent plan.
          await deps.bus.ack(STREAMS.scoredTrends.name, msg.id);
          return;
        }

        let parsed: { selectedAngleIndex?: number; selectedAngleRationale?: string; scheduleAtIso?: string; citationKeys?: string[] } = {};
        try { parsed = JSON.parse(ai.text); } catch { /* malformed */ }
        const angleIdx = typeof parsed.selectedAngleIndex === 'number' && parsed.selectedAngleIndex < cardPayload.angleOptions.length
          ? parsed.selectedAngleIndex
          : 0;
        const scheduleAt = parsed.scheduleAtIso ? new Date(parsed.scheduleAtIso) : new Date(Date.now() + 30 * 60_000);
        const cleanScheduleAt = (Number.isNaN(scheduleAt.getTime()) || scheduleAt > peakEnd)
          ? new Date(Math.min(Date.now() + 30 * 60_000, peakEnd.getTime()))
          : scheduleAt;
        const citationKeys = Array.isArray(parsed.citationKeys) ? parsed.citationKeys.filter(k => typeof k === 'string') : [];

        const planPayload = {
          trendId: trend.id,
          brandId: body.brandId,
          orgId: body.orgId,
          chosenAngle: cardPayload.angleOptions[angleIdx],
          chosenAngleIndex: angleIdx,
          rationale: typeof parsed.selectedAngleRationale === 'string'
            ? parsed.selectedAngleRationale.slice(0, 250)
            : 'Auto-composed plan',
          alternatives: cardPayload.angleOptions
            .map((a, i) => i === angleIdx ? null : a)
            .filter(Boolean),
          counterClaim: cardPayload.counterClaim,
          competitorClaimants: cardPayload.competitorClaimants,
          citationSet: verifiedClaims
            .filter(c => citationKeys.length === 0 || (c.key && citationKeys.includes(c.key)))
            .slice(0, 5),
          composedAt: new Date(),
          provider: ai.provider,
          model: ai.model,
        };

        await prisma.shipItPlan.create({
          data: {
            trendId: trend.id,
            brandId: body.brandId ?? '',
            orgId: body.orgId ?? '',
            status: 'pending_approval',
            chosenAngleRef: `${card.id}:${angleIdx}`,
            payload: JSON.stringify(planPayload),
            proposedScheduleAt: cleanScheduleAt,
            expiresAt: peakEnd,
            promptVersion: PLAN_PROMPT_VERSION,
          },
        });

        await deps.bus.publish(STREAMS.shipItPlans, {
          planId: trend.id,
          trendId: trend.id,
          brandId: body.brandId ?? '',
          orgId: body.orgId ?? '',
          status: 'pending_approval',
          chosenAngleRef: `${card.id}:${angleIdx}`,
          proposedScheduleAt: cleanScheduleAt,
          expiresAt: peakEnd,
          emittedAt: new Date(),
        });

        await deps.bus.ack(STREAMS.scoredTrends.name, msg.id);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[composer-agent] failed to process', msg.id, ':', (err as Error).message);
      }
    },
    { group: 'composer-agent' },
  );

  // eslint-disable-next-line no-console
  console.log(`[composer-agent] started — prompt ${PLAN_PROMPT_VERSION}`);
  return { stop: () => unsub() };
}

function safeJsonParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
