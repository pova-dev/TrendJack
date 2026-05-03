// Google News RSS connector — free, no auth, locale-aware. Builds queries
// from the brand's safe themes + competitors and parses the feed.
//
// Locale defaults to India English (hl=en-IN, gl=IN, ceid=IN:en) to match
// POVA's primary market; expose via opts in a future iteration.

import { XMLParser } from 'fast-xml-parser';
import type { Connector, ConnectorPollOpts, ConnectorResult } from './types';
import type { RawSignal } from '@/lib/scoring/engine';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  description?: string;
  source?: { '#text': string } | string;
}

export class GoogleNewsConnector implements Connector {
  id = 'gnews_live';
  source = 'news' as const;
  mode = 'live' as const;

  async poll(opts: ConnectorPollOpts): Promise<ConnectorResult> {
    // Fan out across three query types so each tick pulls a balanced mix:
    //   - brand keywords (specific products: "tecno pova", "pova curve")
    //   - competitor names (so we catch "Xiaomi launches", "Realme 13")
    //   - themes (so we still see broader category news)
    // Cap to ~8 total queries to stay within Google's RSS rate limits.
    const brandQs = (opts.brandKeywords ?? []).slice(0, 4);
    const compQs  = (opts.competitors ?? []).slice(0, 3);
    const themeQs = (opts.themes ?? []).slice(0, 2);
    const queries = (brandQs.length || compQs.length)
      ? Array.from(new Set([...brandQs, ...compQs, ...themeQs]))
      : ['smartphone India', 'phone launch'];
    const competitorSet = new Set((opts.competitors ?? []).map(c => c.toLowerCase()));
    const signals: RawSignal[] = [];

    for (const q of queries) {
      try {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}+when:1d&hl=en-IN&gl=IN&ceid=IN:en`;
        const res = await fetch(url, { headers: { 'user-agent': 'trendjack/1.0' } });
        if (!res.ok) continue;
        const xml = await res.text();
        const json = parser.parse(xml);
        const channel = json?.rss?.channel;
        const items = (Array.isArray(channel?.item) ? channel.item : channel?.item ? [channel.item] : []) as RssItem[];

        for (const it of items.slice(0, 12)) {
          const blob = (it.title + ' ' + (it.description ?? '')).toLowerCase();
          const competitorClaimants = [...competitorSet].filter(c => blob.includes(c));
          const pub = new Date(it.pubDate);
          if (Number.isNaN(pub.getTime())) continue;
          const ageHours = Math.max(0.5, (Date.now() - pub.getTime()) / 3_600_000);
          const sourceLabel = typeof it.source === 'string' ? it.source : it.source?.['#text'] ?? 'Google News';

          signals.push({
            source: 'news',
            title: cleanHtml(it.title),
            summary: cleanHtml(it.description ?? '').slice(0, 220),
            hashtags: ['#News'],
            lineage: `${sourceLabel} · published ${ageHours.toFixed(1)}h ago for query "${q}".`,
            firstSeenAt: pub,
            // Velocity proxy: news that just published has higher publishing
            // momentum than 12h-old news. Bounded; not an engagement metric.
            velocity: 60 / ageHours,
            // Google News RSS does NOT expose reach. Previous code fabricated
            // a number (50_000 / ageHours) which made every news card show
            // a plausible-looking but completely fake "50.0K reach". Ship 0
            // — the UI renders "—" so we don't lie about engagement we
            // don't have. Set `YOUTUBE_API_KEY` / X bearer / paid news APIs
            // for sources with real reach data.
            reach: 0,
            sentiment: 0,
            competitorClaimants,
            formatFatigue: 0.05,
            url: it.link,
            externalId: `gnews:${hash(it.link)}`,
          });
        }
      } catch { /* skip failed query */ }
    }

    return { ok: true, source: 'news', mode: 'live', signals, fetchedAt: new Date() };
  }
}

function cleanHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, m => ({ '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'" }[m] ?? ' ')).trim();
}
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0;
  return Math.abs(h).toString(36);
}
