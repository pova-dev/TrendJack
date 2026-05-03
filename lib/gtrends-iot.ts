// Google Trends interest-over-time fetcher.
//
// Two-step protocol used by the public trends.google.com/trends/explore
// page:
//
//   1. GET /trends/api/explore?req={comparisonItem,...} → returns
//      {widgets: [{id:'TIMESERIES', token, request}, ...]}
//   2. GET /trends/api/widgetdata/multiline?token=<step1.token>
//          &req=<step1.request> → returns
//      {default:{timelineData:[{time, formattedTime, value:[normalised]}]}}
//
// Both endpoints are rate-limited per IP (~5-10/min un-cookied, more
// with a warm session cookie). We cache aggressively (1h TTL per term)
// and we ONLY fetch on demand — the drawer's "Trend Over Time" tab
// triggers a single fetch when the user opens it. No eager pre-fetch
// from the cron path.
//
// The response shape from Google is a 0..100 normalised series — 100
// is the relative peak within the requested time window, NOT absolute
// search volume. The drawer renders it with a y-axis label "relative
// search interest (0–100)" so operators don't misread the numbers.
//
// Resilience:
//   * 429 → throw 'rate_limited' so the route returns a 503 and the
//     drawer shows a "Google rate-limited; try again in a few minutes"
//     message instead of a broken graph.
//   * Cookie warmup — we hit /trends/explore once per process to get a
//     NID cookie, which roughly 5x the rate budget vs. cold requests.

import 'server-only';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export type IotTimeRange = 'now 1-d' | 'now 7-d' | 'today 1-m' | 'today 3-m' | 'today 12-m';

export interface IotPoint {
  /** Unix epoch seconds. */
  time: number;
  /** Human-readable label from Google ("Apr 28, 6 PM", etc.). */
  label: string;
  /** Normalised 0–100 — relative within the requested window. */
  value: number;
}

export interface IotSeries {
  term: string;
  geo: string;
  timeRange: IotTimeRange;
  points: IotPoint[];
  /** Peak value (max of points). Used to label the chart axis. */
  peak: number;
  fetchedAt: Date;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
interface CacheEntry { series: IotSeries; fetchedAt: number }
const cache = new Map<string, CacheEntry>();

function cacheKey(term: string, geo: string, range: IotTimeRange): string {
  return `${term.toLowerCase()}|${geo.toUpperCase()}|${range}`;
}

// Cookie jar: we keep one set per Node process. The first call hits
// /trends/explore which sets NID/AEC; subsequent calls reuse.
let cookieHeader: string | null = null;
let cookieFetchedAt = 0;
const COOKIE_TTL_MS = 30 * 60 * 1000;

async function ensureCookies(geo: string, term: string): Promise<void> {
  if (cookieHeader && Date.now() - cookieFetchedAt < COOKIE_TTL_MS) return;
  const url = `https://trends.google.com/trends/explore?q=${encodeURIComponent(term)}&geo=${encodeURIComponent(geo)}`;
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html' },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 429) throw new Error('rate_limited');
  // Collect Set-Cookie headers and serialise to a Cookie header string.
  // Note: Node's fetch returns Set-Cookie as either a single string (older
  // versions) or via getSetCookie() (Node 20+). We support both.
  const sc = (typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : (res.headers.get('set-cookie')?.split(/, (?=[^;]+=[^;]+)/) ?? []));
  cookieHeader = sc.map(c => c.split(';')[0]).join('; ');
  cookieFetchedAt = Date.now();
}

export async function getInterestOverTime(
  term: string,
  opts: { geo?: string; timeRange?: IotTimeRange } = {},
): Promise<IotSeries> {
  const geo = (opts.geo ?? 'IN').toUpperCase();
  const timeRange = opts.timeRange ?? 'now 7-d';
  const key = cacheKey(term, geo, timeRange);

  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.series;

  await ensureCookies(geo, term);

  // Step 1: explore → widget tokens
  const exploreReq = {
    comparisonItem: [{ keyword: term, geo, time: timeRange }],
    category: 0,
    property: '',
  };
  const exploreUrl = `https://trends.google.com/trends/api/explore?hl=en-US&tz=-330&req=${encodeURIComponent(JSON.stringify(exploreReq))}`;
  const r1 = await fetch(exploreUrl, {
    headers: {
      'user-agent': UA,
      accept: 'application/json',
      cookie: cookieHeader ?? '',
      referer: `https://trends.google.com/trends/explore?q=${encodeURIComponent(term)}&geo=${encodeURIComponent(geo)}`,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (r1.status === 429) throw new Error('rate_limited');
  if (!r1.ok) throw new Error(`explore_${r1.status}`);
  const explore = parseGoogleJson(await r1.text());
  const widgets = (explore as { widgets?: Array<{ id: string; token: string; request: unknown }> }).widgets ?? [];
  const ts = widgets.find(w => w.id === 'TIMESERIES');
  if (!ts) throw new Error('no_timeseries_widget');

  // Step 2: widgetdata/multiline → actual points
  const dataUrl = `https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=-330&req=${encodeURIComponent(JSON.stringify(ts.request))}&token=${encodeURIComponent(ts.token)}`;
  const r2 = await fetch(dataUrl, {
    headers: {
      'user-agent': UA,
      accept: 'application/json',
      cookie: cookieHeader ?? '',
      referer: 'https://trends.google.com/',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (r2.status === 429) throw new Error('rate_limited');
  if (!r2.ok) throw new Error(`multiline_${r2.status}`);
  const data = parseGoogleJson(await r2.text()) as {
    default?: { timelineData?: Array<{ time: string; formattedTime: string; value: number[] }> };
  };

  const raw = data.default?.timelineData ?? [];
  const points: IotPoint[] = raw.map(p => ({
    time: parseInt(p.time, 10),
    label: p.formattedTime,
    value: Array.isArray(p.value) && typeof p.value[0] === 'number' ? p.value[0] : 0,
  }));
  const peak = points.reduce((m, p) => Math.max(m, p.value), 0);

  const series: IotSeries = { term, geo, timeRange, points, peak, fetchedAt: new Date() };
  cache.set(key, { series, fetchedAt: Date.now() });
  return series;
}

/** Strip Google's `)]}'\n` XSSI prefix and JSON.parse. */
function parseGoogleJson(text: string): unknown {
  const stripped = text.startsWith(")]}'") ? text.slice(text.indexOf('\n') + 1) : text;
  return JSON.parse(stripped);
}

/** Test seam — used by tests to clear the in-memory cache between cases. */
export function _resetIotCacheForTesting(): void {
  cache.clear();
  cookieHeader = null;
  cookieFetchedAt = 0;
}
