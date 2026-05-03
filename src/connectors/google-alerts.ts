// Google Alerts — operator-curated brand-mention monitor.
//
// Google Alerts publishes RSS feeds for queries the operator creates at
// https://www.google.com/alerts. Each feed URL covers one query and
// surfaces 1–50 results per day, batched. Latency is 1–24 hours — too
// slow for real-time trend hijacking, but excellent for:
//   - long-tail brand-mention coverage on niche blogs/forums
//   - "is this still being discussed 3 days later?" sentinel
//   - Patient-Zero detection on smaller sites the other connectors miss
//
// Operator flow:
//   1. Create alerts at google.com/alerts
//   2. Click "Manage alerts" → click each alert → copy the "Feed" URL
//   3. Paste comma-separated URLs into the connector's GOOGLE_ALERTS_FEEDS
//      org credential (or env var)
//
// Demonstrates the ≤10-LoC connector registration pattern. The poll
// function is the only thing connector-specific; the registry wraps it.

import { XMLParser } from 'fast-xml-parser';
import { register, type ConnectorContext } from '@/src/core/connectors/registry';
import type { RawSignal } from '@/src/core/scoring/types';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

interface AtomEntry {
  title: string | { '#text': string };
  link: string | { '@_href': string };
  published?: string;
  updated?: string;
  content?: string | { '#text': string };
  id?: string;
}

async function pollGoogleAlerts(ctx: ConnectorContext): Promise<RawSignal[]> {
  const feedsRaw = ctx.credentials.GOOGLE_ALERTS_FEEDS || process.env.GOOGLE_ALERTS_FEEDS;
  if (!feedsRaw) return []; // unconfigured — silent no-op
  const feeds = feedsRaw.split(',').map(s => s.trim()).filter(Boolean);
  const competitorSet = new Set(ctx.competitors.map(c => c.toLowerCase()));
  const signals: RawSignal[] = [];

  for (const feedUrl of feeds) {
    try {
      const res = await fetch(feedUrl, {
        headers: { accept: 'application/atom+xml, application/xml;q=0.9' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const json = parser.parse(xml);
      const entries: AtomEntry[] =
        Array.isArray(json?.feed?.entry) ? json.feed.entry :
        json?.feed?.entry ? [json.feed.entry] :
        [];

      for (const e of entries.slice(0, 20)) {
        const title = stripTags(textOf(e.title));
        const link = linkOf(e.link);
        const pub = new Date(e.published || e.updated || Date.now());
        const ageHours = Math.max(0.5, (Date.now() - pub.getTime()) / 3_600_000);
        const blob = (title + ' ' + (textOf(e.content) ?? '')).toLowerCase();
        signals.push({
          source: 'news',                    // alerts categorize as news for column matching
          title: title.slice(0, 200),
          summary: stripTags(textOf(e.content) ?? '').slice(0, 220),
          hashtags: [],
          lineage: `Google Alerts · ${ageHours.toFixed(1)}h ago`,
          firstSeenAt: pub,
          velocity: 30 / ageHours,           // slow signal, modest velocity
          reach: 0,                           // alerts have no engagement metric
          sentiment: 0,
          competitorClaimants: [...competitorSet].filter(c => blob.includes(c)),
          formatFatigue: 0,
          url: link,
          externalId: `gnalerts:${e.id ?? hash(link + pub.toISOString())}`,
        });
      }
    } catch { /* skip failed feed */ }
  }
  return signals;
}

function textOf(v: AtomEntry['title'] | undefined): string {
  if (!v) return '';
  return typeof v === 'string' ? v : (v['#text'] ?? '');
}
function linkOf(v: AtomEntry['link']): string {
  if (typeof v === 'string') return v;
  return v?.['@_href'] ?? '';
}
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, m => ({ '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'" }[m] ?? ' ')).trim();
}
function hash(s: string): string {
  let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0; return Math.abs(h).toString(36);
}

// ─────────────────────────────────────────────────────────────────────
// REGISTRATION — this is the entire ≤10-LoC pattern in action.
// ─────────────────────────────────────────────────────────────────────
register({
  id: 'google_alerts',
  source: 'news',
  cadenceSec: 3600,                          // hourly (Google batches anyway)
  poll: pollGoogleAlerts,
  requires: ['GOOGLE_ALERTS_FEEDS'],
});
