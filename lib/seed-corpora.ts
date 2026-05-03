// Category-aware seed corpora.
//
// On brand creation, seedTrendsForBrand needs to populate the dashboard
// with realistic signals so the operator sees a working board within
// seconds. The legacy single corpus was POVA-flavored (smartphones) —
// dropping it on a footwear brand or a fintech brand produces
// off-category junk that scores low and makes the dashboard look broken.
//
// This module routes the seed pick by the brand's free-text category.
// The corpora here are LIGHTWEIGHT (10-15 signals each) and meant as
// scaffolding only — real traffic flows in within ~90s of the first
// ingest tick. The seed exists to bridge that first-90s gap.
//
// Adding a new category: write a new `*Seed: SeedSignal[]` constant
// below + add a route in `pickSeedForBrand`. Each signal must produce
// realistic scores against a brand of the matching category — verify
// by running scripts/seed-solera-stress-test.ts after adding.

import type { RawSignal } from '@/src/core/scoring/types';

type SeedSignal = Omit<RawSignal, 'firstSeenAt'> & { firstSeenAt: number };  // ms epoch

const NOW = () => Date.now();
const HOURS_AGO = (h: number) => NOW() - h * 3_600_000;

// ─── Smartphones / consumer-electronics ──────────────────────────────────
const smartphoneSeed: SeedSignal[] = [
  {
    source: 'reddit', title: 'POVA Curve 2 battery life is genuinely insane (review)',
    summary: 'After two weeks of heavy use the 8000 mAh keeps me at 30%+ at end of day.',
    hashtags: ['#smartphone', '#battery', '#review'],
    lineage: 'r/IndianGaming · 1.2k upvotes · 4h ago',
    firstSeenAt: HOURS_AGO(4),
    velocity: 80, reach: 14_000, sentiment: 0.5,
    competitorClaimants: [], formatFatigue: 0,
    url: 'https://www.reddit.com/r/IndianGaming/comments/seed1',
  },
  {
    source: 'news', title: 'iPhone 18 Pro Max launches in India at ₹1,49,900',
    summary: 'Apple announces new flagship pricing for the Indian market.',
    hashtags: ['#smartphone', '#apple'], lineage: 'The Hindu · 2h ago',
    firstSeenAt: HOURS_AGO(2),
    velocity: 200, reach: 480_000, sentiment: 0.3,
    competitorClaimants: ['Apple'], formatFatigue: 0,
    url: 'https://www.thehindu.com/sci-tech/technology/iphone-18-india-2026',
  },
  {
    source: 'news', title: 'Samsung Galaxy A56 review: a battery champion at the mid-range',
    summary: 'Samsung\'s mid-range pick scores high on battery life and design.',
    hashtags: ['#smartphone', '#samsung'], lineage: 'GSMArena · 6h ago',
    firstSeenAt: HOURS_AGO(6),
    velocity: 90, reach: 95_000, sentiment: 0.4,
    competitorClaimants: ['Samsung'], formatFatigue: 0,
    url: 'https://www.gsmarena.com/samsung_galaxy_a56_review-news-2026',
  },
  {
    source: 'reddit', title: 'Best gaming phone under ₹20,000 in 2026?',
    summary: 'Looking for a gaming phone, max ₹20k. Suggestions?',
    hashtags: ['#gaming', '#smartphone'], lineage: 'r/IndianGaming · 230 upvotes',
    firstSeenAt: HOURS_AGO(8),
    velocity: 40, reach: 8_000, sentiment: 0.1,
    competitorClaimants: [], formatFatigue: 0,
    url: 'https://www.reddit.com/r/IndianGaming/comments/seed2',
  },
  {
    source: 'google_trends', title: 'tecno pova',
    summary: 'Trending in IN.', hashtags: ['#GoogleTrends'],
    lineage: '[cat:m] Google Trends · IN · 50,000+ searches · started 3h ago · ↑200% (24h)',
    firstSeenAt: HOURS_AGO(3),
    velocity: 800, reach: 50_000, sentiment: 0,
    competitorClaimants: [], formatFatigue: 0,
    url: 'https://trends.google.com/trends/explore?q=tecno+pova&geo=IN',
  },
];

// ─── Fashion / footwear / apparel ────────────────────────────────────────
const fashionSeed: SeedSignal[] = [
  {
    source: 'news', title: 'Mushroom leather price drops 40% after Stella McCartney supply deal',
    summary: 'Bolt Threads + Stella McCartney announce mycelium leather supply agreement.',
    hashtags: ['#biomaterials', '#fashion'], lineage: 'Reuters · 35m ago',
    firstSeenAt: HOURS_AGO(0.6),
    velocity: 200, reach: 480_000, sentiment: 0.6,
    competitorClaimants: ['Stella McCartney'], formatFatigue: 0,
    url: 'https://www.reuters.com/business/retail-consumer/mushroom-leather-stella-2026',
  },
  {
    source: 'news', title: 'Adidas drops fully circular running shoe — every part returnable',
    summary: 'Adidas Made-To-Be-Remade Pro launches at $180; all materials returnable.',
    hashtags: ['#circular', '#sustainability', '#footwear'],
    lineage: 'The Verge · 2h ago',
    firstSeenAt: HOURS_AGO(2),
    velocity: 180, reach: 320_000, sentiment: 0.5,
    competitorClaimants: ['Adidas'], formatFatigue: 0,
    url: 'https://www.theverge.com/2026/05/adidas-circular',
  },
  {
    source: 'news', title: 'Allbirds files for Chapter 11 after 3 years of declining DTC sales',
    summary: 'Wool-sneaker pioneer enters Chapter 11; stores stay open during reorg.',
    hashtags: ['#allbirds', '#sustainable-fashion'],
    lineage: 'WSJ · 4h ago',
    firstSeenAt: HOURS_AGO(4),
    velocity: 410, reach: 920_000, sentiment: -0.4,
    competitorClaimants: ['Allbirds'], formatFatigue: 0,
    url: 'https://www.wsj.com/articles/allbirds-bankruptcy-2026',
  },
  {
    source: 'reddit', title: 'Anyone tried Veja sneakers for runs? Honest take.',
    summary: 'Considering Veja for a 10K — are they durable enough?',
    hashtags: ['#vegan', '#footwear'], lineage: 'r/SneakerCollab · 180 upvotes',
    firstSeenAt: HOURS_AGO(7),
    velocity: 30, reach: 6_000, sentiment: 0.2,
    competitorClaimants: ['Veja'], formatFatigue: 0,
    url: 'https://www.reddit.com/r/SneakerCollab/comments/seed1',
  },
  {
    source: 'google_trends', title: 'mushroom leather',
    summary: 'Trending globally.', hashtags: ['#GoogleTrends'],
    lineage: '[cat:b] Google Trends · US · 20,000+ searches · started 5h ago · ↑400% (24h)',
    firstSeenAt: HOURS_AGO(5),
    velocity: 200, reach: 20_000, sentiment: 0,
    competitorClaimants: [], formatFatigue: 0,
    url: 'https://trends.google.com/trends/explore?q=mushroom+leather&geo=US',
  },
];

// ─── Finance / fintech ───────────────────────────────────────────────────
const financeSeed: SeedSignal[] = [
  {
    source: 'news', title: 'RBI cuts repo rate by 25 bps to 5.25%',
    summary: 'India\'s central bank surprises markets with a quarter-point cut.',
    hashtags: ['#fintech', '#economy'], lineage: 'Bloomberg · 1h ago',
    firstSeenAt: HOURS_AGO(1),
    velocity: 800, reach: 1_200_000, sentiment: 0.3,
    competitorClaimants: [], formatFatigue: 0,
    url: 'https://www.bloomberg.com/news/rbi-rate-cut-2026',
  },
  {
    source: 'news', title: 'Razorpay raises $300M Series F at $9B valuation',
    summary: 'Indian payments giant Razorpay closes new round led by Tiger Global.',
    hashtags: ['#fintech', '#funding'], lineage: 'TechCrunch · 3h ago',
    firstSeenAt: HOURS_AGO(3),
    velocity: 220, reach: 180_000, sentiment: 0.6,
    competitorClaimants: ['Razorpay'], formatFatigue: 0,
    url: 'https://techcrunch.com/2026/05/razorpay-series-f',
  },
  {
    source: 'reddit', title: 'Best mutual funds for SIP in 2026?',
    summary: 'Looking to start a 5-year SIP, ₹10k/month. Suggestions?',
    hashtags: ['#investing'], lineage: 'r/IndiaInvestments · 320 upvotes',
    firstSeenAt: HOURS_AGO(8),
    velocity: 35, reach: 12_000, sentiment: 0.1,
    competitorClaimants: [], formatFatigue: 0,
    url: 'https://www.reddit.com/r/IndiaInvestments/comments/seed1',
  },
];

// ─── SaaS / B2B ──────────────────────────────────────────────────────────
const saasSeed: SeedSignal[] = [
  {
    source: 'news', title: 'Anthropic releases Claude Opus 5 with 2M context window',
    summary: 'New flagship model from Anthropic ships with 2M-token context.',
    hashtags: ['#ai', '#saas'], lineage: 'The Verge · 30m ago',
    firstSeenAt: HOURS_AGO(0.5),
    velocity: 600, reach: 850_000, sentiment: 0.7,
    competitorClaimants: ['Anthropic'], formatFatigue: 0,
    url: 'https://www.theverge.com/2026/05/claude-opus-5',
  },
  {
    source: 'reddit', title: 'Anyone moved off Salesforce to a modern CRM in 2026?',
    summary: 'Cost is killing us. What\'s the consensus alternative?',
    hashtags: ['#saas', '#crm'], lineage: 'r/SaaS · 410 upvotes',
    firstSeenAt: HOURS_AGO(5),
    velocity: 60, reach: 18_000, sentiment: -0.2,
    competitorClaimants: ['Salesforce'], formatFatigue: 0,
    url: 'https://www.reddit.com/r/SaaS/comments/seed1',
  },
  {
    source: 'news', title: 'Linear acquires Granola for $400M — note-taking + project management',
    summary: 'Linear continues vertical integration with the Granola acquisition.',
    hashtags: ['#saas'], lineage: 'TechCrunch · 4h ago',
    firstSeenAt: HOURS_AGO(4),
    velocity: 180, reach: 220_000, sentiment: 0.5,
    competitorClaimants: ['Linear'], formatFatigue: 0,
    url: 'https://techcrunch.com/2026/05/linear-granola',
  },
];

// ─── Health / wellness ──────────────────────────────────────────────────
const healthSeed: SeedSignal[] = [
  {
    source: 'news', title: 'WHO updates 2026 guidelines on creatine supplementation',
    summary: 'Updated guidance recognizes creatine\'s broad cognitive benefits.',
    hashtags: ['#wellness', '#nutrition'], lineage: 'Healthline · 2h ago',
    firstSeenAt: HOURS_AGO(2),
    velocity: 140, reach: 280_000, sentiment: 0.5,
    competitorClaimants: [], formatFatigue: 0,
    url: 'https://www.healthline.com/nutrition/creatine-2026-guidelines',
  },
  {
    source: 'reddit', title: 'Best magnesium supplement for sleep? 2026 stack',
    summary: 'Looking for magnesium recommendations to improve sleep quality.',
    hashtags: ['#wellness', '#sleep'], lineage: 'r/Supplements · 240 upvotes',
    firstSeenAt: HOURS_AGO(6),
    velocity: 30, reach: 9_000, sentiment: 0.2,
    competitorClaimants: [], formatFatigue: 0,
    url: 'https://www.reddit.com/r/Supplements/comments/seed1',
  },
];

// ─── Generic fallback ───────────────────────────────────────────────────
const genericSeed: SeedSignal[] = [
  {
    source: 'google_trends', title: 'breaking news today',
    summary: 'Trending search.', hashtags: ['#GoogleTrends'],
    lineage: '[cat:top] Google Trends · 100,000+ searches · started 1h ago · ↑500% (24h)',
    firstSeenAt: HOURS_AGO(1),
    velocity: 600, reach: 100_000, sentiment: 0,
    competitorClaimants: [], formatFatigue: 0,
    url: 'https://trends.google.com/trends/explore?q=breaking+news',
  },
  {
    source: 'news', title: 'Markets close higher on optimism around earnings season',
    summary: 'Major indices closed up on tech-led gains.',
    hashtags: ['#news'], lineage: 'Reuters · 2h ago',
    firstSeenAt: HOURS_AGO(2),
    velocity: 80, reach: 350_000, sentiment: 0.3,
    competitorClaimants: [], formatFatigue: 0,
    url: 'https://www.reuters.com/markets/2026',
  },
];

/** Pick a seed corpus based on the brand's free-text category. Falls
 *  back to genericSeed when nothing matches. */
export function pickSeedForBrand(category: string, brandName?: string): RawSignal[] {
  const blob = `${category} ${brandName ?? ''}`.toLowerCase();
  let bucket: SeedSignal[];
  if (/phone|smartphone|mobile|consumer\s*tech|electronics|gadget|device|smartwatch/.test(blob)) {
    bucket = smartphoneSeed;
  } else if (/fashion|footwear|apparel|sneaker|shoe|clothing|luxury|footwear|garment/.test(blob)) {
    bucket = fashionSeed;
  } else if (/finance|fintech|bank|invest|payment|crypto|wealth|loan|insurance/.test(blob)) {
    bucket = financeSeed;
  } else if (/saas|b2b|enterprise|software|dev[\s-]?tool|platform|api/.test(blob)) {
    bucket = saasSeed;
  } else if (/health|wellness|fitness|supplement|pharma|nutrition|skincare|beauty/.test(blob)) {
    bucket = healthSeed;
  } else {
    bucket = genericSeed;
  }
  return bucket.map(s => ({ ...s, firstSeenAt: new Date(s.firstSeenAt) }));
}
