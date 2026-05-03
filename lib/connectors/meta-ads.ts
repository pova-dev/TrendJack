// Meta Ad Library connector — competitor-page-aware.
//
// What changed (operator feedback): keyword search on Meta returns
// fuzzy matches that are unreliable — a card claiming "Nothing
// mobile · active" was a false alarm because we never verified
// active ads. The right URL pattern is page-id targeted:
//
//   https://www.facebook.com/ads/library/
//     ?active_status=active
//     &ad_type=all
//     &country=<ISO>
//     &is_targeted_country=false
//     &media_type=all
//     &search_type=page
//     &sort_data[direction]=desc
//     &sort_data[mode]=total_impressions
//     &view_all_page_id=<FB_PAGE_ID>
//
// Operators provide a competitor → Facebook Page ID map via
// /brand → 'Competitor Meta Page IDs'. With the ID set, we link
// directly to that page's active ads (sorted by total impressions).
// Without an ID, we fall back to keyword search BUT we tag the
// signal with `[meta-ads:search-fallback]` and the summary explicitly
// says "name search may include false matches — provide a Page ID
// for grounded results". No false-alarm "active" claim.
//
// Lightweight HTML probe: we hit the page-ID URL with a HEAD-style
// fetch and parse <title> / og:title / og:image when present. Meta's
// public pages expose these in the SSR HTML. We do NOT scrape
// individual ad creative — that requires headless-browser rendering
// (parked work).

import type { Connector, ConnectorPollOpts, ConnectorResult } from './types';
import type { RawSignal } from '@/lib/scoring/engine';

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

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function pageIdLink(pageId: string, iso: string): string {
  // Sort by total_impressions DESC so the most-active ads land first
  // when the operator clicks through.
  return [
    'https://www.facebook.com/ads/library/',
    `?active_status=active`,
    `&ad_type=all`,
    `&country=${iso}`,
    `&is_targeted_country=false`,
    `&media_type=all`,
    `&search_type=page`,
    `&sort_data[direction]=desc`,
    `&sort_data[mode]=total_impressions`,
    `&view_all_page_id=${pageId}`,
  ].join('');
}

function searchFallbackLink(competitor: string, iso: string): string {
  // No FB Page ID mapped — fall back to keyword search. Operator
  // gets a card flagged as 'search-fallback' so they know it's fuzzy.
  return [
    'https://www.facebook.com/ads/library/',
    `?active_status=all`,
    `&ad_type=all`,
    `&country=${iso}`,
    `&q=${encodeURIComponent(competitor)}`,
    `&search_type=keyword_unordered`,
    `&media_type=all`,
  ].join('');
}

interface ProbeResult {
  ogTitle?: string;
  ogImage?: string;
}

/** Best-effort Meta page metadata probe. Pulls the SSR HTML and
 *  extracts og:title + og:image when Meta exposes them (they often do
 *  for the page-id flavored URL). Times out fast — failures don't
 *  block emission. */
async function probeMetaMeta(url: string): Promise<ProbeResult> {
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': UA,
        accept: 'text/html',
        'accept-language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return {};
    const html = await res.text();
    // Meta strips og: tags from logged-out pages occasionally; HTML may
    // also be served as a JS shell. Try a few patterns.
    const ogTitle = matchMeta(html, 'og:title') ?? matchTitle(html);
    const ogImage = matchMeta(html, 'og:image');
    return {
      ogTitle: ogTitle?.slice(0, 200),
      ogImage: ogImage?.slice(0, 500),
    };
  } catch {
    return {};
  }
}

function matchMeta(html: string, prop: string): string | undefined {
  const re = new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
  const m = re.exec(html);
  return m?.[1];
}
function matchTitle(html: string): string | undefined {
  const m = /<title>([^<]+)<\/title>/i.exec(html);
  return m?.[1];
}

export class MetaAdLibraryConnector implements Connector {
  id = 'meta_ads_lib';
  source = 'custom' as const;
  mode = 'live' as const;

  async poll(opts: ConnectorPollOpts): Promise<ConnectorResult> {
    const competitors = opts.competitors ?? [];
    if (competitors.length === 0) {
      return { ok: true, source: 'custom', mode: 'live', signals: [], fetchedAt: new Date() };
    }
    const geoRaw = (opts.geo || opts.credentials?.GTRENDS_GEO || 'India').toLowerCase();
    const iso = COUNTRY_ISO[geoRaw] ?? COUNTRY_ISO[geoRaw.replace(/-/g, ' ')] ?? 'IN';
    const pageMap = opts.competitorPageIds ?? {};

    // Probe all competitor pages in parallel — fast HTML fetches,
    // 5s timeout each, failures are silently empty. Operator's
    // dashboard renders within ~5s even if Meta is slow.
    const probes = await Promise.all(
      competitors.slice(0, 12).map(async (competitor): Promise<RawSignal | null> => {
        const pageId = pageMap[competitor];
        if (pageId) {
          const url = pageIdLink(pageId, iso);
          const meta = await probeMetaMeta(url);
          // og:image and og:title presence imply the page exists and is
          // surfacing data publicly. We surface what we have; we DON'T
          // claim an ad count we don't know.
          const titleHint = meta.ogTitle && meta.ogTitle !== 'Ad Library' ? meta.ogTitle : null;
          return {
            source: 'custom',
            title: titleHint
              ? `${competitor} · Meta Ads · ${titleHint.slice(0, 60)}`
              : `${competitor} · Meta Ad Library`,
            summary: `Direct deep-link to ${competitor}'s Facebook Page ad activity in ${iso}, sorted by total impressions. Click through to inspect creative + spend trends. Page ID: ${pageId}.`,
            hashtags: ['#meta-ads', '#competitor-activity'],
            lineage: `[meta-ads:${iso}] Meta Ad Library · page_id=${pageId} · ${competitor}`,
            firstSeenAt: new Date(),
            // Engagement / spend unknown without rendering the JS shell.
            // Per CLAUDE.md rule 1: emit 0 + UI shows '—' instead of
            // fabricated counts. og:image presence is encoded in the
            // catalyst field below as a soft "yes there's a real page".
            velocity: 0,
            reach: 0,
            sentiment: 0,
            competitorClaimants: [competitor],
            formatFatigue: 0,
            url,
            // Use catalyst to surface the og:image when available so the
            // dashboard can show a thumbnail without claiming ads exist.
            catalyst: meta.ogImage,
            externalId: `meta_ads:${iso}:page:${pageId}`,
          };
        } else {
          // No FB Page ID mapped — keyword fallback with explicit warning.
          return {
            source: 'custom',
            title: `${competitor} · Meta Ad Library (search-fallback)`,
            summary: `No Facebook Page ID mapped for ${competitor}. Click through opens a name-keyword search on Meta — results may include false matches. Add a Page ID at /brand → Competitor Meta Page IDs for grounded results.`,
            hashtags: ['#meta-ads', '#competitor-activity', '#search-fallback'],
            lineage: `[meta-ads:${iso}:search-fallback] Meta Ad Library · keyword=${competitor}`,
            firstSeenAt: new Date(),
            velocity: 0,
            reach: 0,
            sentiment: 0,
            competitorClaimants: [competitor],
            formatFatigue: 0,
            url: searchFallbackLink(competitor, iso),
            externalId: `meta_ads:${iso}:search:${competitor.toLowerCase().replace(/\s+/g, '_')}`,
          };
        }
      }),
    );

    return {
      ok: true,
      source: 'custom',
      mode: 'live',
      signals: probes.filter((s): s is RawSignal => s !== null),
      fetchedAt: new Date(),
    };
  }
}
