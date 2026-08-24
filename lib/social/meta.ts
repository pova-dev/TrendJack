// Meta Graph API provider, for Instagram and Facebook accounts you own.
//
// Free and exact, and it returns things no scraper can see. It is also the
// only lawful way to read your own private metrics. It cannot read a
// competitor: Graph only exposes accounts your token is authorised for, which
// is precisely why Apify exists in this codebase at all.
//
// Addressing: Graph is keyed by numeric ID, not by @handle. An Instagram
// Business account ID comes from the linked Page (Page > Instagram accounts),
// and a Page ID from the Page's About tab. Passing a handle produces a clear
// instruction rather than a confusing 400 from Meta.
//
// Token: META_ACCESS_TOKEN, a long-lived Page access token with
// pages_read_engagement, plus instagram_basic for the Instagram side.

import type {
  CommentSnapshot, PostSnapshot, ProfileResult,
  SocialProvider, SocialProviderContext,
} from './types';
import { SocialProviderError } from './types';

const GRAPH = 'https://graph.facebook.com/v21.0';
const DEFAULT_TIMEOUT_MS = 30_000;

function timeoutMs(): number {
  const raw = Number(process.env.TJ_META_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

function token(ctx: SocialProviderContext, platform: 'instagram' | 'facebook'): string {
  const t = ctx.credentials.META_ACCESS_TOKEN
    || (platform === 'instagram' ? ctx.credentials.INSTAGRAM_ACCESS_TOKEN : ctx.credentials.FACEBOOK_ACCESS_TOKEN)
    || '';
  if (!t) throw new SocialProviderError('META_ACCESS_TOKEN is not set', 'meta');
  return t;
}

/** Graph is addressed by numeric id. Reject anything else with instructions. */
function assertGraphId(handle: string, platform: 'instagram' | 'facebook'): string {
  const id = handle.replace(/^@/, '').trim();
  if (/^\d{5,}$/.test(id)) return id;
  throw new SocialProviderError(
    platform === 'instagram'
      ? `Instagram via Graph needs the numeric Business account ID, not "${handle}". Find it under your Facebook Page > Instagram accounts.`
      : `Facebook via Graph needs the numeric Page ID, not "${handle}". Find it in your Page's About tab.`,
    'meta',
  );
}

async function call<T>(path: string, params: Record<string, string>, tok: string): Promise<T> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('access_token', tok);

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs()) });
  } catch (e) {
    const err = e as Error;
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new SocialProviderError('Meta did not respond in time', 'meta', true);
    }
    throw new SocialProviderError(`Could not reach Meta: ${err.message}`, 'meta', true);
  }

  const body = await res.json().catch(() => null) as { error?: { message?: string; code?: number; type?: string } } | null;
  if (!res.ok || body?.error) {
    throw new SocialProviderError(metaError(res.status, body?.error), 'meta', res.status >= 500 || res.status === 429);
  }
  return body as T;
}

/** Meta returns 400 for most failures, so the code inside the body is what
 *  distinguishes an expired token from a missing permission. Those need
 *  completely different fixes, so they get different messages. */
function metaError(status: number, err?: { message?: string; code?: number }): string {
  const code = err?.code;
  if (code === 190) return 'Meta access token is invalid or expired. Generate a new long-lived Page token.';
  if (code === 200 || code === 10) return 'Meta token lacks permission. It needs pages_read_engagement, and instagram_basic for Instagram.';
  if (code === 4 || code === 17 || code === 32) return 'Meta API rate limit reached. Polling will retry on the next tick.';
  if (code === 100) return `Meta rejected the request: ${err?.message ?? 'check the account ID'}`;
  if (status === 404) return 'Meta account not found. Check the numeric ID.';
  return `Meta returned HTTP ${status}${err?.message ? `: ${err.message}` : ''}`;
}

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

interface IgProfile {
  id: string; username?: string; name?: string;
  followers_count?: number; media_count?: number; profile_picture_url?: string;
}
interface IgMedia {
  data?: Array<{
    id: string; caption?: string; like_count?: number; comments_count?: number;
    media_url?: string; thumbnail_url?: string; permalink?: string; timestamp?: string;
  }>;
}
interface IgComments {
  data?: Array<{ id: string; text?: string; username?: string; timestamp?: string; like_count?: number }>;
}

export const metaInstagram: SocialProvider = {
  id: 'meta-graph:instagram',
  platform: 'instagram',
  supportsOwn: true,
  // Graph only exposes accounts the token is authorised for. Claiming
  // competitor support would schedule polls that can only fail.
  supportsCompetitor: false,
  requires: ['META_ACCESS_TOKEN'],

  async fetchProfile(handle: string, ctx: SocialProviderContext): Promise<ProfileResult> {
    const tok = token(ctx, 'instagram');
    const id = assertGraphId(handle, 'instagram');

    const p = await call<IgProfile>(id, {
      fields: 'id,username,name,followers_count,media_count,profile_picture_url',
    }, tok);

    // followers_count absent means the token cannot see it, which is a
    // permission problem, not an account with zero followers.
    if (typeof p.followers_count !== 'number') {
      throw new SocialProviderError(
        'Meta did not return followers_count. The token likely lacks instagram_basic.',
        'meta',
      );
    }

    const profile = {
      handle: p.username ?? id,
      displayName: p.name ?? p.username,
      profileUrl: p.username ? `https://instagram.com/${p.username}` : undefined,
      avatarUrl: p.profile_picture_url,
      followers: p.followers_count,
      postCount: typeof p.media_count === 'number' ? p.media_count : undefined,
    };

    const media = await call<IgMedia>(`${id}/media`, {
      fields: 'id,caption,like_count,comments_count,media_url,thumbnail_url,permalink,timestamp',
      limit: '1',
    }, tok);

    const m = media.data?.[0];
    if (!m) return { profile };

    const latestPost: PostSnapshot = {
      externalId: m.id,
      postedAt: m.timestamp ? new Date(m.timestamp) : undefined,
      caption: m.caption,
      mediaUrl: m.thumbnail_url ?? m.media_url,
      permalink: m.permalink,
      likes: n(m.like_count),
      // Graph exposes no view count on this edge for image posts. 0 renders
      // as a dash rather than being invented.
      views: 0,
      commentCount: n(m.comments_count),
    };
    return { profile, latestPost };
  },

  async fetchComments(post, ctx, limit): Promise<CommentSnapshot[]> {
    const tok = token(ctx, 'instagram');
    const res = await call<IgComments>(`${post.externalId}/comments`, {
      fields: 'id,text,username,timestamp,like_count',
      limit: String(Math.min(100, limit)),
    }, tok);

    return (res.data ?? [])
      .map(c => ({
        externalId: c.id,
        author: c.username,
        text: (c.text ?? '').trim(),
        likes: n(c.like_count),
        postedAt: c.timestamp ? new Date(c.timestamp) : undefined,
      }))
      .filter(c => c.text !== '')
      .slice(0, limit);
  },
};

interface FbPage {
  id: string; name?: string; link?: string;
  followers_count?: number; fan_count?: number;
}
interface FbPosts {
  data?: Array<{
    id: string; message?: string; created_time?: string; permalink_url?: string;
    full_picture?: string;
    likes?: { summary?: { total_count?: number } };
    comments?: { summary?: { total_count?: number } };
  }>;
}
interface FbComments {
  data?: Array<{ id: string; message?: string; created_time?: string; like_count?: number; from?: { name?: string } }>;
}

export const metaFacebook: SocialProvider = {
  id: 'meta-graph:facebook',
  platform: 'facebook',
  supportsOwn: true,
  supportsCompetitor: false,
  requires: ['META_ACCESS_TOKEN'],

  async fetchProfile(handle: string, ctx: SocialProviderContext): Promise<ProfileResult> {
    const tok = token(ctx, 'facebook');
    const id = assertGraphId(handle, 'facebook');

    const p = await call<FbPage>(id, { fields: 'id,name,link,followers_count,fan_count' }, tok);

    // followers_count is the modern field; fan_count is the legacy "likes"
    // number. Prefer the former, fall back rather than reporting nothing.
    const followers = typeof p.followers_count === 'number' ? p.followers_count
      : typeof p.fan_count === 'number' ? p.fan_count
      : null;
    if (followers === null) {
      throw new SocialProviderError(
        'Meta did not return a follower count. The token likely lacks pages_read_engagement.',
        'meta',
      );
    }

    const profile = {
      handle: p.name ?? id,
      displayName: p.name,
      profileUrl: p.link ?? `https://facebook.com/${id}`,
      avatarUrl: undefined,
      followers,
      postCount: undefined,
    };

    const posts = await call<FbPosts>(`${id}/posts`, {
      fields: 'id,message,created_time,permalink_url,full_picture,likes.summary(true),comments.summary(true)',
      limit: '1',
    }, tok);

    const post = posts.data?.[0];
    if (!post) return { profile };

    const latestPost: PostSnapshot = {
      externalId: post.id,
      postedAt: post.created_time ? new Date(post.created_time) : undefined,
      caption: post.message,
      mediaUrl: post.full_picture,
      permalink: post.permalink_url,
      likes: n(post.likes?.summary?.total_count),
      // Views need the page_video_insights edge and only exist for video.
      views: 0,
      commentCount: n(post.comments?.summary?.total_count),
    };
    return { profile, latestPost };
  },

  async fetchComments(post, ctx, limit): Promise<CommentSnapshot[]> {
    const tok = token(ctx, 'facebook');
    const res = await call<FbComments>(`${post.externalId}/comments`, {
      fields: 'id,message,created_time,like_count,from',
      limit: String(Math.min(100, limit)),
    }, tok);

    return (res.data ?? [])
      .map(c => ({
        externalId: c.id,
        author: c.from?.name,
        text: (c.message ?? '').trim(),
        likes: n(c.like_count),
        postedAt: c.created_time ? new Date(c.created_time) : undefined,
      }))
      .filter(c => c.text !== '')
      .slice(0, limit);
  },
};
