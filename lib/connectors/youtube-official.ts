// YouTube Data API v3 official connector. Set YOUTUBE_API_KEY to enable.
// Uses search.list ordered by date for last-24h posts that match the
// brand's keywords + competitors. videos.list enriches with statistics.
//
// Free quota: 10,000 units/day; each search.list = 100 units, videos.list
// statistics = 1 unit per video. Practical: 50–100 polls/day.

import type { Connector, ConnectorPollOpts, ConnectorResult } from './types';
import type { RawSignal } from '@/lib/scoring/engine';

interface SearchItem {
  id: { videoId: string };
  snippet: {
    publishedAt: string;
    title: string;
    description: string;
    channelTitle: string;
  };
}

interface VideoItem {
  id: string;
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
}

export class YoutubeOfficialConnector implements Connector {
  id = 'youtube_official';
  source = 'youtube' as const;
  mode = 'live' as const;

  async poll(opts: ConnectorPollOpts): Promise<ConnectorResult> {
    const key = opts.credentials?.YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY;
    if (!key) return { ok: false, source: 'youtube', mode: 'live', reason: 'YOUTUBE_API_KEY not set' };

    const queries = (opts.brandKeywords ?? []).slice(0, 3);
    if (queries.length === 0) return { ok: true, source: 'youtube', mode: 'live', signals: [], fetchedAt: new Date() };
    const competitorSet = new Set((opts.competitors ?? []).map(c => c.toLowerCase()));
    const signals: RawSignal[] = [];

    for (const q of queries) {
      try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const sUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&order=date&publishedAfter=${encodeURIComponent(since)}&maxResults=12&regionCode=IN&key=${key}`;
        const sRes = await fetch(sUrl);
        if (!sRes.ok) continue;
        const sJson = await sRes.json() as { items: SearchItem[] };
        const ids = sJson.items.map(i => i.id.videoId).filter(Boolean);
        if (!ids.length) continue;

        const vRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.join(',')}&key=${key}`);
        const vJson = vRes.ok ? await vRes.json() as { items: VideoItem[] } : { items: [] };
        const stats = new Map(vJson.items.map(v => [v.id, v.statistics]));

        for (const item of sJson.items) {
          const id = item.id.videoId;
          const pub = new Date(item.snippet.publishedAt);
          const ageHours = Math.max(0.5, (Date.now() - pub.getTime()) / 3_600_000);
          const s = stats.get(id) ?? {};
          const views = Number(s.viewCount ?? 0);
          const likes = Number(s.likeCount ?? 0);
          const blob = (item.snippet.title + ' ' + item.snippet.description + ' ' + item.snippet.channelTitle).toLowerCase();
          const competitorClaimants = [...competitorSet].filter(c => blob.includes(c));

          signals.push({
            source: 'youtube',
            title: item.snippet.title.slice(0, 200),
            summary: item.snippet.description.slice(0, 240),
            hashtags: extractHashtags(blob),
            lineage: `${item.snippet.channelTitle} · ${views} views · ${likes} likes in ${ageHours.toFixed(1)}h.`,
            firstSeenAt: pub,
            velocity: views / Math.max(1, ageHours) / 100,
            reach: views,
            sentiment: 0,
            competitorClaimants,
            formatFatigue: 0.1,
            url: `https://www.youtube.com/watch?v=${id}`,
            externalId: `yt:${id}`,
          });
        }
      } catch { /* skip failed query */ }
    }

    return { ok: true, source: 'youtube', mode: 'live', signals, fetchedAt: new Date() };
  }
}

function extractHashtags(blob: string): string[] {
  return Array.from(new Set((blob.match(/#\w{2,32}/g) ?? []).slice(0, 6)));
}
