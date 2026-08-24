// YouTube provider, built on the official Data API v3.
//
// Deliberately NOT Apify. The official API is free within a 10,000 unit/day
// quota, works for ANY channel rather than only ones you own, and returns
// three things no configured Apify actor does: subscriber counts, a way to
// enumerate a channel's uploads, and actual comment text. Paying to scrape
// YouTube would buy strictly less data.
//
// Quota accounting, because staying inside the free tier is the whole point:
//   channels.list        1 unit   handle -> channelId + subscribers + uploads playlist
//   playlistItems.list   1 unit   uploads playlist -> newest video id
//   videos.list          1 unit   video id -> views / likes / comment count
//   commentThreads.list  1 unit   video id -> comment text (on demand only)
// So a counter poll costs 3 units. Eight channels every 15 minutes is
// 8 x 96 x 3 = 2,304 units/day, comfortably inside the free quota.
//
// search.list is avoided on purpose: it costs 100 units, which would blow the
// daily quota at this cadence. The uploads playlist gives the same answer for
// 1 unit.

import type {
  CommentSnapshot, PostSnapshot, ProfileResult,
  SocialProvider, SocialProviderContext,
} from './types';
import { SocialProviderError } from './types';

const API = 'https://www.googleapis.com/youtube/v3';
const DEFAULT_TIMEOUT_MS = 30_000;

function timeoutMs(): number {
  const raw = Number(process.env.TJ_YOUTUBE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

function apiKey(ctx: SocialProviderContext): string {
  const k = ctx.credentials.YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY || '';
  if (!k) throw new SocialProviderError('YOUTUBE_API_KEY is not set', 'youtube');
  return k;
}

async function call<T>(path: string, params: Record<string, string>, key: string): Promise<T> {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', key);

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs()) });
  } catch (e) {
    const err = e as Error;
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new SocialProviderError('YouTube did not respond in time', 'youtube', true);
    }
    throw new SocialProviderError(`Could not reach YouTube: ${err.message}`, 'youtube', true);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new SocialProviderError(youtubeError(res.status, body), 'youtube', res.status >= 500);
  }
  return res.json() as Promise<T>;
}

/** Quota exhaustion and a bad key both return 403, and they need completely
 *  different responses from the operator, so tell them apart. */
function youtubeError(status: number, body: string): string {
  const quota = /quotaExceeded|dailyLimitExceeded/i.test(body);
  switch (status) {
    case 400: return 'YouTube rejected the request. Check the channel handle.';
    case 403:
      return quota
        ? 'YouTube daily quota exhausted. Counters resume after the quota resets at midnight Pacific.'
        : 'YouTube rejected the API key. Check YOUTUBE_API_KEY, and that Data API v3 is enabled for the project.';
    case 404: return 'YouTube channel not found.';
    default: return `YouTube returned HTTP ${status}`;
  }
}

interface ChannelResp {
  items?: Array<{
    id: string;
    snippet?: { title?: string; customUrl?: string; thumbnails?: { high?: { url?: string }; default?: { url?: string } } };
    statistics?: { subscriberCount?: string; videoCount?: string; hiddenSubscriberCount?: boolean };
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }>;
}

/** Resolve a channel by @handle, bare name, or raw channel id (UC...). */
async function resolveChannel(handle: string, key: string): Promise<NonNullable<ChannelResp['items']>[number]> {
  const clean = handle.replace(/^@/, '').trim();
  const part = 'snippet,statistics,contentDetails';

  // A raw channel id is unambiguous, so try it first and skip a lookup.
  const attempts: Record<string, string>[] = /^UC[\w-]{20,}$/.test(clean)
    ? [{ part, id: clean }]
    : [{ part, forHandle: `@${clean}` }, { part, forUsername: clean }];

  for (const params of attempts) {
    const data = await call<ChannelResp>('channels', params, key);
    const item = data.items?.[0];
    if (item) return item;
  }
  throw new SocialProviderError(
    `No YouTube channel matches "${handle}". Use the @handle or the UC... channel id.`,
    'youtube',
  );
}

interface PlaylistResp { items?: Array<{ snippet?: { resourceId?: { videoId?: string } } }> }
interface VideoResp {
  items?: Array<{
    id: string;
    snippet?: { title?: string; publishedAt?: string; thumbnails?: { high?: { url?: string } } };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  }>;
}
interface CommentResp {
  items?: Array<{
    snippet?: {
      topLevelComment?: {
        id?: string;
        snippet?: { authorDisplayName?: string; textOriginal?: string; textDisplay?: string; likeCount?: number; publishedAt?: string };
      };
    };
  }>;
}

const n = (s: string | undefined) => {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
};

export const youtubeApi: SocialProvider = {
  id: 'youtube-api',
  platform: 'youtube',
  supportsOwn: true,
  supportsCompetitor: true,   // unlike Meta, YouTube publishes this for everyone
  requires: ['YOUTUBE_API_KEY'],

  async fetchProfile(handle: string, ctx: SocialProviderContext): Promise<ProfileResult> {
    const key = apiKey(ctx);
    const ch = await resolveChannel(handle, key);

    // A channel can hide its subscriber count. That is a real absence, not a
    // zero, so it must not be written as one: reporting 0 subscribers would
    // read as a catastrophic collapse on the chart.
    if (ch.statistics?.hiddenSubscriberCount) {
      throw new SocialProviderError(
        `"${handle}" hides its subscriber count, so it cannot be tracked`,
        'youtube',
      );
    }

    const profile = {
      handle: ch.snippet?.customUrl?.replace(/^@/, '') || handle.replace(/^@/, ''),
      displayName: ch.snippet?.title,
      profileUrl: `https://www.youtube.com/channel/${ch.id}`,
      avatarUrl: ch.snippet?.thumbnails?.high?.url ?? ch.snippet?.thumbnails?.default?.url,
      followers: n(ch.statistics?.subscriberCount),
      postCount: n(ch.statistics?.videoCount) || undefined,
    };

    const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) return { profile };

    // 1 unit, versus 100 for search.list.
    const pl = await call<PlaylistResp>('playlistItems', {
      part: 'snippet', playlistId: uploads, maxResults: '1',
    }, key);
    const videoId = pl.items?.[0]?.snippet?.resourceId?.videoId;
    if (!videoId) return { profile };

    const vid = await call<VideoResp>('videos', { part: 'snippet,statistics', id: videoId }, key);
    const v = vid.items?.[0];
    if (!v) return { profile };

    const latestPost: PostSnapshot = {
      externalId: v.id,
      postedAt: v.snippet?.publishedAt ? new Date(v.snippet.publishedAt) : undefined,
      caption: v.snippet?.title,
      mediaUrl: v.snippet?.thumbnails?.high?.url,
      permalink: `https://www.youtube.com/watch?v=${v.id}`,
      likes: n(v.statistics?.likeCount),
      views: n(v.statistics?.viewCount),
      // Absent when the uploader disabled comments. 0 renders as a dash.
      commentCount: n(v.statistics?.commentCount),
    };
    return { profile, latestPost };
  },

  async fetchComments(post, ctx, limit): Promise<CommentSnapshot[]> {
    const key = apiKey(ctx);
    const out: CommentSnapshot[] = [];
    let pageToken: string | undefined;

    while (out.length < limit) {
      const params: Record<string, string> = {
        part: 'snippet',
        videoId: post.externalId,
        maxResults: String(Math.min(100, limit - out.length)),
        order: 'relevance',
        textFormat: 'plainText',
      };
      if (pageToken) params.pageToken = pageToken;

      const data = await call<CommentResp & { nextPageToken?: string }>('commentThreads', params, key);
      for (const item of data.items ?? []) {
        const c = item.snippet?.topLevelComment;
        const s = c?.snippet;
        const text = (s?.textOriginal ?? s?.textDisplay ?? '').trim();
        if (!text || !c?.id) continue;
        out.push({
          externalId: c.id,
          author: s?.authorDisplayName,
          text,
          likes: typeof s?.likeCount === 'number' ? s.likeCount : 0,
          postedAt: s?.publishedAt ? new Date(s.publishedAt) : undefined,
        });
      }
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    return out.slice(0, limit);
  },
};
