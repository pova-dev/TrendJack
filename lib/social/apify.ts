// Apify client for competitor Instagram / Facebook.
//
// Mechanics are identical for every actor: POST an input JSON to
// run-sync-get-dataset-items, get an array of result objects back. Only two
// things vary per actor — the INPUT shape and the OUTPUT field names — and
// both are isolated below so a different actor is a mapper edit, not a
// pipeline rewrite.
//
// Actor ids are credentials, not constants, so they can be changed from
// Settings without a deploy. The configured set:
//   APIFY_ACTOR_INSTAGRAM_PROFILE  apify/instagram-profile-scraper
//                                  by handle → followers + up to 12 recent posts
//   APIFY_ACTOR_INSTAGRAM_POST     patient_discovery/instagram-reel-analytics-by-url
//                                  by post URL → deep engagement metrics
//   APIFY_ACTOR_FACEBOOK_POST      clappi/facebook-posts-reels-scraper
//                                  by post URL → likes / views / comment count
//   APIFY_ACTOR_YOUTUBE_VIDEO      beyondops/youtube-metadata-scraper-pro-v2
//                                  by video URL → views / likes / comment count
//
// Gaps in this set, handled elsewhere or still open:
//   - NONE of them returns comment TEXT, only counts. YouTube comment text is
//     free via the Data API v3; Instagram and Facebook comment text needs a
//     dedicated comments actor that is not configured yet.
//   - Facebook page FOLLOWER counts have no source here: the Facebook actor is
//     addressed by post URL, not by page.
//   - YouTube subscriber counts likewise — but the free Data API v3 provides
//     them, along with everything the YouTube actor returns.
//
// Cost note: this is billed per RESULT. The poller must never ask an actor
// for more than it needs — one profile per account on the fast lane, and
// comments strictly on demand.

import type {
  CommentSnapshot, PostSnapshot, ProfileResult, ProfileSnapshot,
  SocialProvider, SocialProviderContext,
} from './types';
import { SocialProviderError } from './types';

const APIFY_BASE = 'https://api.apify.com/v2';

/** Wall-clock ceiling for an actor run. Same reasoning as the AI provider
 *  timeout: a scrape that never returns must not pin a poller slot forever. */
const DEFAULT_RUN_TIMEOUT_MS = 120_000;

function runTimeoutMs(): number {
  const raw = Number(process.env.TJ_APIFY_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RUN_TIMEOUT_MS;
}

/**
 * Run an actor and return its dataset items.
 *
 * `run-sync-get-dataset-items` runs the actor and streams the results back in
 * one request — no run-id polling loop. Apify caps synchronous runs at 300s;
 * our own timeout is tighter so a slow actor surfaces as a normal error.
 */
export async function runActor<T = unknown>(
  actorId: string,
  input: unknown,
  token: string,
  opts: { maxItems?: number } = {},
): Promise<T[]> {
  if (!token) throw new SocialProviderError('APIFY_TOKEN is not set', 'apify');
  if (!actorId) throw new SocialProviderError('No Apify actor configured for this platform', 'apify');

  // Actor ids are written 'user/name' but must be 'user~name' in the path.
  const slug = actorId.replace('/', '~');
  const url = new URL(`${APIFY_BASE}/acts/${slug}/run-sync-get-dataset-items`);
  url.searchParams.set('token', token);
  if (opts.maxItems) url.searchParams.set('maxItems', String(opts.maxItems));

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(runTimeoutMs()),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch (e) {
    const err = e as Error;
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new SocialProviderError(
        `Apify actor "${actorId}" did not finish within ${runTimeoutMs() / 1000}s`,
        'apify', true,
      );
    }
    throw new SocialProviderError(`Could not reach Apify: ${err.message}`, 'apify', true);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new SocialProviderError(apifyErrorMessage(res.status, actorId, body), 'apify', res.status >= 500 || res.status === 429);
  }

  const json = await res.json().catch(() => null);
  if (!Array.isArray(json)) {
    throw new SocialProviderError(`Apify actor "${actorId}" returned no result array`, 'apify');
  }
  return json as T[];
}

/** Map an Apify HTTP failure to something an operator can act on. */
function apifyErrorMessage(status: number, actorId: string, body: string): string {
  const detail = body.slice(0, 200);
  switch (status) {
    case 401:
    case 403:
      return 'Apify rejected the token. Check APIFY_TOKEN in Settings → Connectors.';
    case 404:
      return `Apify actor "${actorId}" not found. Check the actor id.`;
    case 402:
      return 'Apify account is out of credit. Top up to resume competitor polling.';
    case 429:
      return 'Apify is rate-limiting this account. Polling will retry next tick.';
    default:
      return `Apify returned HTTP ${status}${detail ? `: ${detail}` : ''}`;
  }
}

// ---------------------------------------------------------------------------
// Field mapping.
//
// Actors disagree about field names for the same concept — followersCount vs
// followers vs subscriberCount. These readers accept the common spellings so
// a swapped actor usually needs no change at all; when it does, this is the
// only place to edit.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/** Resolve a possibly-dotted path: 'metrics.like_count' as readily as 'likes'.
 *  The reel-analytics actor nests almost everything (metrics.*, user.*,
 *  caption.*), so flat-key lookup alone would silently read every number as 0
 *  — which is exactly the kind of quiet wrong answer that looks like data. */
function at(row: Row, path: string): unknown {
  if (!path.includes('.')) return row[path];
  let cur: unknown = row;
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Row)[seg];
  }
  return cur;
}

function num(row: Row, ...keys: string[]): number {
  for (const k of keys) {
    const v = at(row, k);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return 0;
}

function str(row: Row, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = at(row, k);
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return undefined;
}

function date(row: Row, ...keys: string[]): Date | undefined {
  for (const k of keys) {
    const v = at(row, k);
    if (typeof v === 'string' || typeof v === 'number') {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return undefined;
}

export function mapProfile(row: Row, fallbackHandle: string): ProfileSnapshot {
  return {
    handle: str(row, 'username', 'handle', 'pageName', 'userName') ?? fallbackHandle,
    displayName: str(row, 'fullName', 'name', 'title', 'displayName'),
    profileUrl: str(row, 'url', 'profileUrl', 'pageUrl', 'inputUrl'),
    avatarUrl: str(row, 'profilePicUrl', 'profilePicture', 'avatar', 'profilePicUrlHD'),
    followers: num(row, 'followersCount', 'followers', 'likes', 'fanCount', 'followerCount'),
    postCount: num(row, 'postsCount', 'posts', 'mediaCount') || undefined,
  };
}

// Field spellings observed across the configured actors:
//   apify/instagram-profile-scraper      likesCount, commentsCount, shortCode
//   patient_discovery/instagram-reel-*   metrics.like_count, metrics.play_count,
//                                        metrics.comment_count, caption.text, user.username
//   clappi/facebook-posts-reels-scraper  likes, views, comments, caption, datePosted
//   beyondops/youtube-metadata-*         views, likes, comment_count, upload_date, title
export function mapPost(row: Row): PostSnapshot {
  return {
    externalId: str(row, 'id', 'postId', 'shortCode', 'shortcode', 'code', 'url', 'postUrl') ?? '',
    postedAt: date(row, 'timestamp', 'takenAt', 'taken_at', 'time', 'publishedAt', 'date', 'datePosted', 'upload_date'),
    caption: str(row, 'caption.text', 'caption', 'text', 'message', 'title', 'description'),
    mediaUrl: str(row, 'displayUrl', 'imageUrl', 'thumbnailUrl', 'thumbnail_url', 'mediaUrl', 'video_url'),
    permalink: str(row, 'url', 'postUrl', 'permalink', 'link', 'channel_url'),
    likes: num(row, 'likesCount', 'metrics.like_count', 'likes', 'likeCount', 'like_count', 'reactionsCount'),
    // Instagram exposes no view count on static images, and clappi reports 0
    // for non-reel Facebook posts. 0 → '—', never guessed.
    views: num(row, 'videoViewCount', 'metrics.play_count', 'metrics.ig_play_count',
                    'viewsCount', 'views', 'videoPlayCount', 'playCount', 'view_count'),
    commentCount: num(row, 'commentsCount', 'metrics.comment_count', 'comment_count', 'comments', 'commentCount'),
  };
}

export function mapComment(row: Row): CommentSnapshot {
  return {
    externalId: str(row, 'id', 'commentId') ?? '',
    author: str(row, 'ownerUsername', 'author', 'username', 'name', 'profileName'),
    text: str(row, 'text', 'comment', 'message', 'body') ?? '',
    likes: num(row, 'likesCount', 'likes', 'likeCount'),
    postedAt: date(row, 'timestamp', 'createdAt', 'date', 'time'),
  };
}

/** Actor rows sometimes carry an `error` field instead of data (private or
 *  deleted account). Treat that as a real failure rather than silently
 *  writing a zeroed sample, which would look like "this brand lost all its
 *  followers" on the chart. */
function assertNotErrorRow(row: Row, handle: string): void {
  const err = str(row, 'error', 'errorDescription');
  if (err) throw new SocialProviderError(`Apify could not read "${handle}": ${err}`, 'apify');
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/**
 * Instagram profile + latest post — `apify/instagram-profile-scraper`.
 *
 * The only configured actor that can be addressed by HANDLE, and therefore
 * the only one that can report a follower count. It embeds up to 12 recent
 * posts under `latestPosts`, so one billed run per account per tick covers
 * both the counters and the headline post — no second call needed.
 *
 * No fetchComments: this actor returns comment COUNTS only.
 */
export const apifyInstagramProfile: SocialProvider = {
  id: 'apify:instagram-profile',
  platform: 'instagram',
  supportsOwn: true,        // works, though the Graph API is free and exact
  supportsCompetitor: true, // the reason this provider exists
  requires: ['APIFY_TOKEN', 'APIFY_ACTOR_INSTAGRAM_PROFILE'],

  async fetchProfile(handle: string, ctx: SocialProviderContext): Promise<ProfileResult> {
    const rows = await runActor<Row>(
      ctx.credentials.APIFY_ACTOR_INSTAGRAM_PROFILE,
      { usernames: [handle.replace(/^@/, '')] },
      ctx.credentials.APIFY_TOKEN,
      { maxItems: 1 },
    );
    const row = rows[0];
    if (!row) throw new SocialProviderError(`Apify returned no data for "${handle}"`, 'apify', true);
    assertNotErrorRow(row, handle);

    const embedded = (row.latestPosts ?? row.posts ?? row.topPosts) as Row[] | undefined;
    const latestPost = Array.isArray(embedded) && embedded.length ? mapPost(embedded[0]) : undefined;

    return {
      profile: mapProfile(row, handle),
      latestPost: latestPost?.externalId ? latestPost : undefined,
    };
  },
};

/**
 * Deep per-post metrics, addressed by POST URL.
 *
 * These three actors enrich a post we already know about — they cannot
 * discover posts, and none reports a follower count. `fetchProfile` therefore
 * refuses rather than returning a zeroed profile, which would render as a
 * catastrophic follower collapse on the chart.
 */
function makePostMetricsProvider(
  platform: 'instagram' | 'facebook' | 'youtube',
  cfg: { id: string; actorKey: string; input: (url: string) => unknown },
): SocialProvider {
  return {
    id: cfg.id,
    platform,
    supportsOwn: true,
    supportsCompetitor: true,
    requires: ['APIFY_TOKEN', cfg.actorKey],

    async fetchProfile(handle: string): Promise<ProfileResult> {
      throw new SocialProviderError(
        `${cfg.id} is addressed by post URL and cannot look up "${handle}" or any follower count`,
        'apify',
      );
    },

    async fetchPostMetrics(url: string, ctx: SocialProviderContext): Promise<PostSnapshot> {
      const rows = await runActor<Row>(
        ctx.credentials[cfg.actorKey], cfg.input(url), ctx.credentials.APIFY_TOKEN, { maxItems: 1 },
      );
      const row = rows[0];
      if (!row) throw new SocialProviderError(`Apify returned no metrics for ${url}`, 'apify', true);
      assertNotErrorRow(row, url);
      const post = mapPost(row);
      // Actors keyed by URL sometimes omit an id; the URL is a stable key.
      return { ...post, externalId: post.externalId || url, permalink: post.permalink ?? url };
    },
  };
}

export const apifyInstagramPost = makePostMetricsProvider('instagram', {
  id: 'apify:instagram-post',
  actorKey: 'APIFY_ACTOR_INSTAGRAM_POST',
  input: url => ({ postUrls: [url] }),
});

export const apifyFacebookPost = makePostMetricsProvider('facebook', {
  id: 'apify:facebook-post',
  actorKey: 'APIFY_ACTOR_FACEBOOK_POST',
  input: url => ({ postUrls: [url] }),
});

export const apifyYoutubeVideo = makePostMetricsProvider('youtube', {
  id: 'apify:youtube-video',
  actorKey: 'APIFY_ACTOR_YOUTUBE_VIDEO',
  input: url => ({ videoUrls: [url] }),
});

/** Accept either a bare page slug or a full URL. */
export function handleToFacebookUrl(handle: string): string {
  if (/^https?:\/\//i.test(handle)) return handle;
  return `https://www.facebook.com/${handle.replace(/^@/, '')}`;
}
