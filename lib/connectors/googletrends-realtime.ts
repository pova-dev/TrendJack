// Google Trends "Trending Now" realtime connector.
//
// Hits the boq RPC backing the trends.google.com/trending?geo=IN UI:
//
//   POST https://trends.google.com/_/TrendsUi/data/batchexecute
//        ?rpcids=i0OFE&hl=en-US
//        f.req=[[["i0OFE", "[null,null,\"IN\",0,\"en-US\",24,1]", null, "generic"]]]
//
// Args (decoded from the JSON-string in f.req):
//   [0] null
//   [1] null
//   [2] geo (ISO 3166-1 alpha-2 — "IN", "US", "GB"…)
//   [3] 0 (sort key — 0=volume desc, 1=newest first)
//   [4] hl ("en-US")
//   [5] hours window (24 / 4 / 1 — matches the page's time filter)
//   [6] 1 (mystery flag — observed value works)
//
// Response is the standard boq envelope:
//   )]}'\n
//   <byteLen>\n
//   [["wrb.fr","i0OFE","<json-string>"], …]
//
// Each trend in the inner JSON-string array has shape:
//   [title, _, geo, [unix_start_seconds], _, _, search_volume, _,
//    growth_pct, [related_terms], [status_codes], [article_ids], _]
//
// Why we don't just use the RSS feed at /trending/rss: that endpoint
// returns Google's older Daily Hot Searches snapshot, which is hours-
// to-a-day stale and pulls from a different ranking source. The RSS
// feed and this RPC return COMPLETELY DIFFERENT items even for the same
// geo — verified empirically against the live UI.
//
// This RPC is private. Google can change the rpcid, the arg shape, or
// the response wrapper at any time. We keep RSS as a fallback in the
// outer GoogleTrendsConnector so the column never goes empty during a
// Google deploy.

import type { Connector, ConnectorPollOpts, ConnectorResult } from './types';
import type { RawSignal } from '@/lib/scoring/engine';
import { classifyTrendCategory, type GtrendsCategoryId } from '@/lib/gtrends-classifier';

const RPC_ID = 'i0OFE';
const ENDPOINT = 'https://trends.google.com/_/TrendsUi/data/batchexecute';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

interface TrendItem {
  title: string;
  geo: string;
  startUnix: number;
  searchVolume: number;
  growthPct: number;
  relatedTerms: string[];
  statusCodes: number[];
}

export class GoogleTrendsRealtimeConnector implements Connector {
  id = 'gtrends_realtime';
  source = 'google_trends' as const;
  mode = 'live' as const;

  async poll(opts: ConnectorPollOpts): Promise<ConnectorResult> {
    const geo = opts.geo || opts.credentials?.GTRENDS_GEO || process.env.GTRENDS_GEO || 'IN';
    const hl  = opts.credentials?.GTRENDS_HL || 'en-US';
    const hours = 24;
    const competitorSet = new Set((opts.competitors ?? []).map(c => c.toLowerCase()));
    const keywords = (opts.brandKeywords ?? []).map(k => k.toLowerCase()).filter(Boolean);
    const emitAll = opts.emitAll ?? true;
    const signals: RawSignal[] = [];

    // Brand-level category keep-list. Empty = accept everything.
    const wantedCats = new Set<string>((opts.gtrendsCategories ?? []).filter(Boolean));
    const filterByCategory = wantedCats.size > 0;

    let items: TrendItem[];
    try {
      items = await fetchRealtime(geo, hl, hours);
    } catch (e) {
      // Bubble out so the outer GoogleTrendsConnector can fall back to RSS.
      return { ok: false, source: 'google_trends', mode: 'live', reason: `gtrends_rt_${(e as Error).message}` };
    }

    for (const it of items.slice(0, 30)) {
      const blob = it.title.toLowerCase();
      const matchKw = keywords.length === 0 || keywords.some(k => blob.includes(k));
      const competitorClaimants = [...competitorSet].filter(c => blob.includes(c));

      // Quality: skip context-free single-character titles.
      if (it.title.trim().length < 3) continue;
      if (!matchKw && !emitAll && competitorClaimants.length === 0) continue;

      // Classify by title + first related term as a host-less proxy.
      // The realtime RPC doesn't ship per-trend article URLs in the
      // first call (only opaque article ids). Using related terms +
      // title gives the title-keyword fallback enough context.
      const cat: GtrendsCategoryId = classifyTrendCategory({
        title: it.title,
        newsSource: it.relatedTerms[0],
      });
      if (filterByCategory && !wantedCats.has(cat) && !matchKw && competitorClaimants.length === 0) {
        continue;
      }

      // Velocity: search volume per hour-of-life. Clamped at 10/h
      // so brand-new items (1m old) don't blow out the velocity axis.
      const ageH = Math.max(1, (Date.now() / 1000 - it.startUnix) / 3600);
      const velocity = Math.min(10000, Math.max(10, it.searchVolume / ageH));

      signals.push({
        source: 'google_trends',
        title: it.title.slice(0, 200),
        summary: it.relatedTerms.slice(0, 5).join(' · ') || `Trending in ${geo} (${it.searchVolume.toLocaleString()}+ searches).`,
        hashtags: ['#GoogleTrends'],
        lineage: `[cat:${cat}] Google Trends · ${geo} · ${it.searchVolume.toLocaleString()}+ searches · ${it.growthPct >= 1000 ? '↑1000%+' : `↑${it.growthPct}%`} (${hours}h)`,
        firstSeenAt: new Date(it.startUnix * 1000),
        velocity,
        reach: it.searchVolume,
        sentiment: 0,
        competitorClaimants,
        formatFatigue: 0,
        url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(it.title)}&geo=${geo}`,
        externalId: `gtrends_rt:${geo}:${cat}:${hash(it.title + it.startUnix)}`,
      });
    }

    return { ok: true, source: 'google_trends', mode: 'live', signals, fetchedAt: new Date() };
  }
}

async function fetchRealtime(geo: string, hl: string, hours: number): Promise<TrendItem[]> {
  const args = [null, null, geo, 0, hl, hours, 1];
  const fReq = JSON.stringify([[[RPC_ID, JSON.stringify(args), null, 'generic']]]);
  const body = new URLSearchParams({ 'f.req': fReq }).toString();

  const res = await fetch(`${ENDPOINT}?rpcids=${RPC_ID}&source-path=%2Ftrending&hl=${encodeURIComponent(hl)}&_reqid=${Math.floor(Math.random() * 1_000_000)}&rt=c`, {
    method: 'POST',
    headers: {
      'user-agent': UA,
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      referer: `https://trends.google.com/trending?geo=${encodeURIComponent(geo)}`,
      origin: 'https://trends.google.com',
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const text = await res.text();
  return parseBoqResponse(text);
}

// Boq response envelope:
//   )]}'\n              ← XSSI prefix
//   <byteLen>\n         ← length of next chunk
//   [["wrb.fr","i0OFE","<json-string>"], …]
//
// We split on newlines, find the first line that starts with `[[`, and
// JSON.parse that. The third field of each wrb.fr triple is itself a
// JSON-string we have to parse a second time.
export function parseBoqResponse(raw: string): TrendItem[] {
  const lines = raw.split('\n').filter(l => l.trim().length > 0 && !l.startsWith(")]}'"));
  // Find the line that starts the wrb.fr envelope
  const envLine = lines.find(l => l.trimStart().startsWith('[['));
  if (!envLine) throw new Error('no_envelope');
  const env = JSON.parse(envLine);
  // env: [["wrb.fr", "i0OFE", "<json-string>", …], …]
  for (const tuple of env) {
    if (Array.isArray(tuple) && tuple[0] === 'wrb.fr' && tuple[1] === RPC_ID) {
      const payload = JSON.parse(tuple[2] as string);
      const list = payload?.[1];
      if (!Array.isArray(list)) return [];
      return list.map(toItem).filter((x: TrendItem | null): x is TrendItem => x !== null);
    }
  }
  throw new Error('no_wrb_fr');
}

function toItem(row: unknown[]): TrendItem | null {
  if (!Array.isArray(row) || typeof row[0] !== 'string') return null;
  const startArr = row[3] as number[] | null;
  return {
    title: row[0] as string,
    geo: (row[2] as string) ?? '',
    startUnix: Array.isArray(startArr) && typeof startArr[0] === 'number' ? startArr[0] : Math.floor(Date.now() / 1000),
    searchVolume: typeof row[6] === 'number' ? row[6] : 0,
    growthPct: typeof row[8] === 'number' ? row[8] : 0,
    relatedTerms: Array.isArray(row[9]) ? (row[9] as string[]).filter(s => typeof s === 'string') : [],
    statusCodes: Array.isArray(row[10]) ? (row[10] as number[]) : [],
  };
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0;
  return Math.abs(h).toString(36);
}
