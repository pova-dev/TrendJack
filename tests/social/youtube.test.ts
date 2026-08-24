// YouTube provider tests.
//
// Two properties matter most here and neither is obvious from the code:
//   1. Quota discipline. search.list costs 100 units against a 10,000/day
//      budget; the uploads playlist answers the same question for 1. Using
//      the wrong endpoint would exhaust the quota in under a day at the
//      configured cadence, so the tests assert which endpoints get called.
//   2. Absence is never written as zero. A hidden subscriber count must fail
//      loudly rather than record 0, which would draw a collapse to nothing.

import { describe, expect, it, afterEach, vi } from 'vitest';
import { youtubeApi } from '@/lib/social/youtube';

const ORIGINAL_FETCH = globalThis.fetch;
afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; vi.restoreAllMocks(); });

const CTX = { credentials: { YOUTUBE_API_KEY: 'yt_key' } };

/** Route mock responses by endpoint, and record the call order. */
function mockYouTube(routes: Record<string, unknown>, calls: string[] = []) {
  const f = vi.fn(async (u: string | URL) => {
    const url = String(u);
    const endpoint = url.split('/youtube/v3/')[1]?.split('?')[0] ?? '?';
    calls.push(endpoint);
    const body = routes[endpoint];
    if (body === undefined) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  });
  globalThis.fetch = f as unknown as typeof fetch;
  return { f, calls };
}

const CHANNEL = {
  items: [{
    id: 'UCabcdefghijklmnopqrstuv',
    snippet: { title: 'POVA', customUrl: '@povaglobal', thumbnails: { high: { url: 'https://img/h.jpg' } } },
    statistics: { subscriberCount: '412000', videoCount: '840' },
    contentDetails: { relatedPlaylists: { uploads: 'UUabcdefghijklmnopqrstuv' } },
  }],
};
const PLAYLIST = { items: [{ snippet: { resourceId: { videoId: 'vid123' } } }] };
const VIDEO = {
  items: [{
    id: 'vid123',
    snippet: { title: 'POVA Curve 2', publishedAt: '2026-08-20T10:00:00Z', thumbnails: { high: { url: 'https://img/v.jpg' } } },
    statistics: { viewCount: '1200000', likeCount: '44000', commentCount: '2100' },
  }],
};

describe('youtube profile fetch', () => {
  it('returns subscribers and the latest video stats', async () => {
    mockYouTube({ channels: CHANNEL, playlistItems: PLAYLIST, videos: VIDEO });

    const out = await youtubeApi.fetchProfile('@povaglobal', CTX);

    expect(out.profile.followers).toBe(412_000);
    expect(out.profile.postCount).toBe(840);
    expect(out.profile.displayName).toBe('POVA');
    expect(out.latestPost?.views).toBe(1_200_000);
    expect(out.latestPost?.likes).toBe(44_000);
    expect(out.latestPost?.commentCount).toBe(2_100);
    expect(out.latestPost?.permalink).toBe('https://www.youtube.com/watch?v=vid123');
  });

  it('never calls search.list, which would cost 100 units of a 10,000/day quota', async () => {
    const { calls } = mockYouTube({ channels: CHANNEL, playlistItems: PLAYLIST, videos: VIDEO });
    await youtubeApi.fetchProfile('@povaglobal', CTX);

    expect(calls).not.toContain('search');
    // 3 units total: channels + playlistItems + videos.
    expect(calls).toEqual(['channels', 'playlistItems', 'videos']);
  });

  it('accepts a raw channel id without a handle lookup', async () => {
    const { f, calls } = mockYouTube({ channels: CHANNEL, playlistItems: PLAYLIST, videos: VIDEO });
    await youtubeApi.fetchProfile('UCabcdefghijklmnopqrstuv', CTX);

    expect(calls[0]).toBe('channels');
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain('id=UCabcdefghijklmnopqrstuv');
  });

  it('refuses a hidden subscriber count instead of recording zero', async () => {
    // Writing 0 here would render as the channel losing every subscriber.
    mockYouTube({
      channels: { items: [{ ...CHANNEL.items[0], statistics: { hiddenSubscriberCount: true, videoCount: '10' } }] },
    });
    await expect(youtubeApi.fetchProfile('@hidden', CTX)).rejects.toThrow(/hides its subscriber count/i);
  });

  it('still returns counters when the channel has no uploads', async () => {
    mockYouTube({ channels: { items: [{ ...CHANNEL.items[0], contentDetails: {} }] } });
    const out = await youtubeApi.fetchProfile('@povaglobal', CTX);
    expect(out.profile.followers).toBe(412_000);
    expect(out.latestPost).toBeUndefined();
  });

  it('reports a missing channel clearly', async () => {
    mockYouTube({ channels: { items: [] } });
    await expect(youtubeApi.fetchProfile('@nope', CTX)).rejects.toThrow(/No YouTube channel matches/i);
  });

  it('separates a quota failure from a bad key, since the fixes differ', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }), { status: 403 }),
    ) as unknown as typeof fetch;
    await expect(youtubeApi.fetchProfile('@x', CTX)).rejects.toThrow(/quota exhausted/i);

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { errors: [{ reason: 'keyInvalid' }] } }), { status: 403 }),
    ) as unknown as typeof fetch;
    await expect(youtubeApi.fetchProfile('@x', CTX)).rejects.toThrow(/rejected the API key/i);
  });

  it('requires a key', async () => {
    await expect(youtubeApi.fetchProfile('@x', { credentials: {} })).rejects.toThrow(/YOUTUBE_API_KEY/);
  });

  it('cannot hang forever', async () => {
    process.env.TJ_YOUTUBE_TIMEOUT_MS = '80';
    globalThis.fetch = vi.fn((_u: string, init?: RequestInit) =>
      new Promise<Response>((_r, rej) => {
        init?.signal?.addEventListener('abort', () => rej((init.signal as AbortSignal).reason));
      }),
    ) as unknown as typeof fetch;

    await expect(youtubeApi.fetchProfile('@x', CTX)).rejects.toThrow(/did not respond in time/i);
    delete process.env.TJ_YOUTUBE_TIMEOUT_MS;
  });
});

describe('youtube comments', () => {
  it('returns real comment text, which no configured Apify actor does', async () => {
    mockYouTube({
      commentThreads: {
        items: [
          { snippet: { topLevelComment: { id: 'c1', snippet: { authorDisplayName: 'viewer', textOriginal: 'battery is unreal', likeCount: 12, publishedAt: '2026-08-21T00:00:00Z' } } } },
          { snippet: { topLevelComment: { id: 'c2', snippet: { authorDisplayName: 'other', textOriginal: '   ', likeCount: 0 } } } },
        ],
      },
    });

    const out = await youtubeApi.fetchComments!({ externalId: 'vid123' }, CTX, 50);

    expect(out).toHaveLength(1);            // the blank one is dropped
    expect(out[0]).toMatchObject({ externalId: 'c1', author: 'viewer', text: 'battery is unreal', likes: 12 });
    expect(out[0].postedAt).toBeInstanceOf(Date);
  });

  it('honours the requested limit', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      snippet: { topLevelComment: { id: `c${i}`, snippet: { textOriginal: `comment ${i}`, likeCount: 0 } } },
    }));
    mockYouTube({ commentThreads: { items: many } });

    const out = await youtubeApi.fetchComments!({ externalId: 'v' }, CTX, 10);
    expect(out).toHaveLength(10);
  });
});
