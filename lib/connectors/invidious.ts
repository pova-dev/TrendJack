// Invidious connector — open-source YouTube frontend with a JSON API.
// Lets us pull trending videos and per-keyword search without a Google
// API key. Same instance-rotation pattern as Nitter for resilience.
//
// Env: INVIDIOUS_INSTANCES="https://yewtu.be,https://invidious.fdn.fr"

import type { Connector, ConnectorPollOpts, ConnectorResult } from './types';
import type { RawSignal } from '@/lib/scoring/engine';

// Public Invidious has been collapsing since YouTube's mid-2024 anti-bot
// rollout — most instances either rate-limit hard, require auth, or 403.
// We keep a long list of known-to-have-worked instances and try each in
// turn, but the realistic path to reliable YouTube data is to set
// YOUTUBE_API_KEY (the official connector takes priority when present).
const DEFAULT_INSTANCES = [
  'https://yewtu.be',
  'https://invidious.nerdvpn.de',
  'https://invidious.private.coffee',
  'https://invidious.perennialte.ch',
  'https://invidious.incogniweb.net',
  'https://invidious.lunar.icu',
  'https://inv.nadeko.net',
  'https://invidious.protokolla.fi',
];

interface IvVideo {
  videoId: string;
  title: string;
  author: string;
  authorId: string;
  description?: string;
  published: number;            // unix seconds
  viewCount?: number;
  lengthSeconds?: number;
}

function getInstances(creds?: Record<string, string>): string[] {
  const env = creds?.INVIDIOUS_INSTANCES || process.env.INVIDIOUS_INSTANCES;
  if (env) return env.split(',').map(s => s.trim()).filter(Boolean);
  return DEFAULT_INSTANCES;
}

async function tryFetch(path: string, creds?: Record<string, string>): Promise<{ data: unknown[] | null; lastStatus: string }> {
  let lastStatus = 'no_instances_configured';
  // Cap to first 4 instances per call so a wave of dead hosts can't blow
  // past the 8-second per-tick budget. Most public instances either
  // respond fast or fail fast.
  const instances = getInstances(creds).slice(0, 4);
  for (const base of instances) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { accept: 'application/json', 'user-agent': 'trendjack/1.0' },
        signal: AbortSignal.timeout(3500),
      });
      if (!res.ok) {
        lastStatus = `${new URL(base).hostname}: HTTP ${res.status}`;
        continue;
      }
      const json = await res.json();
      return { data: json as unknown[], lastStatus: 'ok' };
    } catch (e) {
      lastStatus = `${new URL(base).hostname}: ${(e as Error).name === 'TimeoutError' ? 'timeout' : 'connect_error'}`;
    }
  }
  return { data: null, lastStatus };
}

export class InvidiousConnector implements Connector {
  id = 'invidious_live';
  source = 'youtube' as const;
  mode = 'live' as const;

  async poll(opts: ConnectorPollOpts): Promise<ConnectorResult> {
    const queries = (opts.brandKeywords ?? []).slice(0, 3).filter(Boolean);
    const competitorSet = new Set((opts.competitors ?? []).map(c => c.toLowerCase()));
    const signals: RawSignal[] = [];
    let anySuccess = false;
    let lastStatus = 'no_instances_tried';

    // Trending — global feed
    const trending = await tryFetch('/api/v1/trending?type=Default&region=IN', opts.credentials);
    lastStatus = trending.lastStatus;
    if (Array.isArray(trending.data)) {
      anySuccess = true;
      for (const raw of (trending.data as IvVideo[]).slice(0, 12)) {
        signals.push(toSignal(raw, competitorSet, 'trending'));
      }
    }

    // Per-query search, recent
    for (const q of queries) {
      const results = await tryFetch(`/api/v1/search?q=${encodeURIComponent(q)}&type=video&date=today&sort_by=upload_date`, opts.credentials);
      if (results.lastStatus !== 'ok') lastStatus = results.lastStatus;
      if (Array.isArray(results.data)) {
        anySuccess = true;
        for (const raw of (results.data as IvVideo[]).slice(0, 8)) {
          signals.push(toSignal(raw, competitorSet, q));
        }
      }
    }

    if (!anySuccess) {
      return {
        ok: false,
        source: 'youtube',
        mode: 'live',
        reason: `Public Invidious instances are unavailable (${lastStatus}). YouTube's anti-bot rollout has broken most public instances. To pull YouTube reliably, set YOUTUBE_API_KEY in connector credentials — the official YouTube Data API v3 connector will take over automatically.`,
      };
    }
    return { ok: true, source: 'youtube', mode: 'live', signals, fetchedAt: new Date() };
  }
}

function toSignal(v: IvVideo, competitorSet: Set<string>, lineage: string): RawSignal {
  const pub = new Date(v.published * 1000);
  const ageHours = Math.max(0.5, (Date.now() - pub.getTime()) / 3_600_000);
  const blob = (v.title + ' ' + (v.description ?? '') + ' ' + v.author).toLowerCase();
  const competitorClaimants = [...competitorSet].filter(c => blob.includes(c));
  return {
    source: 'youtube',
    title: v.title.slice(0, 200),
    summary: (v.description ?? '').slice(0, 220),
    hashtags: extractHashtags(blob),
    lineage: `Invidious (${lineage}) · ${v.author} · ${ageHours.toFixed(1)}h ago · ${v.viewCount ?? 0} views`,
    firstSeenAt: pub,
    velocity: (v.viewCount ?? 0) / Math.max(1, ageHours) / 100,
    reach: v.viewCount ?? 0,
    // Sentiment: YouTube doesn't expose sentiment via public APIs (and
    // Invidious mirrors don't either). Previous 0.1 constant was a
    // baseless prior; emit 0.
    sentiment: 0,
    competitorClaimants,
    formatFatigue: 0.1,
    url: `https://www.youtube.com/watch?v=${v.videoId}`,
    externalId: `yt:${v.videoId}`,
  };
}

function extractHashtags(blob: string): string[] {
  return Array.from(new Set((blob.match(/#\w{2,32}/g) ?? []).slice(0, 6)));
}
