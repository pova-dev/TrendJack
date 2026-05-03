// HackerNews live connector via Algolia search API. No auth, generous
// rate limits, lightning-fast. Searches stories created in the last 24h
// matching the brand's keywords + competitors.

import type { Connector, ConnectorPollOpts, ConnectorResult } from './types';
import type { RawSignal } from '@/lib/scoring/engine';

interface HnHit {
  objectID: string;
  title?: string;
  url?: string;
  story_text?: string;
  author?: string;
  points?: number;
  num_comments?: number;
  created_at_i: number;
}

export class HackerNewsConnector implements Connector {
  id = 'hn_live';
  source = 'news' as const;       // surfaced under News bucket in the UI
  mode = 'live' as const;

  async poll(opts: ConnectorPollOpts): Promise<ConnectorResult> {
    const since = Math.floor((opts.since?.getTime() ?? Date.now() - 86_400_000) / 1000);
    const queries = (opts.brandKeywords && opts.brandKeywords.length > 0)
      ? opts.brandKeywords.slice(0, 4)
      : ['smartphone', 'phone'];

    const competitorSet = new Set((opts.competitors ?? []).map(c => c.toLowerCase()));
    const signals: RawSignal[] = [];

    for (const q of queries) {
      try {
        const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&numericFilters=created_at_i>${since}&hitsPerPage=12`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const json = await res.json() as { hits: HnHit[] };
        for (const h of json.hits) {
          if (!h.title) continue;
          const createdMs = h.created_at_i * 1000;
          const ageHours = Math.max(1, (Date.now() - createdMs) / 3_600_000);
          const blob = (h.title + ' ' + (h.story_text ?? '')).toLowerCase();
          const competitorClaimants = [...competitorSet].filter(c => blob.includes(c));

          // Velocity: real points-per-hour rate. No fabricated multiplier.
          // (Previous code multiplied by 5 — that was hand-wavy and biased HN
          // up vs other sources. Removed per CLAUDE.md rule 1.)
          // Reach: HN does not expose impressions / views. Emit 0; UI renders '—'.
          // (Previous code synthesized `points*50 + comments*10`, which was
          // pure fabrication.)
          signals.push({
            source: 'news',
            title: h.title,
            summary: truncate((h.story_text ?? `HackerNews · ${h.points ?? 0} pts · ${h.num_comments ?? 0} comments`).replace(/<[^>]+>/g, ''), 220),
            hashtags: ['#HackerNews'],
            lineage: `Hit ${h.points ?? 0} pts on HN in ${ageHours.toFixed(1)}h. ${h.num_comments ?? 0} comments.`,
            firstSeenAt: new Date(createdMs),
            velocity: (h.points ?? 0) / ageHours,
            reach: 0,
            sentiment: 0.1,
            competitorClaimants,
            formatFatigue: 0.05,
            url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
            externalId: `hn:${h.objectID}`,
          });
        }
      } catch { /* skip failed query */ }
    }

    return { ok: true, source: 'news', mode: 'live', signals, fetchedAt: new Date() };
  }
}

function truncate(s: string, n: number): string {
  if (!s) return s;
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
