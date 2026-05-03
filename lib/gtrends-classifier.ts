// Google Trends category classifier.
//
// Why this exists: Google's free /trending/rss endpoint accepts a
// `category` URL parameter but ignores it — the same item set comes
// back regardless of whether you ask for sports, sci-tech, or business.
// (Verified: `?category=m` and `?category=t` return byte-identical
// payloads.) The newer /trends/api/realtimetrends JSON endpoint that
// actually filters by category requires session cookies + a Google
// Trends OAuth-style trk token we don't want to maintain.
//
// So we do it ourselves: classify each trend by its top news source
// domain + title heuristics. The mapping is intentionally conservative:
// when a trend doesn't clearly fit a niche, it falls back to 'top'
// (general news) rather than getting force-bucketed somewhere.
//
// Used by lib/connectors/googletrends.ts — replaces the per-category
// fan-out, which was making 3× the requests for the same data.

export type GtrendsCategoryId = 't' | 'b' | 'e' | 'm' | 'h' | 'top';

// Source-host classification. Domain substring → category. Order matters
// only for tie-breaking: the loop returns the first match.
const HOST_RULES: Array<[RegExp, GtrendsCategoryId]> = [
  // Sports
  [/espn|espncricinfo|cricbuzz|cricinfo|atptour|fussball|skysports|goal\.com|fifa\.com|premierleague|laliga|nba\.com|f1\.com|formula1|sportstar|wisden|cricketaddictor/i, 't'],
  // Business / finance
  [/bloomberg|cnbc|moneycontrol|reuters\.com\/business|wsj\.com|livemint|economictimes|business-?standard|financialexpress|forbes|fortune|ft\.com|investing\.com|coindesk|cointelegraph/i, 'b'],
  // Entertainment / film / music
  [/variety|hollywoodreporter|deadline\.com|filmfare|bollywoodhungama|pinkvilla|peoplemag|ew\.com|rollingstone|billboard|imdb|netflix|hotstar/i, 'e'],
  // Sci & tech
  [/theverge|techcrunch|arstechnica|wired\.com|engadget|gsmarena|91mobiles|gadgets360|androidauthority|androidcentral|mashable|cnet|zdnet|venturebeat|protocol\.com|theregister|tomsguide/i, 'm'],
  // Health
  [/healthline|webmd|medicalnewstoday|mayoclinic|nih\.gov|who\.int|hopkins|cdc\.gov|wellness|nutrition|fit/i, 'h'],
];

// Title-keyword fallback. Lower confidence than host rules — we only
// use this when host doesn't match anything. Order = priority.
const TITLE_RULES: Array<[RegExp, GtrendsCategoryId]> = [
  // Sports — explicit "vs" matches between two teams/players, plus
  // common league/match shorthand (IPL, EPL, ODI, T20, etc).
  [/\b(vs|v\.|v\s)\b|\b(ipl|epl|laliga|fifa|odi|t20|test match|grand prix|wwe|ufc|atp|wta|premier league|world cup|champions league)\b/i, 't'],
  [/\b(stock|nasdaq|sensex|nifty|ipo|earnings|merger|acquisition|fundraise|funding round|inflation|interest rate|crypto)\b/i, 'b'],
  [/\b(film|movie|trailer|teaser|box office|series|season \d|netflix|prime video|hotstar|spotify|grammy|oscar)\b/i, 'e'],
  [/\b(iphone|samsung|android|chip|gpu|ai|chatgpt|gemini|llm|launch|release|app|pixel|macbook|leak|specs|review)\b/i, 'm'],
  [/\b(vaccine|covid|outbreak|disease|symptom|diet|workout|cancer|diabetes|fitness|wellness)\b/i, 'h'],
];

interface ClassifierInput {
  /** News source string from <ht:news_item_source>, e.g. 'ESPN India',
   *  'The Times of India', 'Hindustan Times'. May be undefined. */
  newsSource?: string;
  /** Article URL from <ht:news_item_url>. We extract the host for
   *  domain matching. */
  articleUrl?: string;
  /** Trend title from <title>. Used as a title-keyword fallback. */
  title: string;
}

export function classifyTrendCategory(input: ClassifierInput): GtrendsCategoryId {
  // 1. Host rules — strongest signal. Try article URL first, then
  // newsSource as a hint (e.g. "ESPN India" → matches /espn/).
  const haystack = [
    input.articleUrl ?? '',
    input.newsSource ?? '',
  ].join(' ').toLowerCase();
  for (const [re, id] of HOST_RULES) {
    if (re.test(haystack)) return id;
  }

  // 2. Title keywords — weaker. Fired only when no host matched.
  const t = input.title.toLowerCase();
  for (const [re, id] of TITLE_RULES) {
    if (re.test(t)) return id;
  }

  // 3. Default — general news / top stories.
  return 'top';
}
