// Google Trends real-time connector — free, no auth.
//
// We tried the /trends/api/dailytrends and /realtimetrends JSON endpoints
// first, but Google now requires session cookies on those. The RSS feed
// at /trending/rss?geo=XX is the stable free alternative — it's been
// running for 10+ years and surfaces the daily-trending searches with
// approximate traffic, source articles, and an explore link.
//
// Override geo via GTRENDS_GEO. Default "IN".

import { XMLParser } from 'fast-xml-parser';
import type { Connector, ConnectorPollOpts, ConnectorResult } from './types';
import type { RawSignal } from '@/lib/scoring/engine';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

interface RssItem {
  title: string;
  description?: string;
  pubDate: string;
  'ht:approx_traffic'?: string | number;
  'ht:news_item'?: NewsItem | NewsItem[];
  'ht:picture'?: string;
  'ht:picture_source'?: string;
}
interface NewsItem {
  'ht:news_item_title'?: string;
  'ht:news_item_url'?: string;
  'ht:news_item_source'?: string;
  'ht:news_item_picture'?: string;
}

export class GoogleTrendsConnector implements Connector {
  id = 'gtrends_live';
  source = 'google_trends' as const;
  mode = 'live' as const;

  async poll(opts: ConnectorPollOpts): Promise<ConnectorResult> {
    // Geo precedence: per-call override > org credential > env > default IN.
    // Accepts ISO codes (IN, US), Google state codes (IN-MH, US-NY), or
    // US DMA codes for city-level (e.g. 501 = New York).
    const geo = opts.geo || opts.credentials?.GTRENDS_GEO || process.env.GTRENDS_GEO || 'IN';
    const competitorSet = new Set((opts.competitors ?? []).map(c => c.toLowerCase()));
    const keywords = (opts.brandKeywords ?? []).map(k => k.toLowerCase()).filter(Boolean);
    // Default to emit-all for Google Trends — its job is "what's trending
    // now", a column titled "Trending in X" should never be empty.
    const emitAll = opts.emitAll ?? true;
    const signals: RawSignal[] = [];

    try {
      const url = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`;
      const res = await fetch(url, {
        headers: { 'user-agent': 'trendjack/1.0', accept: 'application/rss+xml, application/xml;q=0.9' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        return { ok: false, source: 'google_trends', mode: 'live', reason: `gtrends_rss_${res.status}` };
      }
      const xml = await res.text();
      const json = parser.parse(xml);
      const channel = json?.rss?.channel;
      const items = (Array.isArray(channel?.item) ? channel.item : channel?.item ? [channel.item] : []) as RssItem[];

      for (const it of items.slice(0, 20)) {
        const pub = new Date(it.pubDate);
        if (Number.isNaN(pub.getTime())) continue;
        const title = it.title;
        const blob = title.toLowerCase();
        const matchKw = keywords.length === 0 || keywords.some(k => blob.includes(k));

        const competitorClaimants = [...competitorSet].filter(c => blob.includes(c));
        const news = Array.isArray(it['ht:news_item']) ? it['ht:news_item'] : it['ht:news_item'] ? [it['ht:news_item']] : [];
        const article = news[0];
        const traffic = parseTraffic(it['ht:approx_traffic']);

        // Quality filters — Google Trends RSS dumps a lot of noise:
        // single-word non-Latin queries with no news context are useless
        // for brand-fit scoring. Skip them unless the keyword filter
        // explicitly hit. Also require a news article OR a brand-keyword
        // hit OR a competitor mention so we never persist context-free
        // garbage like "मु" or "sinner".
        const hasNewsArticle = !!(article?.['ht:news_item_url']);
        const isShort = title.trim().length < 4;
        const isSingleNonLatinWord = !/\s/.test(title.trim()) && !/[a-z0-9]/i.test(title);
        const passesQuality = (matchKw || competitorClaimants.length > 0 || hasNewsArticle)
          && !isShort
          && !isSingleNonLatinWord;
        if (!passesQuality && !matchKw) continue;
        if (!matchKw && !emitAll && !hasNewsArticle) continue;

        signals.push({
          source: 'google_trends',
          title: title.slice(0, 200),
          summary: ((article?.['ht:news_item_title'] ?? '') as string).slice(0, 240) || `Trending in ${geo}.`,
          hashtags: ['#GoogleTrends'],
          lineage: `Google Trends · ${geo}${article?.['ht:news_item_source'] ? ` · top src: ${article['ht:news_item_source']}` : ''} · ${it['ht:approx_traffic'] ?? '—'}`,
          firstSeenAt: pub,
          velocity: Math.max(10, traffic / 1000),
          reach: traffic,
          sentiment: 0,
          competitorClaimants,
          formatFatigue: 0,
          url: (article?.['ht:news_item_url'] as string) ?? `https://trends.google.com/trends/explore?q=${encodeURIComponent(title)}&geo=${geo}`,
          externalId: `gtrends:${geo}:${hash(title + pub.toISOString())}`,
        });
      }
    } catch (e) {
      return { ok: false, source: 'google_trends', mode: 'live', reason: `gtrends_${(e as Error).message}` };
    }

    return { ok: true, source: 'google_trends', mode: 'live', signals, fetchedAt: new Date() };
  }
}

function parseTraffic(raw: string | number | undefined): number {
  if (!raw) return 5000;
  const s = String(raw);
  const m = s.match(/^([\d.]+)\s*([KkMm]?)\+?$/);
  if (!m) return 5000;
  const n = parseFloat(m[1]);
  if (m[2] === 'K' || m[2] === 'k') return n * 1000;
  if (m[2] === 'M' || m[2] === 'm') return n * 1_000_000;
  return n;
}

function hash(s: string): string {
  let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0; return Math.abs(h).toString(36);
}
