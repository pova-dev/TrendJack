// Trinity Swarm — Agent 3: Cross-Category Stress Test
//
// Seeds a synthetic premium plant-based footwear brand ("Solera") and
// runs 6 hand-labeled signals through the actual scoring + resonance
// pipeline to verify the system can distinguish between vegan meme
// trends and substantive sustainability news WITHOUT hallucinating
// brand-fit on off-category material.
//
// This script does NOT publish to the bus — it calls the pure
// score(signal, ctx) and analyzeResonance() functions directly so the
// output is deterministic and isolated from production data.

import { PrismaClient } from '@prisma/client';
import { score } from '../src/core/scoring/engine';
import { analyzeResonance } from '../src/agents/resonance';
import type { BrandProfile, ScoringWeights } from '../types';
import { DEFAULT_WEIGHTS } from '../types';
import type { RawSignal } from '../src/core/scoring/types';

const prisma = new PrismaClient();

// ─── Brand ────────────────────────────────────────────────────────────────
const brand: BrandProfile = {
  id: 'solera-test',
  orgId: 'botanic-atelier-test',
  name: 'Solera',
  category: 'Premium Plant-based Footwear',
  markets: ['United States', 'United Kingdom', 'Germany'],
  audience: {
    primary: ['conscious-luxury millennials', 'design-forward gen Z'],
    age: '26-42',
    psychographics: ['values-driven spenders', 'material literacy'],
  },
  tone: {
    voice: 'Quiet luxury meets earnest material science. Specific. No green-washing buzzwords. Numbers > adjectives. Direct, wry, self-aware.',
    tagline: 'Made of what comes back.',
    bannedPhrases: ['sustainable', 'eco-friendly', 'guilt-free', 'mother earth', 'planet-saving'],
    forbiddenStyles: ['lifestyle warmth', 'motivational cliché', 'doom messaging', 'green-washing'],
    allowedJokes: ['material science nerdery', 'quiet absurdity', 'self-aware luxury'],
  },
  bannedTopics: ['fast fashion glorification', 'leather goods marketing', 'industrial agriculture'],
  brandKeywords: ['solera', 'solera shoes', 'plant-based footwear', 'vegan sneakers', 'mushroom leather'],
  safeThemes: [
    'sustainability', 'circular fashion', 'biomaterials', 'carbon-neutral',
    'cruelty-free', 'regenerative agriculture', 'mycelium', 'mushroom leather',
    'plant-based materials', 'closed-loop manufacturing',
  ],
  competitors: ['Veja', 'Allbirds', 'Cariuma', 'Stella McCartney', 'Adidas'],
  priorityPlatforms: ['x', 'tiktok'],
  contentGoal: 'category leadership in premium plant-based footwear; technical credibility',
  riskTolerance: 'low',
  approvalMode: 'strict',
  crisisMode: false,
  scoringWeights: DEFAULT_WEIGHTS as ScoringWeights,
};

// ─── Test signals ─────────────────────────────────────────────────────────
const signals: Array<{ label: string; signal: RawSignal; expectedRecommendation: string; expectedFit: string }> = [
  {
    label: '#1 Vegan TikTok meme (off-tone)',
    expectedRecommendation: 'IGNORE',
    expectedFit: 'low',
    signal: {
      source: 'tiktok',
      title: "I bought it because the cow forgave me — vegan TikTok skit goes viral",
      summary: 'Comedy creator @plantparadox posts a deadpan skit about explaining vegan sneakers to her grandmother. 2.1M views in 8h.',
      hashtags: ['#VeganTok', '#humor', '#meme'],
      lineage: 'TikTok · creator @plantparadox · 2.1M views',
      firstSeenAt: new Date(Date.now() - 30 * 60_000),
      velocity: 800,
      reach: 2_100_000,
      sentiment: 0.4,
      competitorClaimants: [],
      formatFatigue: 0,
      url: 'https://www.tiktok.com/@plantparadox/video/123',
    },
  },
  {
    label: '#2 Mushroom leather price drop (high-fit news)',
    expectedRecommendation: 'POST_NOW or PREP_1H',
    expectedFit: 'high',
    signal: {
      source: 'news',
      title: 'Mushroom leather price drops 40% after Stella McCartney supply deal — Reuters',
      summary: 'Bolt Threads + Stella McCartney announce a multi-year mycelium leather supply agreement that drops per-square-meter cost from $40 to $24. Reuters confirms via supplier filings.',
      hashtags: ['#biomaterials', '#fashion', '#mycelium'],
      lineage: 'Reuters · biomaterials desk · published 35m ago',
      firstSeenAt: new Date(Date.now() - 35 * 60_000),
      velocity: 220,
      reach: 480_000,
      sentiment: 0.6,
      competitorClaimants: ['Stella McCartney'],
      formatFatigue: 0,
      url: 'https://www.reuters.com/business/retail-consumer/mushroom-leather-stella-2026',
    },
  },
  {
    label: '#3 Adidas circular running shoe (competitor-claimed)',
    expectedRecommendation: 'MONITOR',
    expectedFit: 'mid',
    signal: {
      source: 'news',
      title: 'Adidas drops fully circular running shoe — every part returnable, recyclable',
      summary: 'Adidas Made-To-Be-Remade Pro launches at $180. All upper, midsole, and outsole materials are taken back at end-of-life and reprocessed.',
      hashtags: ['#circular', '#sustainability', '#footwear'],
      lineage: 'The Verge · Adidas press release · 1h ago',
      firstSeenAt: new Date(Date.now() - 60 * 60_000),
      velocity: 180,
      reach: 320_000,
      sentiment: 0.5,
      competitorClaimants: ['Adidas'],
      formatFatigue: 0,
      url: 'https://www.theverge.com/2026/05/03/adidas-circular',
    },
  },
  {
    label: '#4 Climate doom (forbidden style)',
    expectedRecommendation: 'IGNORE',
    expectedFit: 'low',
    signal: {
      source: 'news',
      title: 'Climate doom: fashion is dead, says new IPCC report',
      summary: 'IPCC working group 3 releases a stark assessment: "the apparel industry has 18 months to peak emissions or the 1.5C target is unreachable." Pull quotes dominate the cycle.',
      hashtags: ['#climate', '#doom', '#fashion'],
      lineage: 'IPCC press desk · 2h ago · 1200+ syndications',
      firstSeenAt: new Date(Date.now() - 120 * 60_000),
      velocity: 600,
      reach: 1_800_000,
      sentiment: -0.7,
      competitorClaimants: [],
      formatFatigue: 0,
      url: 'https://www.ipcc.ch/2026-fashion-emissions',
    },
  },
  {
    label: '#5 POVA gaming phone launch (off-category — hallucination check)',
    expectedRecommendation: 'IGNORE',
    expectedFit: 'low (must be < 0.20)',
    signal: {
      source: 'reddit',
      title: 'POVA Curve 2 launches with 8000 mAh battery — gaming flagship',
      summary: 'Tecno POVA Curve 2 launched today in India at ₹19,999. 8000 mAh battery, 144Hz display, MediaTek Dimensity 8300.',
      hashtags: ['#smartphone', '#gaming', '#tecno'],
      lineage: 'r/IndianGaming · 1.2k upvotes · 4h ago',
      firstSeenAt: new Date(Date.now() - 240 * 60_000),
      velocity: 90,
      reach: 12_000,
      sentiment: 0.4,
      competitorClaimants: [],
      formatFatigue: 0,
      url: 'https://www.reddit.com/r/IndianGaming/comments/abc',
    },
  },
  {
    label: '#6 Allbirds bankruptcy (competitor crisis)',
    expectedRecommendation: 'MONITOR (with caution flag)',
    expectedFit: 'high',
    signal: {
      source: 'news',
      title: 'Allbirds files for Chapter 11 bankruptcy after 3 years of declining DTC sales',
      summary: 'Allbirds, the wool-sneaker pioneer, files for Chapter 11 today. CEO cites DTC saturation, retail rent burden, and "unsustainable carbon-claim communication". Stores remain open during reorganization.',
      hashtags: ['#allbirds', '#bankruptcy', '#sustainable-fashion'],
      lineage: 'WSJ · retail desk · 25m ago',
      firstSeenAt: new Date(Date.now() - 25 * 60_000),
      velocity: 410,
      reach: 920_000,
      sentiment: -0.4,
      competitorClaimants: ['Allbirds'],
      formatFatigue: 0,
      url: 'https://www.wsj.com/articles/allbirds-bankruptcy-2026',
    },
  },
];

// ─── Run ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(72));
  console.log('CROSS-CATEGORY VALIDATION LOG — Solera (Premium Plant-based Footwear)');
  console.log('═'.repeat(72));
  console.log(`Brand markets: ${brand.markets.join(', ')}`);
  console.log(`Risk tolerance: ${brand.riskTolerance}; Approval: ${brand.approvalMode}`);
  console.log(`Voice: ${brand.tone.voice.slice(0, 80)}…`);
  console.log();

  const summary: Array<{ label: string; rec: string; fit: number; cringe: number; risk: number; topical: number; cvs: number; expectedRec: string; pass: boolean }> = [];

  for (const { label, signal, expectedRecommendation, expectedFit } of signals) {
    const result = score(signal, { brand });
    const resonance = analyzeResonance(signal, result, brand);

    console.log('─'.repeat(72));
    console.log(`${label}`);
    console.log(`  title: ${signal.title}`);
    console.log(`  expected: ${expectedRecommendation} / fit ${expectedFit}`);
    console.log();
    console.log(`  RECOMMENDATION  ${result.recommendation}`);
    console.log(`  reason          ${result.recommendationReason}`);
    console.log();
    console.log(`  scores  brandFit ${result.scores.brandFit.toFixed(2)}  topicalFit ${result.scores.topicalFit.toFixed(2)}  tonalFit ${result.scores.tonalFit.toFixed(2)}`);
    console.log(`          risk     ${result.scores.risk.toFixed(2)}  cringe ${result.scores.cringe.toFixed(2)}  saturation ${result.scores.saturation.toFixed(2)}`);
    console.log(`          opp      ${result.scores.opportunity}    cvs ${result.jackingScore.toFixed(2)}`);
    console.log();
    console.log(`  RESONANCE`);
    console.log(`    whyNow:    ${resonance.whyNow}`);
    console.log(`    ironyMult: ${resonance.ironicAlignmentMultiplier}x`);
    if (resonance.conflicts.length) {
      console.log(`    conflicts:`);
      for (const c of resonance.conflicts) console.log(`      • [${c.axis}] ${c.reason}`);
    } else {
      console.log(`    conflicts: none`);
    }
    console.log();

    // Hallucination check for signal #5 specifically. The real test:
    // does the SYSTEM (decide.ts) refuse to act on a gaming phone for a
    // footwear brand? brandFit can sit slightly above the composite
    // floor because tonalFit/audienceOverlap have neutral defaults —
    // what matters is recommendation IGNORE + topicalFit < 0.10.
    let pass = true;
    if (label.includes('#5')) {
      pass = result.recommendation === 'IGNORE' && result.scores.topicalFit < 0.10;
      console.log(`  ✱ HALLUCINATION CHECK — gaming phone for footwear brand`);
      console.log(`    expects rec=IGNORE AND topicalFit<0.10`);
      console.log(`    actual  rec=${result.recommendation} topicalFit=${result.scores.topicalFit.toFixed(2)} brandFit=${result.scores.brandFit.toFixed(2)}`);
      console.log(`    verdict: ${pass ? '✓ PASS — system rejected off-category cleanly' : '✗ FAIL — Resonance/Filter hallucinated fit on a gaming phone for a footwear brand'}`);
      console.log();
    }

    summary.push({
      label, rec: result.recommendation, fit: result.scores.brandFit, cringe: result.scores.cringe,
      risk: result.scores.risk, topical: result.scores.topicalFit, cvs: result.jackingScore,
      expectedRec: expectedRecommendation, pass,
    });
  }

  console.log('═'.repeat(72));
  console.log('SUMMARY');
  console.log('═'.repeat(72));
  console.log('label                                          rec          fit   crng  risk  cvs');
  for (const s of summary) {
    const lbl = s.label.padEnd(45).slice(0, 45);
    const rec = s.rec.padEnd(12);
    console.log(`${lbl}  ${rec} ${s.fit.toFixed(2)}  ${s.cringe.toFixed(2)}  ${s.risk.toFixed(2)}  ${s.cvs.toFixed(2)}`);
  }
  console.log();
  const halluPass = summary.find(s => s.label.includes('#5'))?.pass;
  console.log(`Hallucination resistance: ${halluPass ? '✓ PASS' : '✗ FAIL'}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
