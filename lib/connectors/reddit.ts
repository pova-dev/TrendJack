// Reddit live connector.
//
// Two auth modes, picked automatically:
//   1. OAuth (preferred) — when both REDDIT_CLIENT_ID and
//      REDDIT_CLIENT_SECRET are set, exchange them for a Client
//      Credentials Bearer token and hit `oauth.reddit.com` with the
//      higher ~100 req/min rate envelope. Token caches in-process.
//   2. Anonymous public JSON — falls back to `www.reddit.com/*.json`
//      with a UA-only header. Throttled ~30 req/min; will 429 under
//      cron load.
//
// Audit 2026-05-29 D7 — OAuth path was previously unimplemented; ingest
// reliably 429'd in production. Now uses OAuth when configured.

import type { Connector, ConnectorPollOpts, ConnectorResult } from './types';
import type { RawSignal } from '@/src/core/scoring';

const DEFAULT_UA = 'Mozilla/5.0 (compatible; TrendJackBot/1.0; +https://trendjack.app/about)';

// In-process OAuth token cache. Survives between polls within the same Node
// process; the worker / dev server reuses it across cron ticks.
interface RedditToken { value: string; expiresAt: number }
const TOKEN_CACHE = new Map<string, RedditToken>();

async function getOauthToken(clientId: string, clientSecret: string, ua: string): Promise<string | null> {
  const cacheKey = `${clientId}:${clientSecret}`;
  const cached = TOKEN_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.value;
  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': ua,
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    TOKEN_CACHE.set(cacheKey, {
      value: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    });
    return json.access_token;
  } catch {
    return null;
  }
}

interface RedditPost {
  data: {
    id: string; title: string; selftext: string;
    permalink: string; created_utc: number; ups: number; num_comments: number;
    subreddit: string; subreddit_name_prefixed: string;
    domain?: string; url?: string; over_18?: boolean;
    upvote_ratio?: number; score?: number;
  };
}

const DEFAULT_SUBS = [
  'IndianGaming', 'IndianTeenagers', 'india', 'tech', 'gadgets',
  'Android', 'androiddev', 'PUBATTLEGROUNDS', 'mobilegaming',
];

export class RedditLiveConnector implements Connector {
  id = 'reddit_live';
  source = 'reddit' as const;
  mode = 'live' as const;
  constructor(private subs: string[] = DEFAULT_SUBS) {}

  async poll(opts: ConnectorPollOpts): Promise<ConnectorResult> {
    const ua = opts.credentials?.REDDIT_USER_AGENT || process.env.REDDIT_USER_AGENT || DEFAULT_UA;
    const clientId = opts.credentials?.REDDIT_CLIENT_ID || process.env.REDDIT_CLIENT_ID;
    const clientSecret = opts.credentials?.REDDIT_CLIENT_SECRET || process.env.REDDIT_CLIENT_SECRET;
    const since = opts.since?.getTime() ?? Date.now() - 24 * 60 * 60 * 1000;
    const competitorSet = new Set((opts.competitors ?? []).map(c => c.toLowerCase()));
    const brandKw = (opts.brandKeywords ?? []).map(k => k.toLowerCase()).filter(Boolean);
    const competitors = (opts.competitors ?? []).filter(Boolean);
    const themes = (opts.themes ?? []).filter(Boolean);

    const signals: RawSignal[] = [];
    const seen = new Set<string>(); // dedupe by post id across both passes

    // Audit 2026-05-29 D7 — try OAuth first. If we get a token, switch
    // base URL to oauth.reddit.com (higher rate envelope).
    let baseUrl = 'https://www.reddit.com';
    const headers: Record<string, string> = { 'user-agent': ua, accept: 'application/json' };
    if (clientId && clientSecret) {
      const token = await getOauthToken(clientId, clientSecret, ua);
      if (token) {
        baseUrl = 'https://oauth.reddit.com';
        headers.authorization = `Bearer ${token}`;
      }
    }

    // PASS 1 — reddit-wide /search.json fan-out by brand keywords +
    // competitors + a couple themes. This is the primary signal: search
    // catches any post mentioning these terms regardless of sub.
    // Cap fan-out aggressively. Reddit rate-limits unauthenticated
    // requests at ~30/min; combined with the per-subreddit hot.json
    // pass below, we want fewer than 12 search calls per tick to leave
    // headroom for retries + avoid 429 / poll_timeout cascades.
    const searchTerms = Array.from(new Set([
      ...brandKw.slice(0, 3),
      ...competitors.slice(0, 2),
      ...themes.slice(0, 1),
    ]));
    // Per-request timeout + 200ms gap between requests. Without this,
    // 21 sequential requests fan out at full speed and Reddit's edge
    // either rate-limits us OR (worse) throttles the connection so the
    // 15s outer poll timeout fires.
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const fetchWithTimeout = async (url: string) => {
      try {
        return await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
      } catch { return null; }
    };

    for (const q of searchTerms) {
      const url = `${baseUrl}/search.json?q=${encodeURIComponent(q)}&sort=new&t=day&limit=15&raw_json=1`;
      const res = await fetchWithTimeout(url);
      if (!res || !res.ok) { await sleep(200); continue; }
      try {
        const json = await res.json() as { data?: { children?: RedditPost[] } };
        for (const c of json.data?.children ?? []) {
          this.appendSignal(c, since, competitorSet, signals, seen, `search "${q}"`);
        }
      } catch { /* skip malformed JSON */ }
      await sleep(200);
    }

    // PASS 2 — community subs we trust to surface relevant content even
    // when posts don't mention brand terms verbatim. Same throttling.
    // Capped to 4 subs to stay under Reddit's rate envelope.
    const filterKw = Array.from(new Set([...brandKw, ...themes.map(t => t.toLowerCase())]));
    for (const sub of this.subs.slice(0, 4)) {
      const url = `${baseUrl}/r/${encodeURIComponent(sub)}/hot.json?limit=15&raw_json=1`;
      const res = await fetchWithTimeout(url);
      if (!res || !res.ok) { await sleep(200); continue; }
      try {
        const json = await res.json() as { data?: { children?: RedditPost[] } };
        for (const c of json.data?.children ?? []) {
          const d = c.data;
          const blob = (d.title + ' ' + (d.selftext ?? '')).toLowerCase();
          const matched = filterKw.length === 0 || filterKw.some(k => blob.includes(k));
          if (!matched) continue;
          this.appendSignal(c, since, competitorSet, signals, seen, `r/${d.subreddit}`);
        }
      } catch { /* per-sub failures don't kill the poll */ }
      await sleep(200);
    }

    return { ok: true, source: 'reddit', mode: 'live', signals, fetchedAt: new Date() };
  }

  private appendSignal(
    c: RedditPost,
    since: number,
    competitorSet: Set<string>,
    out: RawSignal[],
    seen: Set<string>,
    lineage: string,
  ) {
    const d = c.data;
    if (d.over_18) return;
    if (seen.has(d.id)) return;
    const createdMs = d.created_utc * 1000;
    if (createdMs < since) return;
    seen.add(d.id);

    const blob = (d.title + ' ' + (d.selftext ?? '')).toLowerCase();
    const ageHours = Math.max(1, (Date.now() - createdMs) / 3_600_000);
    const velocity = d.ups / ageHours;
    const competitorClaimants = [...competitorSet].filter(c => blob.includes(c));

    out.push({
      source: 'reddit',
      title: d.title,
      summary: truncate(d.selftext || `${d.subreddit_name_prefixed} · ${d.ups} upvotes · ${d.num_comments} comments`, 220),
      text: d.selftext,
      hashtags: [`#${d.subreddit}`],
      lineage: `Reddit · ${lineage} · ${d.subreddit_name_prefixed} · ${d.ups} upvotes / ${d.num_comments} comments in ${ageHours.toFixed(1)}h.`,
      firstSeenAt: new Date(createdMs),
      velocity,
      // Reddit does NOT expose impressions/views via the public JSON API.
      // The previous code synthesized `ups*30 + comments*10` — pure
      // fabrication, violating CLAUDE.md hard rule 1. Emit 0; UI renders '—'.
      reach: 0,
      sentiment: d.upvote_ratio ? (d.upvote_ratio - 0.5) * 2 : 0,
      competitorClaimants,
      formatFatigue: 0.1,
      url: `https://www.reddit.com${d.permalink}`,
      externalId: `reddit:${d.id}`,
    });
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
