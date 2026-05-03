// Seed mock trends for a freshly-created brand. Lets new users see a working
// dashboard within seconds of signup.

import { prisma } from './db';
import { getAllMockSignals } from '@/lib/connectors/mock';
import { score } from '@/lib/scoring/engine';
import { getBrand } from './store';
import { pickSeedForBrand } from './seed-corpora';

export async function seedTrendsForBrand(brandId: string) {
  const brand = await getBrand(brandId);
  if (!brand) throw new Error('brand_not_found');
  // Category-aware seed corpus pick. Falls back to the legacy mock signals
  // (POVA-flavored) only when the brand's category text doesn't match any
  // known bucket — preserves backwards compatibility for existing flows
  // that don't pass a recognizable category.
  const categorySeed = pickSeedForBrand(brand.category, brand.name);
  const signals = categorySeed.length > 0 ? categorySeed : getAllMockSignals();

  for (const s of signals) {
    const r = score(s, { brand });
    await prisma.trend.create({
      data: {
        brandId,
        source: s.source,
        sourceRef: `${s.source}:seed:${Math.random().toString(36).slice(2, 8)}`,
        title: s.title,
        summary: s.summary,
        hashtags: JSON.stringify(s.hashtags),
        lineage: s.lineage,
        catalyst: s.catalyst,
        firstSeenAt: s.firstSeenAt,
        peakWindowEnd: r.peakWindowEnd,
        velocity: s.velocity,
        reach: BigInt(s.reach),
        sentiment: s.sentiment,
        audienceOverlap: r.scores.audienceOverlap,
        scores: JSON.stringify(r.scores),
        rationale: JSON.stringify(r.rationale),
        recommendation: r.recommendation,
        recommendationReason: r.recommendationReason,
        competitorClaimed: s.competitorClaimants.length > 0,
        competitorClaimants: JSON.stringify(s.competitorClaimants),
        formatFatigue: s.formatFatigue,
        examples: JSON.stringify(s.examples ?? []),
        url: s.url ?? null,
      },
    });
  }
}
