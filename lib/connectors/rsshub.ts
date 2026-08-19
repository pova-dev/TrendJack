// RSSHub connector — RSSHub turns almost any platform into RSS, including
// TikTok, Instagram, Bilibili, Weibo, ProductHunt, Substack, and more.
// We accept a list of RSSHub paths in env and treat each as a custom feed.
//
// Env:
//   RSSHUB_BASE="https://rsshub.app"           # or self-hosted
//   RSSHUB_FEEDS="/twitter/keyword/POVA,/producthunt/today,/tiktok/user/@vishnuxd"
//
// Each feed becomes a generic 'custom' source unless the path obviously
// maps to one of our enums (twitter→x, tiktok→tiktok, etc.).

import { XMLParser } from 'fast-xml-parser';
import type { Connector, ConnectorPollOpts, ConnectorResult } from './types';
import type { RawSignal } from '@/src/core/scoring';
import type { SourceId } from '@/types';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function inferSource(path: string): SourceId {
  if (path.startsWith('/twitter') || path.startsWith('/nitter') || path.startsWith('/x')) return 'x';
  if (path.startsWith('/reddit')) return 'reddit';
  if (path.startsWith('/youtube')) return 'youtube';
  if (path.startsWith('/tiktok')) return 'tiktok';
  if (path.startsWith('/google/trend')) return 'google_trends';
  return 'custom';
}

interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  description?: string;
  author?: string;
}

export class RsshubConnector implements Connector {
  id = 'rsshub';
  source = 'custom' as const;
  mode = 'live' as const;

  async poll(opts: ConnectorPollOpts): Promise<ConnectorResult> {
    const base = opts.credentials?.RSSHUB_BASE || process.env.RSSHUB_BASE;
    const feedsRaw = opts.credentials?.RSSHUB_FEEDS || process.env.RSSHUB_FEEDS;
    if (!base || !feedsRaw) {
      return { ok: false, source: 'custom', mode: 'live', reason: 'rsshub_not_configured' };
    }
    const feeds = feedsRaw.split(',').map(s => s.trim()).filter(Boolean);
    const competitorSet = new Set((opts.competitors ?? []).map(c => c.toLowerCase()));
    const signals: RawSignal[] = [];

    for (const path of feeds) {
      try {
        const url = `${base}${path}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) continue;
        const xml = await res.text();
        const json = parser.parse(xml);
        const channel = json?.rss?.channel;
        const items = (Array.isArray(channel?.item) ? channel.item : channel?.item ? [channel.item] : []) as RssItem[];
        const inferred = inferSource(path);

        for (const it of items.slice(0, 10)) {
          const pub = new Date(it.pubDate);
          if (Number.isNaN(pub.getTime())) continue;
          const ageHours = Math.max(0.5, (Date.now() - pub.getTime()) / 3_600_000);
          const blob = (it.title + ' ' + (it.description ?? '')).toLowerCase();
          const competitorClaimants = [...competitorSet].filter(c => blob.includes(c));
          signals.push({
            source: inferred,
            title: cleanHtml(it.title).slice(0, 200),
            summary: cleanHtml(it.description ?? '').slice(0, 240),
            hashtags: extractHashtags(blob),
            lineage: `RSSHub feed ${path}; ${ageHours.toFixed(1)}h ago.`,
            firstSeenAt: pub,
            velocity: 30 / ageHours,
            // RSSHub feeds don't expose engagement metrics. Previously
            // fabricated 5_000/ageHours; we now emit 0 (UI renders "—")
            // rather than show a synthetic number that looks real.
            reach: 0,
            sentiment: 0,
            competitorClaimants,
            formatFatigue: 0.05,
            url: it.link,
            externalId: `rsshub:${path}:${hash(it.link)}`,
          });
        }
      } catch { /* skip failed feed */ }
    }

    return { ok: true, source: 'custom', mode: 'live', signals, fetchedAt: new Date() };
  }
}

function cleanHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, m => ({ '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'" }[m] ?? ' ')).trim();
}
function extractHashtags(blob: string): string[] {
  return Array.from(new Set((blob.match(/#\w{2,32}/g) ?? []).slice(0, 6)));
}
function hash(s: string): string {
  let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0; return Math.abs(h).toString(36);
}
