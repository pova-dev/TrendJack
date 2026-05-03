// Nitter connector — fetches Twitter/X content via the open-source Nitter
// frontend's RSS endpoints. Most public Nitter instances rate-limit
// aggressively or rotate; we accept a list and round-robin until one works.
//
// Usage:
//   NITTER_INSTANCES="https://nitter.net,https://nitter.privacydev.net"
//
// Two query modes:
//   - per-account:   /<handle>/rss               (track a competitor / influencer)
//   - per-search:    /search/rss?q=<query>       (track a topic / hashtag)
//
// Nitter is fragile by nature; failures don't kill the poll, we just try
// the next instance. If all instances fail we return ok:false so the UI
// can show "Nitter unavailable" instead of silently substituting.

import { XMLParser } from 'fast-xml-parser';
import type { Connector, ConnectorPollOpts, ConnectorResult } from './types';
import type { RawSignal } from '@/lib/scoring/engine';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

// Public Nitter instances die fast — most well-known mirrors have either
// been blocked by X or shut down. nitter.net is the most reliable as of
// late 2025. For production, prefer X_BEARER_TOKEN (the official v2
// connector takes priority when present) or self-host Nitter.
const DEFAULT_INSTANCES = [
  'https://nitter.net',
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
  'https://nitter.cz',
  'https://nitter.salastil.com',
  'https://nitter.kavin.rocks',
  'https://nitter.unixfox.eu',
];

interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  description?: string;
  'dc:creator'?: string;
}

function getInstances(creds?: Record<string, string>): string[] {
  const env = creds?.NITTER_INSTANCES || process.env.NITTER_INSTANCES;
  if (env) return env.split(',').map(s => s.trim()).filter(Boolean);
  return DEFAULT_INSTANCES;
}

async function fetchInstance(base: string, path: string): Promise<RssItem[]> {
  const res = await fetch(`${base}${path}`, {
    headers: { 'user-agent': 'trendjack/1.0', accept: 'application/rss+xml, application/xml;q=0.9' },
    // Some Nitter instances are slow.
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`nitter_${res.status}`);
  const xml = await res.text();
  const json = parser.parse(xml);
  const channel = json?.rss?.channel;
  return Array.isArray(channel?.item) ? channel.item : channel?.item ? [channel.item] : [];
}

export class NitterConnector implements Connector {
  id = 'nitter_live';
  source = 'x' as const;
  mode = 'live' as const;

  async poll(opts: ConnectorPollOpts): Promise<ConnectorResult> {
    const instances = getInstances(opts.credentials);
    const competitorSet = new Set((opts.competitors ?? []).map(c => c.toLowerCase()));
    const queries = (opts.brandKeywords ?? []).slice(0, 3).filter(Boolean);
    const handles = (opts.competitors ?? []).slice(0, 5);
    const signals: RawSignal[] = [];
    let success = false;
    let lastErr = '';

    const tryEach = async (path: string) => {
      for (const base of instances) {
        try {
          const items = await fetchInstance(base, path);
          for (const it of items.slice(0, 8)) {
            const pub = new Date(it.pubDate);
            if (Number.isNaN(pub.getTime())) continue;
            const ageHours = Math.max(0.5, (Date.now() - pub.getTime()) / 3_600_000);
            const blob = (it.title + ' ' + (it.description ?? '')).toLowerCase();
            const competitorClaimants = [...competitorSet].filter(c => blob.includes(c));
            signals.push({
              source: 'x',
              title: cleanHtml(it.title).slice(0, 200),
              summary: cleanHtml(it.description ?? '').slice(0, 240),
              hashtags: extractHashtags(blob),
              lineage: `Nitter via ${new URL(base).hostname}; ${ageHours.toFixed(1)}h ago.`,
              firstSeenAt: pub,
              velocity: 60 / ageHours,
              reach: 5_000 / Math.max(1, ageHours),
              sentiment: 0,
              competitorClaimants,
              formatFatigue: 0.05,
              url: it.link,
              externalId: `nitter:${hash(it.link)}`,
            });
          }
          success = true;
          return;
        } catch (e) {
          lastErr = (e as Error).message;
        }
      }
    };

    for (const h of handles) await tryEach(`/${encodeURIComponent(h)}/rss`);
    for (const q of queries) await tryEach(`/search/rss?q=${encodeURIComponent(q)}&f=tweets`);

    if (!success) {
      return {
        ok: false,
        source: 'x',
        mode: 'live',
        reason: `Public Nitter instances are unavailable (${lastErr || 'no instances reachable'}). X has been actively blocking Nitter since 2024. To pull X reliably, set X_BEARER_TOKEN in connector credentials — the official X v2 connector will take over automatically.`,
      };
    }
    return { ok: true, source: 'x', mode: 'live', signals, fetchedAt: new Date() };
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
