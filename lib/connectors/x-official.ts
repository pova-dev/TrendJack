// X / Twitter official API v2 connector.
// Set X_BEARER_TOKEN to enable. Uses /2/tweets/search/recent with up to 100
// results per page (Basic tier $200/mo) or /2/tweets/counts/recent for
// volumetric trend tracking. We default to recent search keyed off the
// brand's competitors and safe-themes.
//
// If you prefer free / no-auth, use NitterConnector instead. The two are
// drop-in interchangeable; pick from /connectors page in the UI.

import type { Connector, ConnectorPollOpts, ConnectorResult } from './types';
import type { RawSignal } from '@/lib/scoring/engine';

interface XTweet {
  id: string;
  text: string;
  created_at: string;
  author_id?: string;
  public_metrics?: {
    retweet_count?: number; reply_count?: number; like_count?: number; quote_count?: number;
    impression_count?: number;
  };
  entities?: { hashtags?: Array<{ tag: string }>; mentions?: Array<{ username: string }> };
}

interface XSearchResp {
  data?: XTweet[];
  includes?: { users?: Array<{ id: string; username: string; name: string }> };
  meta?: { result_count?: number };
}

export class XOfficialConnector implements Connector {
  id = 'x_official';
  source = 'x' as const;
  mode = 'live' as const;

  async poll(opts: ConnectorPollOpts): Promise<ConnectorResult> {
    const token = opts.credentials?.X_BEARER_TOKEN || process.env.X_BEARER_TOKEN;
    if (!token) return { ok: false, source: 'x', mode: 'live', reason: 'X_BEARER_TOKEN not set' };

    const queries = (opts.brandKeywords ?? []).slice(0, 3);
    if (queries.length === 0) return { ok: true, source: 'x', mode: 'live', signals: [], fetchedAt: new Date() };
    const competitorSet = new Set((opts.competitors ?? []).map(c => c.toLowerCase()));
    const signals: RawSignal[] = [];

    for (const q of queries) {
      try {
        const params = new URLSearchParams({
          query: `(${q}) -is:retweet lang:en`,
          max_results: '50',
          'tweet.fields': 'created_at,public_metrics,entities,author_id',
          expansions: 'author_id',
          'user.fields': 'username,name',
        });
        const res = await fetch(`https://api.twitter.com/2/tweets/search/recent?${params}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!res.ok) continue;
        const json = await res.json() as XSearchResp;
        const userMap = new Map((json.includes?.users ?? []).map(u => [u.id, u]));
        for (const t of json.data ?? []) {
          const pub = new Date(t.created_at);
          const ageHours = Math.max(0.5, (Date.now() - pub.getTime()) / 3_600_000);
          const m = t.public_metrics ?? {};
          const engagement = (m.like_count ?? 0) + 2 * (m.retweet_count ?? 0) + (m.reply_count ?? 0);
          const blob = t.text.toLowerCase();
          const competitorClaimants = [...competitorSet].filter(c => blob.includes(c));
          const author = userMap.get(t.author_id ?? '');
          // Reach: use real impression_count when X returns it (Basic+ tier
          // only, and only for the requesting user's own tweets — usually
          // undefined for searched tweets). The previous fallback
          // `engagement * 10` was pure fabrication of a 10x multiplier and
          // violated CLAUDE.md hard rule 1; emit 0 instead so the UI
          // renders '—' for tweets without true impression data.
          signals.push({
            source: 'x',
            title: t.text.split('\n')[0].slice(0, 200),
            summary: t.text.slice(0, 240),
            text: t.text,
            hashtags: (t.entities?.hashtags ?? []).map(h => `#${h.tag}`).slice(0, 6),
            lineage: `${author?.username ? '@' + author.username : 'X user'} · ${engagement} interactions in ${ageHours.toFixed(1)}h.`,
            firstSeenAt: pub,
            velocity: engagement / ageHours,
            reach: m.impression_count ?? 0,
            sentiment: 0,
            competitorClaimants,
            formatFatigue: 0.05,
            url: author ? `https://x.com/${author.username}/status/${t.id}` : `https://x.com/i/web/status/${t.id}`,
            externalId: `x:${t.id}`,
          });
        }
      } catch { /* skip failed query */ }
    }

    return { ok: true, source: 'x', mode: 'live', signals, fetchedAt: new Date() };
  }
}
