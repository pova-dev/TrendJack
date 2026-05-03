// Trinity Swarm Round 2 — Author Agent: Vault (fintech) cross-category stress test.
//
// Companion to scripts/seed-solera-stress-test.ts. Tests a different
// category bucket (finance vs footwear) so we verify the cross-category
// scoring discipline holds across the whole taxonomy, not just one
// fixture. Same discipline: pure-function calls, no DB writes.

import { score } from '../src/core/scoring/engine';
import { analyzeResonance } from '../src/agents/resonance';
import type { BrandProfile, ScoringWeights } from '../types';
import { DEFAULT_WEIGHTS } from '../types';
import type { RawSignal } from '../src/core/scoring/types';
import { suggestCategoriesForBrand } from '../lib/gtrends-categories';
import { pickSeedForBrand } from '../lib/seed-corpora';

// ─── Brand ────────────────────────────────────────────────────────────────
const brand: BrandProfile = {
  id: 'vault-test',
  orgId: 'vault-org-test',
  name: 'Vault',
  category: 'Fintech / Payments / Wealth Management',
  markets: ['United States', 'United Kingdom', 'Singapore'],
  audience: {
    primary: ['millennial professionals', 'small business owners'],
    age: '28-45',
    psychographics: ['financially-literate', 'tech-forward'],
  },
  tone: {
    voice: 'Plainspoken finance. Calm under pressure. Specific numbers > vague reassurance. Direct, clinical, anti-hype.',
    tagline: 'Money, in plain English.',
    bannedPhrases: ['unleash your wealth', 'financial freedom', 'work hard play hard', 'secure your future'],
    forbiddenStyles: ['motivational cliché', 'doom messaging', 'corporate-speak'],
    allowedJokes: ['dry market commentary', 'self-aware regulatory humor'],
  },
  bannedTopics: ['investment advice', 'crypto pump narratives', 'get-rich-quick'],
  brandKeywords: ['vault', 'vault payments', 'vault wealth'],
  safeThemes: ['payments', 'compliance', 'financial inclusion', 'open banking', 'regulatory updates'],
  competitors: ['Stripe', 'Square', 'Razorpay', 'Adyen', 'Plaid', 'Robinhood'],
  priorityPlatforms: ['linkedin', 'x'],
  contentGoal: 'category leadership in plain-English fintech communications',
  riskTolerance: 'low',
  approvalMode: 'strict',
  crisisMode: false,
  scoringWeights: DEFAULT_WEIGHTS as ScoringWeights,
};

// ─── Test signals ─────────────────────────────────────────────────────────
const signals: Array<{ label: string; signal: RawSignal; expectedRecommendation: string }> = [
  {
    label: '#1 RBI rate cut (high-fit news)',
    expectedRecommendation: 'MONITOR or PREP_1H',
    signal: {
      source: 'news',
      title: 'RBI cuts repo rate by 25 bps to 5.25% — first cut of the year',
      summary: 'India\'s central bank surprises markets with a quarter-point cut, citing softening inflation.',
      hashtags: ['#fintech', '#economy', '#rbi'],
      lineage: 'Bloomberg · economic desk · 1h ago',
      firstSeenAt: new Date(Date.now() - 60 * 60_000),
      velocity: 800, reach: 1_200_000, sentiment: 0.3,
      competitorClaimants: [], formatFatigue: 0,
      url: 'https://www.bloomberg.com/news/rbi-rate-cut-2026',
    },
  },
  {
    label: '#2 Stripe acquires Plaid for $12B (competitor M&A)',
    expectedRecommendation: 'MONITOR (with caution)',
    signal: {
      source: 'news',
      title: 'Stripe acquires Plaid for $12B in landmark fintech consolidation',
      summary: 'Stripe expands open-banking footprint with the largest fintech M&A of 2026.',
      hashtags: ['#fintech', '#stripe', '#plaid'],
      lineage: 'TechCrunch · 30m ago',
      firstSeenAt: new Date(Date.now() - 30 * 60_000),
      velocity: 1200, reach: 2_400_000, sentiment: 0.2,
      competitorClaimants: ['Stripe', 'Plaid'], formatFatigue: 0,
      url: 'https://techcrunch.com/2026/05/stripe-plaid-12b',
    },
  },
  {
    label: '#3 "Crypto guarantees you can retire at 30" (banned topic + cringe)',
    expectedRecommendation: 'IGNORE',
    signal: {
      source: 'tiktok',
      title: 'Crypto guaranteed retirement at 30 — get-rich-quick stack revealed',
      summary: 'Influencer pushes a crypto pump narrative promising guaranteed returns.',
      hashtags: ['#crypto', '#investing'],
      lineage: 'TikTok · creator · 2.4M views',
      firstSeenAt: new Date(Date.now() - 90 * 60_000),
      velocity: 1400, reach: 2_400_000, sentiment: 0.7,
      competitorClaimants: [], formatFatigue: 0,
      url: 'https://www.tiktok.com/@cryptoguy/video/seed1',
    },
  },
  {
    label: '#4 "Unleash your financial freedom" cringe pattern (forbidden phrase)',
    expectedRecommendation: 'IGNORE (cringe lift via banned phrase)',
    signal: {
      source: 'news',
      title: 'Unleash your financial freedom: 5 hacks to redefine your money mindset',
      summary: 'Lifestyle finance article promising motivational money advice.',
      hashtags: ['#money', '#mindset'],
      lineage: 'Lifehacker · 2h ago',
      firstSeenAt: new Date(Date.now() - 120 * 60_000),
      velocity: 80, reach: 60_000, sentiment: 0.5,
      competitorClaimants: [], formatFatigue: 0,
      url: 'https://www.lifehacker.com/financial-freedom-2026',
    },
  },
  {
    label: '#5 POVA Curve 2 gaming phone (off-category — hallucination check)',
    expectedRecommendation: 'IGNORE',
    signal: {
      source: 'reddit',
      title: 'POVA Curve 2 launches with 8000 mAh battery — gaming flagship',
      summary: 'Tecno POVA Curve 2 launched today in India at ₹19,999. 8000 mAh battery.',
      hashtags: ['#smartphone', '#gaming'],
      lineage: 'r/IndianGaming · 1.2k upvotes · 4h ago',
      firstSeenAt: new Date(Date.now() - 240 * 60_000),
      velocity: 90, reach: 12_000, sentiment: 0.4,
      competitorClaimants: [], formatFatigue: 0,
      url: 'https://www.reddit.com/r/IndianGaming/comments/abc',
    },
  },
  {
    label: '#6 Razorpay Series F $300M raise (competitor success)',
    expectedRecommendation: 'MONITOR',
    signal: {
      source: 'news',
      title: 'Razorpay raises $300M Series F at $9B valuation, led by Tiger Global',
      summary: 'Indian payments giant Razorpay closes a new round to expand into SEA.',
      hashtags: ['#fintech', '#funding'],
      lineage: 'TechCrunch · 3h ago',
      firstSeenAt: new Date(Date.now() - 180 * 60_000),
      velocity: 220, reach: 180_000, sentiment: 0.6,
      competitorClaimants: ['Razorpay'], formatFatigue: 0,
      url: 'https://techcrunch.com/2026/05/razorpay-series-f',
    },
  },
];

// ─── Run ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(72));
  console.log('VAULT (Fintech) CROSS-CATEGORY VALIDATION LOG');
  console.log('═'.repeat(72));
  console.log(`Brand markets: ${brand.markets.join(', ')}`);
  console.log(`Voice: ${brand.tone.voice.slice(0, 80)}…`);
  console.log();

  // ─── Onboarding paths integrity check ────────────────────────────────
  const suggestedCats = suggestCategoriesForBrand(brand.category, brand.name);
  const seedCorpus = pickSeedForBrand(brand.category, brand.name);
  console.log('Onboarding integrity:');
  console.log(`  suggestCategoriesForBrand → [${suggestedCats.join(', ')}]`);
  console.log(`    expected: ['b', ...] (finance category)`);
  console.log(`  pickSeedForBrand           → ${seedCorpus.length} seed signals`);
  console.log(`    first signal title:        "${seedCorpus[0]?.title.slice(0, 50)}…"`);
  console.log();

  const summary: Array<{ label: string; rec: string; fit: number; cringe: number; risk: number; topical: number; cvs: number; pass: boolean }> = [];

  for (const { label, signal, expectedRecommendation } of signals) {
    const result = score(signal, { brand });
    const resonance = analyzeResonance(signal, result, brand);

    console.log('─'.repeat(72));
    console.log(label);
    console.log(`  expected: ${expectedRecommendation}`);
    console.log(`  ACTUAL:   ${result.recommendation}`);
    console.log(`  reason:   ${result.recommendationReason}`);
    console.log(`  scores  brandFit ${result.scores.brandFit.toFixed(2)} topicalFit ${result.scores.topicalFit.toFixed(2)} tonalFit ${result.scores.tonalFit.toFixed(2)}`);
    console.log(`          risk ${result.scores.risk.toFixed(2)} cringe ${result.scores.cringe.toFixed(2)} sat ${result.scores.saturation.toFixed(2)}`);
    console.log(`          opp ${result.scores.opportunity} cvs ${result.jackingScore.toFixed(2)}`);
    console.log(`  whyNow: ${resonance.whyNow}`);
    console.log(`  ironyMult: ${resonance.ironicAlignmentMultiplier}x`);
    console.log();

    let pass = true;
    if (label.includes('#5')) {
      pass = result.recommendation === 'IGNORE' && result.scores.topicalFit < 0.10;
      console.log(`  ✱ HALLUCINATION CHECK — gaming phone for fintech brand`);
      console.log(`    expects rec=IGNORE AND topicalFit<0.10`);
      console.log(`    actual  rec=${result.recommendation} topicalFit=${result.scores.topicalFit.toFixed(2)}`);
      console.log(`    verdict: ${pass ? '✓ PASS' : '✗ FAIL — system hallucinated fit on a gaming phone for fintech'}`);
      console.log();
    }
    if (label.includes('#3')) {
      // Banned-topic content (crypto pump) MUST IGNORE
      pass = result.recommendation === 'IGNORE';
      console.log(`  ✱ BANNED-TOPIC CHECK — crypto pump narrative`);
      console.log(`    expects rec=IGNORE`);
      console.log(`    verdict: ${pass ? '✓ PASS' : '✗ FAIL'}`);
      console.log();
    }
    if (label.includes('#4')) {
      // Forbidden phrase + cringe should IGNORE or MONITOR with high cringe
      pass = result.scores.cringe >= 0.30 || result.recommendation === 'IGNORE';
      console.log(`  ✱ FORBIDDEN-PHRASE CRINGE LIFT — "unleash" + "redefine" trigger ad-speak + brand bans`);
      console.log(`    expects cringe ≥ 0.30 OR IGNORE`);
      console.log(`    actual  cringe=${result.scores.cringe.toFixed(2)} rec=${result.recommendation}`);
      console.log(`    verdict: ${pass ? '✓ PASS' : '✗ FAIL'}`);
      console.log();
    }

    summary.push({
      label, rec: result.recommendation,
      fit: result.scores.brandFit, cringe: result.scores.cringe,
      risk: result.scores.risk, topical: result.scores.topicalFit,
      cvs: result.jackingScore, pass,
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
  const checks = summary.filter(s => s.label.includes('#3') || s.label.includes('#4') || s.label.includes('#5'));
  console.log(`Audit checks: ${checks.filter(c => c.pass).length}/${checks.length} passed`);
}

main().catch(e => { console.error(e); process.exit(1); });
