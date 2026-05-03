// GEO (Generative Engine Optimization) agent.
//
// On a configurable cadence (default 12h), iterate every brand and:
//   1. Render the GEO prompt set against the brand profile
//   2. For each prompt × each configured model, runChat() through the
//      premium tier and parse the response for citations
//   3. Persist one BrandCitationSample per (brand × model × prompt × tick)
//
// Cost gating: every runChat() call is budget-aware (orgId forwarded).
// When isOverBudget(orgId) is true, runChat returns 'budget_exhausted'
// and we record a runFailed sample with the reason. Operators see the
// gap in the panel.
//
// Run trigger: this module exports `runGeoTickForBrand(brandId)` which
// is called from a scheduled cron. Idempotent — safe to call multiple
// times in the same window; the dashboard groups by day so duplicate
// rows just show as a denser sample.

import 'server-only';
import { prisma } from '@/lib/db';
import { runChat } from '@/lib/ai/provider';
import { getOrgCredentials } from '@/lib/credentials';
import { renderGeoPrompts, PROMPT_VERSION } from './prompts.v1';
import { parseCitation } from './parser';

/** Models we poll. Keep this list short for cost control. Operators
 *  can add their own provider keys to widen coverage; the runChat
 *  router picks the right backend per-tier. */
const GEO_MODELS = [
  // Tier 'cheap' = quick triage, low cost
  { tier: 'cheap'    as const, label: 'cheap-tier' },
  // Tier 'balanced' = the most representative model an end-user would query
  { tier: 'balanced' as const, label: 'balanced-tier' },
];

export interface GeoTickResult {
  brandId: string;
  promptCount: number;
  modelsPolled: number;
  citationsRecorded: number;
  runFailed: number;
  totalCostUsd: number;
}

export async function runGeoTickForBrand(brandId: string): Promise<GeoTickResult> {
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand) throw new Error('brand_not_found');
  const orgId = brand.orgId;

  const brandKeywords = JSON.parse(brand.brandKeywords ?? '[]') as string[];
  const competitors = JSON.parse(brand.competitors ?? '[]') as string[];
  const markets = JSON.parse(brand.markets ?? '[]') as string[];
  const market = markets[0] ?? 'global';

  // Top current trend by CVS — used by the trend-aware probe in
  // prompts.v1. Optional; null is fine.
  const topTrend = await prisma.trend.findFirst({
    where: { brandId, recommendation: { not: 'IGNORE' } },
    orderBy: { firstSeenAt: 'desc' },
    select: { title: true },
  });

  const prompts = renderGeoPrompts({
    brandCategory: brand.category,
    market,
    trendingTopic: topTrend?.title,
  });

  const credentials = await getOrgCredentials(orgId);

  const result: GeoTickResult = {
    brandId,
    promptCount: prompts.length,
    modelsPolled: GEO_MODELS.length,
    citationsRecorded: 0,
    runFailed: 0,
    totalCostUsd: 0,
  };

  for (const model of GEO_MODELS) {
    for (const prompt of prompts) {
      const ai = await runChat({
        tier: model.tier,
        system: 'Answer factually and concisely. Name specific brand names when asked.',
        messages: [{ role: 'user', content: prompt.text }],
        maxTokens: 600,
        temperature: 0.3,
        credentials,
        orgId,
      });

      if (!ai.ok) {
        await prisma.brandCitationSample.create({
          data: {
            brandId, orgId,
            model: model.label,
            promptClass: prompt.promptClass,
            promptVersion: prompt.promptVersion,
            promptText: prompt.text,
            cited: false,
            runFailed: true,
            failureReason: ai.error,
          },
        });
        result.runFailed++;
        continue;
      }

      const parsed = parseCitation(ai.text, brandKeywords, competitors);
      const cost = estimateCost(ai.model, ai.inputTokens, ai.outputTokens);

      await prisma.brandCitationSample.create({
        data: {
          brandId, orgId,
          model: ai.model || model.label,
          promptClass: prompt.promptClass,
          promptVersion: prompt.promptVersion,
          promptText: prompt.text,
          cited: parsed.cited,
          position: parsed.position,
          snippet: parsed.snippet || null,
          competitorsMentioned: JSON.stringify(parsed.competitorsMentioned),
          cost,
        },
      });
      if (parsed.cited) result.citationsRecorded++;
      result.totalCostUsd += cost;
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[geo] brand=${brand.name} prompts=${result.promptCount} models=${result.modelsPolled} citations=${result.citationsRecorded}/${result.promptCount * result.modelsPolled} cost=$${result.totalCostUsd.toFixed(4)}`);
  return result;
}

/** Light copy of the rate table — kept local so changing budget rates
 *  doesn't have to ripple through GEO. */
function estimateCost(model: string, inputTokens?: number, outputTokens?: number): number {
  if (!inputTokens && !outputTokens) return 0;
  const RATES: Record<string, [number, number]> = {
    'claude-sonnet-4-5':                     [3.0,  15.0],
    'claude-haiku-4-5':                      [1.0,   5.0],
    'gpt-4o':                                [2.5,  10.0],
    'gpt-4o-mini':                           [0.15,  0.6],
    'gemini-2.5-pro':                        [1.25, 10.0],
    'gemini-2.5-flash':                      [0.075, 0.3],
    'gemini-2.0-flash-001':                  [0.075, 0.3],
    'meta-llama/llama-3.3-70b-instruct':     [0.35,  0.4],
  };
  const r = RATES[model] ?? [1.0, 5.0];
  return ((inputTokens ?? 0) * r[0] + (outputTokens ?? 0) * r[1]) / 1_000_000;
}

export { PROMPT_VERSION } from './prompts.v1';
