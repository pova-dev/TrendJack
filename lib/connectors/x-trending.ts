// X (Twitter) Trending Now connector — country-scoped.
//
// X's official explore/trends API endpoint requires authenticated
// requests with a paid X API tier ($100/mo+). For dev/local use we
// scrape trends24.in, a public site that mirrors X's per-country
// trending list (~40 topics per country). Trends24 has been stable
// for years and doesn't gate scrapes; UA spoofing keeps us through.
//
// Country path slug map (must match trends24's URL scheme exactly,
// e.g. /india/, /united-states/). Operators set the country via
// brand.markets[0] OR per-call opts.geo. Falls back to 'india'.
//
// Each emitted RawSignal:
//   source: 'x'
//   title: trend name (hashtag or phrase)
//   summary: "Trending on X · {country}"
//   lineage: "[xtrend:<country>] X · trends24.in"
//   url: twitter.com search URL
//   externalId: stable hash so dedup works
//
// Limitation: trends24 doesn't reliably expose tweet-counts in the
// HTML. We emit reach=0 (UI renders '—') instead of fabricating —
// per CLAUDE.md hard rule 1.

import type { Connector, ConnectorPollOpts, ConnectorResult } from './types';
import type { RawSignal } from '@/src/core/scoring';

// Country name → trends24 path slug. Lowercase, dash-separated.
const COUNTRY_SLUG: Record<string, string> = {
  'india': 'india',
  'united states': 'united-states',
  'usa': 'united-states',
  'us': 'united-states',
  'united kingdom': 'united-kingdom',
  'uk': 'united-kingdom',
  'canada': 'canada',
  'australia': 'australia',
  'germany': 'germany',
  'france': 'france',
  'japan': 'japan',
  'brazil': 'brazil',
  'mexico': 'mexico',
  'netherlands': 'netherlands',
  'spain': 'spain',
  'italy': 'italy',
  'turkey': 'turkey',
  'south korea': 'south-korea',
  'korea': 'south-korea',
  'philippines': 'philippines',
  'indonesia': 'indonesia',
  'thailand': 'thailand',
  'malaysia': 'malaysia',
  'singapore': 'singapore',
  'south africa': 'south-africa',
  'argentina': 'argentina',
  'colombia': 'colombia',
  'global': 'worldwide',
  'world': 'worldwide',
  'worldwide': 'worldwide',
};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export class XTrendingConnector implements Connector {
  id = 'x_trending';
  source = 'x' as const;
  mode = 'live' as const;

  async poll(opts: ConnectorPollOpts): Promise<ConnectorResult> {
    const geo = opts.geo || opts.credentials?.GTRENDS_GEO || process.env.GTRENDS_GEO || 'India';
    const slug = COUNTRY_SLUG[geo.toLowerCase()] ?? COUNTRY_SLUG[geo.toLowerCase().replace(/-/g, ' ')] ?? 'india';
    // Sub-locality drilldown — trends24 supports paths like /india/mumbai/,
    // /united-states/new-york/, /united-kingdom/london/. The `geoSubregion`
    // opt is a lowercase-dashed slug operators set per-brand. When unset
    // we hit the country-level URL.
    const subregion = opts.geoSubregion?.trim().toLowerCase().replace(/\s+/g, '-');
    const url = subregion
      ? `https://trends24.in/${slug}/${subregion}/`
      : `https://trends24.in/${slug}/`;
    const country = slug.replace(/-/g, ' ');
    const localeLabel = subregion ? `${subregion.replace(/-/g, ' ')}, ${country}` : country;
    const competitorSet = new Set((opts.competitors ?? []).map(c => c.toLowerCase()));
    const keywords = (opts.brandKeywords ?? []).map(k => k.toLowerCase()).filter(Boolean);

    let html: string;
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        return { ok: false, source: 'x', mode: 'live', reason: `xtrend_${res.status}` };
      }
      html = await res.text();
    } catch (e) {
      return { ok: false, source: 'x', mode: 'live', reason: `xtrend_${(e as Error).message}` };
    }

    // Extract trend topics. Pattern (verified against live HTML):
    //   <a href="https://twitter.com/search?q=..." class=trend-link>{topic}</a>
    const regex = /<a href="https:\/\/twitter\.com\/search\?q=([^"]+)"\s+class=trend-link>([^<]+)<\/a>/g;
    const seen = new Set<string>();
    const signals: RawSignal[] = [];
    let m: RegExpExecArray | null;
    let rank = 0;
    while ((m = regex.exec(html)) !== null && rank < 30) {
      rank++;
      const title = m[2].trim();
      if (!title || seen.has(title.toLowerCase())) continue;
      seen.add(title.toLowerCase());

      const blob = title.toLowerCase();
      const matchKw = keywords.length === 0 || keywords.some(k => blob.includes(k));
      const competitorClaimants = [...competitorSet].filter(c => blob.includes(c));

      // Velocity proxy: rank-based — top-of-list gets the highest synthetic
      // velocity (trends24 is rank-ordered). Matches POVA's existing rank-
      // scaled velocity treatment for other sources without fabricating
      // numbers we don't have.
      const velocityProxy = Math.max(50, 600 - rank * 15);

      signals.push({
        source: 'x',
        title: title.slice(0, 200),
        summary: `Trending on X in ${localeLabel} (rank ${rank})`,
        hashtags: title.startsWith('#') ? [title] : [`#${title.replace(/\s+/g, '')}`],
        lineage: `[xtrend:${subregion ? `${slug}-${subregion}` : slug}] X · trends24.in · ${localeLabel} · rank #${rank}`,
        firstSeenAt: new Date(),
        velocity: velocityProxy,
        // Reach: 0 = "we don't know". UI renders '—' instead of a fabricated
        // number per CLAUDE.md hard rule 1.
        reach: 0,
        sentiment: 0,
        competitorClaimants,
        formatFatigue: 0,
        url: `https://twitter.com/search?q=${m[1]}&src=trend_click`,
        externalId: `x_trend:${subregion ? `${slug}-${subregion}` : slug}:${hash(title)}`,
      });
      if (!matchKw && (opts.emitAll ?? true) === false && competitorClaimants.length === 0) {
        // Operator opted out of emit-all — only emit brand-relevant.
        signals.pop();
      }
    }

    return { ok: true, source: 'x', mode: 'live', signals, fetchedAt: new Date() };
  }
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0;
  return Math.abs(h).toString(36);
}
