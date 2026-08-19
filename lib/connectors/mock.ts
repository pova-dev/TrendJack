import type { Connector, ConnectorPollOpts, ConnectorResult } from './types';
import type { SourceId } from '@/types';
import type { RawSignal } from '@/src/core/scoring';

// -----------------------------------------------------------------------------
// Realistic POVA-context fixtures.
// These signals are written as if pulled from real platforms during a typical
// week in India tech / consumer-electronics conversation. They include a mix:
//   - high-fit, high-velocity opportunities (battery, display, gaming)
//   - banned-topic / risky trends to test the kill switches
//   - already-claimed-by-competitor cases
//   - cringe traps (motivational cliché trend)
//   - decay watch (already past peak)
//   - first-mover windows (just-broken news the brand could own)
// -----------------------------------------------------------------------------

interface SeedSignal extends Omit<RawSignal, 'firstSeenAt'> {
  firstSeenAt: string; // ISO; converted to Date below
}

const SEED: SeedSignal[] = [
  // === X / Twitter ===========================================================
  {
    source: 'x',
    title: 'Battery anxiety is the new range anxiety',
    summary: 'Thread arguing 5000mAh is the new minimum for any phone above ₹15K. 12K likes in 90 minutes.',
    text: 'we’re past the point where 4500mAh is acceptable on a phone you use 14 hours a day. battery is the spec that actually changes your life.',
    hashtags: ['#BatteryLife', '#SmartphoneIndia', '#Tech'],
    lineage: 'Tech reviewer @geekyranjit thread → quoted by @prasadtech, @shlok_srivastava → trending in IN tech.',
    catalyst: 'Geekyranjit Pixel 9 review thread Apr 28',
    firstSeenAt: minutesAgo(95),
    velocity: 720,
    reach: 1_800_000,
    sentiment: 0.4,
    competitorClaimants: [],
    formatFatigue: 0.15,
    url: 'https://x.com/geekyranjit/status/1857482931823104',
    examples: [
      { platform: 'x', author: '@geekyranjit', text: 'we are past the point where 4500mAh is acceptable…', engagement: 12000, url: 'https://x.com/geekyranjit/status/1857482931823104' },
    ],
  },
  {
    source: 'x',
    title: '"Phone got hot" speedrun memes',
    summary: 'Users posting screenshots of their phone temperature after 20-min PUBG sessions; meme format spreading.',
    text: 'pov: you’re 3 minutes into a TDM and your phone is now a sandwich press',
    hashtags: ['#GamingPhone', '#Heating', '#PUBGM'],
    lineage: 'Originated on r/IndianGaming → meme format jumped to X via @TechBurner reply.',
    catalyst: 'BGMI Cycle 6 update dropped',
    firstSeenAt: minutesAgo(180),
    velocity: 410,
    reach: 950_000,
    sentiment: 0.1,
    competitorClaimants: ['Realme'],
    formatFatigue: 0.45,
  },
  {
    source: 'x',
    title: 'Xiaomi launch livestream backlash',
    summary: 'Negative reaction to Xiaomi pricing reveal — sentiment skewing hard against ₹39K positioning.',
    text: 'paying 39k for a phone with last year’s SoC because of the camera bump is wild',
    hashtags: ['#Xiaomi', '#Pricing'],
    lineage: 'Xiaomi keynote livestream → quote-tweets exploded in 30 min.',
    catalyst: 'Xiaomi 14T India launch event',
    firstSeenAt: minutesAgo(45),
    velocity: 1380,
    reach: 4_200_000,
    sentiment: -0.55,
    competitorClaimants: [],
    formatFatigue: 0.2,
  },
  {
    source: 'x',
    title: 'Election rally photo controversy',
    summary: 'Political post going viral with high engagement; touches campaign-finance allegations.',
    text: 'this is what democracy looks like when…',
    hashtags: ['#Elections2026', '#Politics'],
    lineage: 'News outlet exclusive → political accounts amplifying.',
    catalyst: 'Leaked rally footage',
    firstSeenAt: minutesAgo(60),
    velocity: 2300,
    reach: 8_500_000,
    sentiment: -0.7,
    competitorClaimants: [],
    formatFatigue: 0.05,
  },
  {
    source: 'x',
    title: '"Unleash your potential" Monday motivation thread',
    summary: 'LinkedIn-style cringe thread crossover; 28K likes; brands piling on.',
    text: 'monday is your runway — unleash your potential, dream big, level up. who’s with me?',
    hashtags: ['#MondayMotivation', '#GrindMode'],
    lineage: 'Hustle-bro account → quoted by mid-tier brand accounts.',
    catalyst: 'Monday morning organic spread',
    firstSeenAt: minutesAgo(150),
    velocity: 320,
    reach: 1_400_000,
    sentiment: 0.3,
    competitorClaimants: [],
    formatFatigue: 0.85,
  },

  // === Reddit ================================================================
  {
    source: 'reddit',
    title: 'r/IndianGaming: "Why are sub-20K phones still throttling at 30 min?"',
    summary: 'Top post: 4.2K upvotes, 800 comments. Detailed thermal benchmarks of recent launches.',
    text: 'tested 6 phones under ₹20K — every single one drops below 30fps in BGMI within 18 minutes. how are we still here in 2026?',
    hashtags: ['#GamingPhone', '#Thermal', '#BGMI'],
    lineage: 'Original benchmarking post by u/throttle_check_in → cross-posted to r/india.',
    catalyst: 'New Snapdragon 7s Gen 3 launch reviews',
    firstSeenAt: minutesAgo(240),
    velocity: 280,
    reach: 410_000,
    sentiment: -0.2,
    competitorClaimants: [],
    formatFatigue: 0.2,
  },
  {
    source: 'reddit',
    title: 'r/IndianTeenagers: "what phone should i buy with my first salary"',
    summary: 'Recurring weekly thread; current cycle has 600+ comments and brand mentions stacking.',
    text: 'first salary, ₹18K budget, mostly social media + light gaming. what’s the actual answer in 2026 not the youtube one',
    hashtags: ['#FirstPhone', '#Budget'],
    lineage: 'Recurring template thread; this week’s sees POVA mentioned 14 times unprompted.',
    firstSeenAt: minutesAgo(360),
    velocity: 95,
    reach: 88_000,
    sentiment: 0.5,
    competitorClaimants: ['Realme', 'iQOO'],
    formatFatigue: 0.3,
  },

  // === YouTube ===============================================================
  {
    source: 'youtube',
    title: 'MKBHD posted: "The Specs Race is Officially Dead"',
    summary: 'Long-form video arguing camera + battery experience now matters more than benchmark scores.',
    text: 'we have hit the ceiling on what numbers mean. the question is not how fast — it is how long, how cool, and how it feels.',
    hashtags: ['#MKBHD', '#Smartphones', '#Tech'],
    lineage: 'MKBHD upload → 1.2M views in 4h → reaction videos starting.',
    catalyst: 'MKBHD weekly upload',
    firstSeenAt: minutesAgo(220),
    velocity: 180,
    reach: 1_200_000,
    sentiment: 0.6,
    competitorClaimants: [],
    formatFatigue: 0.1,
  },
  {
    source: 'youtube',
    title: 'GadgetsToUse exposé: "Why thin phones are flexing again"',
    summary: 'Video reviewing 3 ultra-thin launches; argues sub-7mm bodies are the new flagship signal.',
    text: 'for two years no one cared about thin. suddenly everyone does. here’s why.',
    hashtags: ['#ThinPhones', '#Design', '#Smartphones'],
    lineage: 'GadgetsToUse upload → tech-Twitter discussion.',
    catalyst: 'CURVE-class device launches',
    firstSeenAt: minutesAgo(540),
    velocity: 60,
    reach: 320_000,
    sentiment: 0.7,
    competitorClaimants: [],
    formatFatigue: 0.2,
  },

  // === TikTok / Reels ========================================================
  {
    source: 'tiktok',
    title: '"Drop test on a budget phone" trend',
    summary: 'Users dropping ₹10-15K phones from ridiculous heights; format saturating.',
    text: 'pov: I dropped my phone from a moving auto and it still works',
    hashtags: ['#DropTest', '#PhoneTok', '#Durability'],
    lineage: 'Started with @niharikkaaa → 12 creators with 1M+ runs in 48h.',
    firstSeenAt: minutesAgo(720),
    velocity: 140,
    reach: 5_400_000,
    sentiment: 0.4,
    competitorClaimants: ['Samsung', 'Motorola'],
    formatFatigue: 0.78,
  },
  {
    source: 'tiktok',
    title: '"Phone aesthetic check" remix',
    summary: 'Audio-led trend, 14s clips showing back-of-phone reveals. Currently low saturation.',
    text: 'show me your phone back. no case. no edits.',
    hashtags: ['#PhoneAesthetic', '#TechTok'],
    lineage: 'Audio uploaded by @vishnuxd → first 200 creators in 3h.',
    firstSeenAt: minutesAgo(120),
    velocity: 480,
    reach: 1_100_000,
    sentiment: 0.65,
    competitorClaimants: [],
    formatFatigue: 0.18,
  },

  // === Google Trends =========================================================
  {
    source: 'google_trends',
    title: '"phone under 20000 with best battery" — breakout query',
    summary: 'Search volume up 340% week over week in India.',
    text: '',
    hashtags: ['#SearchTrend'],
    lineage: 'Sustained climb across IN tier-2 cities; correlated with college reopening.',
    firstSeenAt: minutesAgo(60 * 18),
    velocity: 35,
    reach: 220_000,
    sentiment: 0,
    competitorClaimants: [],
    formatFatigue: 0,
  },
  {
    source: 'google_trends',
    title: '"is curved screen worth it" — rising query',
    summary: 'Searches up 180% over 7 days. Sentiment in associated discussions mixed.',
    text: '',
    hashtags: ['#SearchTrend'],
    lineage: 'Rising correlated with thin-phone YouTube discourse.',
    firstSeenAt: minutesAgo(60 * 30),
    velocity: 22,
    reach: 95_000,
    sentiment: 0.1,
    competitorClaimants: [],
    formatFatigue: 0,
  },

  // === News ==================================================================
  {
    source: 'news',
    title: 'Reuters: India semiconductor incentive expansion approved',
    summary: 'Government adds ₹76,000 cr to semiconductor PLI scheme. Industry-wide implications.',
    text: 'the cabinet approved an expanded incentive package targeting domestic chip and display manufacturing…',
    hashtags: ['#MakeInIndia', '#Semiconductor'],
    lineage: 'Reuters exclusive → wire pickup across IN business press.',
    catalyst: 'Cabinet decision',
    firstSeenAt: minutesAgo(75),
    velocity: 410,
    reach: 3_100_000,
    sentiment: 0.5,
    competitorClaimants: [],
    formatFatigue: 0.05,
  },
  {
    source: 'news',
    title: 'Apple supply chain lawsuit India',
    summary: 'Worker-rights lawsuit against contractor; potentially polarizing.',
    text: '',
    hashtags: ['#Apple', '#Lawsuit'],
    lineage: 'Local press → starting to get international wire pickup.',
    firstSeenAt: minutesAgo(110),
    velocity: 160,
    reach: 720_000,
    sentiment: -0.6,
    competitorClaimants: [],
    formatFatigue: 0.1,
  },

  // === Custom watchlist ======================================================
  {
    source: 'custom',
    title: 'Competitor watch: Realme launches GT 7 Pro India variant',
    summary: 'Launch event live; positioning around "performance for the price." Press coverage flooding in.',
    text: 'realme GT 7 pro is here. snapdragon 8s gen 3, 6500mAh, ₹32,999 starting.',
    hashtags: ['#Realme', '#GT7Pro'],
    lineage: 'Realme owned channels → IN tech press pickup → real-time reviews.',
    catalyst: 'Realme India launch event',
    firstSeenAt: minutesAgo(35),
    velocity: 980,
    reach: 2_400_000,
    sentiment: 0.3,
    competitorClaimants: ['Realme'],
    formatFatigue: 0.1,
  },
];

// -----------------------------------------------------------------------------

function minutesAgo(m: number): string {
  return new Date(Date.now() - m * 60 * 1000).toISOString();
}

export class MockConnector implements Connector {
  constructor(public id: string, public source: SourceId) {}
  mode = 'mock' as const;

  async poll(opts: ConnectorPollOpts): Promise<ConnectorResult> {
    const sinceMs = opts.since?.getTime() ?? 0;
    const items = SEED
      .filter(s => s.source === this.source)
      .filter(s => new Date(s.firstSeenAt).getTime() > sinceMs)
      .slice(0, opts.limit ?? 50)
      .map<RawSignal>(s => ({ ...s, firstSeenAt: new Date(s.firstSeenAt) }));

    return {
      ok: true,
      source: this.source,
      mode: 'mock',
      signals: items,
      fetchedAt: new Date(),
    };
  }
}

export function getAllMockSignals(): RawSignal[] {
  return SEED.map(s => ({
    ...s,
    firstSeenAt: new Date(s.firstSeenAt),
    url: s.url ?? fallbackUrl(s.source, s.title, s.hashtags),
  }));
}

function fallbackUrl(source: string, title: string, tags: string[]): string {
  const q = encodeURIComponent((tags[0] ?? title).replace(/^#/, ''));
  switch (source) {
    case 'x':             return `https://x.com/search?q=${q}&f=live`;
    case 'reddit':        return `https://www.reddit.com/search/?q=${q}&t=day&sort=hot`;
    case 'youtube':       return `https://www.youtube.com/results?search_query=${q}&sp=CAI%253D`;
    case 'tiktok':        return `https://www.tiktok.com/search?q=${q}`;
    case 'google_trends': return `https://trends.google.com/trends/explore?q=${q}&geo=IN`;
    case 'news':          return `https://news.google.com/search?q=${q}`;
    default:              return `https://www.google.com/search?q=${q}`;
  }
}
