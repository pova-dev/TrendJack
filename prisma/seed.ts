// DB seed: persists the same POVA brand profile and mock signals that the
// in-memory store uses. Run via `npm run db:seed` once you flip Phase 2 on
// and want a real database.

import { PrismaClient } from '@prisma/client';
import { DEFAULT_WEIGHTS } from '../types';
import { getAllMockSignals } from '../lib/connectors/mock';
import { score } from '../lib/scoring/engine';

const prisma = new PrismaClient();

async function main() {
  await prisma.trend.deleteMany();
  await prisma.brand.deleteMany();

  const brand = await prisma.brand.create({
    data: {
      id: 'brand_pova',
      name: 'POVA',
      category: 'Smartphones / consumer tech',
      markets: JSON.stringify(['India', 'SEA', 'MEA']),
      audience: JSON.stringify({
        primary: ['Gen Z', 'young professionals', 'students', 'gamers', 'creators'],
        age: '18-28',
        psychographics: ['mobile-first', 'value-conscious', 'spec-aware', 'irony-fluent'],
      }),
      tone: JSON.stringify({
        voice: 'Sharp. Direct. Confident. Anti-cliché.',
        tagline: "Built for What's Next.",
        bannedPhrases: ['unleash your potential', 'best version of yourself', 'level up', 'redefine'],
        allowedJokes: ['battery', 'thermal', 'thin', 'gaming'],
        forbiddenStyles: ['lifestyle warmth', 'motivational cliché', 'forced Gen Z slang'],
      }),
      bannedTopics: JSON.stringify(['politics', 'religion', 'caste', 'tragedy', 'lawsuit']),
      safeThemes: JSON.stringify(['battery', 'gaming', 'thermal', 'design', 'thin', 'curve', 'budget']),
      competitors: JSON.stringify(['Xiaomi', 'Realme', 'iQOO', 'Samsung']),
      priorityPlatforms: JSON.stringify(['x', 'youtube', 'reddit', 'tiktok']),
      contentGoal: 'engagement + brand-fit relevance for Gen Z buyers',
      riskTolerance: 'medium',
      approvalMode: 'moderate',
      crisisMode: false,
      scoringWeights: JSON.stringify(DEFAULT_WEIGHTS),
    },
  });

  const signals = getAllMockSignals();
  for (const s of signals) {
    const r = score(s, {
      brand: {
        ...brand,
        markets: JSON.parse(brand.markets),
        audience: JSON.parse(brand.audience),
        tone: JSON.parse(brand.tone),
        bannedTopics: JSON.parse(brand.bannedTopics),
        safeThemes: JSON.parse(brand.safeThemes),
        competitors: JSON.parse(brand.competitors),
        priorityPlatforms: JSON.parse(brand.priorityPlatforms),
        scoringWeights: JSON.parse(brand.scoringWeights),
        riskTolerance: brand.riskTolerance as 'low' | 'medium' | 'high',
        approvalMode: brand.approvalMode as 'strict' | 'moderate' | 'fast',
      },
    });
    await prisma.trend.create({
      data: {
        brandId: brand.id,
        source: s.source,
        sourceRef: `${s.source}:seed`,
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
      },
    });
  }
  console.log(`Seeded brand=${brand.id}, trends=${signals.length}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
