// Reddit live connector — uses the public JSON endpoints. No auth required
// for public listing, but Reddit blocks default Node fetch UAs, so we set
// a polite custom UA. To pass tighter rate limits, set REDDIT_USER_AGENT
// (e.g. "trendjack/1.0 by u/yourname").

import type { Connector, ConnectorPollOpts, ConnectorResult } from './types';
import type { RawSignal } from '@/lib/scoring/engine';

const DEFAULT_UA = 'trendjack/1.0 (https://trendjack.local; +operator)';

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
    const since = opts.since?.getTime() ?? Date.now() - 24 * 60 * 60 * 1000;
    const competitorSet = new Set((opts.competitors ?? []).map(c => c.toLowerCase()));
    const brandKw = (opts.brandKeywords ?? []).map(k => k.toLowerCase()).filter(Boolean);
    const competitors = (opts.competitors ?? []).filter(Boolean);
    const themes = (opts.themes ?? []).filter(Boolean);

    const signals: RawSignal[] = [];
    const seen = new Set<string>(); // dedupe by post id across both passes
    const headers = { 'user-agent': ua, accept: 'application/json' };

    // PASS 1 — reddit-wide /search.json fan-out by brand keywords +
    // competitors + a couple themes. This is the primary signal: search
    // catches any post mentioning these terms regardless of sub.
    const searchTerms = Array.from(new Set([
      ...brandKw.slice(0, 5),
      ...competitors.slice(0, 4),
      ...themes.slice(0, 3),
    ]));
    for (const q of searchTerms) {
      try {
        const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=new&t=day&limit=15&raw_json=1`;
        const res = await fetch(url, { headers });
        if (!res.ok) continue;
        const json = await res.json() as { data?: { children?: RedditPost[] } };
        for (const c of json.data?.children ?? []) {
          this.appendSignal(c, since, competitorSet, signals, seen, `search "${q}"`);
        }
      } catch { /* skip failed query */ }
    }

    // PASS 2 — community subs we trust to surface relevant content even
    // when posts don't mention brand terms verbatim (e.g. r/IndianGaming
    // talking about a "new gaming phone" generally). We still keyword-
    // filter the bodies so off-topic posts (sports, politics) don't slip
    // through, but we widen the filter to include themes.
    const filterKw = Array.from(new Set([...brandKw, ...themes.map(t => t.toLowerCase())]));
    for (const sub of this.subs) {
      try {
        const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/hot.json?limit=15&raw_json=1`;
        const res = await fetch(url, { headers });
        if (!res.ok) continue;
        const json = await res.json() as { data?: { children?: RedditPost[] } };
        for (const c of json.data?.children ?? []) {
          const d = c.data;
          const blob = (d.title + ' ' + (d.selftext ?? '')).toLowerCase();
          const matched = filterKw.length === 0 || filterKw.some(k => blob.includes(k));
          if (!matched) continue;
          this.appendSignal(c, since, competitorSet, signals, seen, `r/${d.subreddit}`);
        }
      } catch { /* per-sub failures don't kill the poll */ }
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
      reach: d.ups * 30 + d.num_comments * 10,
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
