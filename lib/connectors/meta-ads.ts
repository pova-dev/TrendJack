// Meta Ad Library connector — competitor activity surfacing.
//
// Public Meta Ad Library data is queryable at:
//   https://www.facebook.com/ads/library/
//     ?active_status=all
//     &ad_type=all
//     &country={ISO}
//     &q={competitor_name}
//     &search_type=keyword_unordered
//
// What we CAN reliably do (no Puppeteer, no auth, no scraping):
//   - construct a stable deep-link per (competitor × country)
//   - emit one RawSignal per competitor that opens their library
//
// What we CAN'T do honestly without a headless browser:
//   - count active ads (loaded async via JS bundles)
//   - extract ad creative / spend / impressions
//   - those are Phase-2 work behind a paid third-party (DataForSEO,
//     SocialPeta) or a local Puppeteer / Playwright runner.
//
// Per CLAUDE.md hard rule 1 (no fabrication): we emit reach=0 +
// velocity=0 because we genuinely don't know. The UI renders '—'.
// The value here is operator workflow — one click into the
// competitor's library, with a "last checked" timestamp.

import type { Connector, ConnectorPollOpts, ConnectorResult } from './types';
import type { RawSignal } from '@/lib/scoring/engine';

// Country name → ISO 3166-1 alpha-2. Meta Ad Library uses ISO codes
// (IN, US, GB, etc.). Reuses the same mapping idea as countries.ts.
const COUNTRY_ISO: Record<string, string> = {
  india: 'IN', 'united states': 'US', usa: 'US', us: 'US',
  'united kingdom': 'GB', uk: 'GB', canada: 'CA', australia: 'AU',
  germany: 'DE', france: 'FR', japan: 'JP', brazil: 'BR',
  mexico: 'MX', netherlands: 'NL', spain: 'ES', italy: 'IT',
  turkey: 'TR', 'south korea': 'KR', korea: 'KR',
  philippines: 'PH', indonesia: 'ID', thailand: 'TH',
  malaysia: 'MY', singapore: 'SG', 'south africa': 'ZA',
  argentina: 'AR', colombia: 'CO',
  worldwide: 'ALL', global: 'ALL', world: 'ALL',
};

function deepLink(competitor: string, iso: string): string {
  const q = encodeURIComponent(competitor);
  return `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${iso}&q=${q}&search_type=keyword_unordered&media_type=all`;
}

export class MetaAdLibraryConnector implements Connector {
  id = 'meta_ads_lib';
  source = 'custom' as const;  // emits as 'custom' since X/news/reddit/etc. don't fit
  mode = 'live' as const;

  async poll(opts: ConnectorPollOpts): Promise<ConnectorResult> {
    const competitors = opts.competitors ?? [];
    if (competitors.length === 0) {
      return { ok: true, source: 'custom', mode: 'live', signals: [], fetchedAt: new Date() };
    }
    const geoRaw = (opts.geo || opts.credentials?.GTRENDS_GEO || 'India').toLowerCase();
    const iso = COUNTRY_ISO[geoRaw] ?? COUNTRY_ISO[geoRaw.replace(/-/g, ' ')] ?? 'IN';

    const signals: RawSignal[] = competitors.slice(0, 12).map(competitor => ({
      source: 'custom',
      title: `${competitor} · Meta Ad Library`,
      summary: `Live competitor ad activity for ${competitor} in ${iso}. Click through to inspect creative, spend trends, and recent variants on Meta's public Ad Library.`,
      hashtags: ['#meta-ads', '#competitor-activity'],
      lineage: `[meta-ads:${iso}] Meta Ad Library · ${competitor}`,
      firstSeenAt: new Date(),
      // Reach / velocity unknown without headless-browser scraping.
      // Per CLAUDE.md rule 1, we emit 0 and let UI render '—'.
      velocity: 0,
      reach: 0,
      sentiment: 0,
      // Mark the competitor explicitly so this row lands in Competitor
      // Activity column AND any meta-ads column the operator builds.
      competitorClaimants: [competitor],
      formatFatigue: 0,
      url: deepLink(competitor, iso),
      externalId: `meta_ads:${iso}:${competitor.toLowerCase().replace(/\s+/g, '_')}`,
    }));

    return { ok: true, source: 'custom', mode: 'live', signals, fetchedAt: new Date() };
  }
}
