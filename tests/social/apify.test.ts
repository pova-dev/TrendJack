// Apify provider tests.
//
// The field mappers are the part most likely to break when a different actor
// is swapped in, and the part where a silent failure is most dangerous: a
// mis-read follower count doesn't error, it just draws a cliff on the chart.
// So these pin the tolerant-reader behaviour and, above all, that missing
// data becomes 0 rather than a guess (CLAUDE.md hard-rule 1).

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  apifyInstagramProfile, apifyInstagramPost, apifyFacebookPost, apifyYoutubeVideo,
  handleToFacebookUrl, mapComment, mapPost, mapProfile, runActor,
} from '@/lib/social/apify';
import { SocialProviderError, providerReady } from '@/lib/social/types';

const ORIGINAL_FETCH = globalThis.fetch;
afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; vi.restoreAllMocks(); });

const ok = (body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

const fail = (status: number, body = '') =>
  vi.fn(async () => new Response(body, { status }));

// The operator's actual configured actors.
const CREDS = {
  APIFY_TOKEN: 'apify_tok',
  APIFY_ACTOR_INSTAGRAM_PROFILE: 'apify/instagram-profile-scraper',
  APIFY_ACTOR_INSTAGRAM_POST: 'patient_discovery/instagram-reel-analytics-by-url',
  APIFY_ACTOR_FACEBOOK_POST: 'clappi/facebook-posts-reels-scraper',
  APIFY_ACTOR_YOUTUBE_VIDEO: 'beyondops/youtube-metadata-scraper-pro-v2',
};

describe('field mappers tolerate actor-specific spellings', () => {
  it('reads followers under any of the common field names', () => {
    expect(mapProfile({ followersCount: 1200 }, 'x').followers).toBe(1200);
    expect(mapProfile({ followers: 1300 }, 'x').followers).toBe(1300);
    expect(mapProfile({ fanCount: 1400 }, 'x').followers).toBe(1400);   // facebook
    expect(mapProfile({ followerCount: 1500 }, 'x').followers).toBe(1500);
  });

  it('coerces numeric strings, which several actors emit', () => {
    expect(mapProfile({ followersCount: '98765' }, 'x').followers).toBe(98765);
  });

  it('falls back to the requested handle when the row omits one', () => {
    expect(mapProfile({ followersCount: 1 }, 'povaglobal').handle).toBe('povaglobal');
    expect(mapProfile({ username: 'actual' }, 'requested').handle).toBe('actual');
  });

  it('reports 0 — never a guess — for metrics the platform withholds', () => {
    // An Instagram image post carries no view count. Rule 1: emit 0 so the
    // UI can render '—'. Inventing a number here is the exact failure the
    // Reddit reach bug was.
    const post = mapPost({ likesCount: 900, commentsCount: 40, id: 'p1' });
    expect(post.views).toBe(0);
    expect(post.likes).toBe(900);
    expect(post.commentCount).toBe(40);
  });

  it('reads video views when the platform does expose them', () => {
    expect(mapPost({ id: 'p', videoViewCount: 50_000 }).views).toBe(50_000);
    expect(mapPost({ id: 'p', videoPlayCount: 60_000 }).views).toBe(60_000);
  });

  it('parses comments and drops empty ones', () => {
    const c = mapComment({ id: 'c1', ownerUsername: 'someone', text: 'nice', likesCount: 3 });
    expect(c).toMatchObject({ externalId: 'c1', author: 'someone', text: 'nice', likes: 3 });
  });

  it('ignores unparseable dates rather than emitting Invalid Date', () => {
    expect(mapPost({ id: 'p', timestamp: 'not-a-date' }).postedAt).toBeUndefined();
    expect(mapPost({ id: 'p', timestamp: '2026-05-01T00:00:00Z' }).postedAt).toBeInstanceOf(Date);
  });
});

describe('runActor', () => {
  it('converts an actor id to Apify path form and passes the token', async () => {
    const f = ok([{ followersCount: 1 }]);
    globalThis.fetch = f as unknown as typeof fetch;

    await runActor('apify/instagram-profile-scraper', {}, 'tok');

    const url = String((f.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('apify~instagram-profile-scraper');
    expect(url).toContain('token=tok');
  });

  it('refuses to run with no token', async () => {
    await expect(runActor('a/b', {}, '')).rejects.toThrow(/APIFY_TOKEN/);
  });

  it('refuses to run with no actor configured', async () => {
    await expect(runActor('', {}, 'tok')).rejects.toThrow(/actor/i);
  });

  it('explains an out-of-credit account in operator language', async () => {
    globalThis.fetch = fail(402) as unknown as typeof fetch;
    // Same class of failure that silently killed the AI layer — say it plainly.
    await expect(runActor('a/b', {}, 'tok')).rejects.toThrow(/out of credit/i);
  });

  it('explains a bad token', async () => {
    globalThis.fetch = fail(401) as unknown as typeof fetch;
    await expect(runActor('a/b', {}, 'tok')).rejects.toThrow(/token/i);
  });

  it('explains a missing actor', async () => {
    globalThis.fetch = fail(404) as unknown as typeof fetch;
    await expect(runActor('a/b', {}, 'tok')).rejects.toThrow(/not found/i);
  });

  it('marks rate limits and 5xx as retryable, auth errors as not', async () => {
    globalThis.fetch = fail(429) as unknown as typeof fetch;
    await expect(runActor('a/b', {}, 'tok')).rejects.toMatchObject({ retryable: true });

    globalThis.fetch = fail(403) as unknown as typeof fetch;
    await expect(runActor('a/b', {}, 'tok')).rejects.toMatchObject({ retryable: false });
  });

  it('cannot hang forever', async () => {
    // Same defence as the AI provider: a scrape that never returns must not
    // pin a poller slot. The mock honours the signal like real fetch does.
    process.env.TJ_APIFY_TIMEOUT_MS = '100';
    globalThis.fetch = vi.fn((_u: string, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej((init.signal as AbortSignal).reason));
      }),
    ) as unknown as typeof fetch;

    await expect(runActor('a/b', {}, 'tok')).rejects.toThrow(/did not finish/i);
    delete process.env.TJ_APIFY_TIMEOUT_MS;
  });
});

describe('instagram provider', () => {
  it('returns counters and reuses an embedded latest post', async () => {
    // Reusing the embedded post avoids a second billed actor run per tick.
    globalThis.fetch = ok([{
      username: 'povaglobal',
      followersCount: 412_000,
      postsCount: 1_240,
      latestPosts: [{ id: 'p9', likesCount: 3_100, commentsCount: 210, url: 'https://instagram.com/p/p9' }],
    }]) as unknown as typeof fetch;

    const out = await apifyInstagramProfile.fetchProfile('@povaglobal', { credentials: CREDS });

    expect(out.profile.followers).toBe(412_000);
    expect(out.profile.handle).toBe('povaglobal');
    expect(out.latestPost?.externalId).toBe('p9');
    expect(out.latestPost?.likes).toBe(3_100);
    expect(out.latestPost?.views).toBe(0); // image post — '—', not invented
  });

  it('strips a leading @ before querying', async () => {
    const calls: RequestInit[] = [];
    globalThis.fetch = vi.fn(async (_u: string, init?: RequestInit) => {
      if (init) calls.push(init);
      return new Response(JSON.stringify([{ followersCount: 1 }]), { status: 200 });
    }) as unknown as typeof fetch;

    await apifyInstagramProfile.fetchProfile('@povaglobal', { credentials: CREDS });

    const body = JSON.parse(String(calls[0].body)) as { usernames: string[] };
    expect(body.usernames).toEqual(['povaglobal']);
  });

  it('surfaces a private or deleted account instead of writing a zeroed sample', async () => {
    // Writing followers:0 here would draw a cliff on the chart that looks
    // like the brand lost every follower.
    globalThis.fetch = ok([{ error: 'not_found', username: 'ghost' }]) as unknown as typeof fetch;

    await expect(apifyInstagramProfile.fetchProfile('ghost', { credentials: CREDS }))
      .rejects.toThrow(/could not read/i);
  });

  it('errors clearly when an empty result set comes back', async () => {
    globalThis.fetch = ok([]) as unknown as typeof fetch;
    await expect(apifyInstagramProfile.fetchProfile('x', { credentials: CREDS }))
      .rejects.toThrow(/no data/i);
  });

  it('offers no comment fetch — this actor returns counts only', () => {
    // apify/instagram-profile-scraper reports commentsCount but no bodies.
    // Leaving fetchComments undefined lets the UI hide the "load comments"
    // action rather than show a button that can only fail.
    expect(apifyInstagramProfile.fetchComments).toBeUndefined();
  });
});

describe('post-metrics providers (addressed by URL, not handle)', () => {
  it('reads the reel actor\'s NESTED metrics', async () => {
    // patient_discovery/instagram-reel-analytics-by-url nests everything under
    // metrics.* / caption.*. A flat reader would score every one of these as
    // 0 and the dashboard would look plausible but be entirely wrong.
    globalThis.fetch = ok([{
      code: 'abc123',
      metrics: { like_count: 12_400, comment_count: 380, play_count: 250_000 },
      caption: { text: 'POVA Curve 2 drop' },
      user: { username: 'povaglobal' },
    }]) as unknown as typeof fetch;

    const post = await apifyInstagramPost.fetchPostMetrics!(
      'https://instagram.com/reel/abc123', { credentials: CREDS },
    );

    expect(post.likes).toBe(12_400);
    expect(post.commentCount).toBe(380);
    expect(post.views).toBe(250_000);
    expect(post.caption).toBe('POVA Curve 2 drop');
  });

  it('reads the facebook actor\'s flat fields', async () => {
    globalThis.fetch = ok([{
      url: 'https://facebook.com/p/1', likes: 900, views: 0, comments: 45,
      caption: 'hello', datePosted: '2026-08-01T10:00:00Z',
    }]) as unknown as typeof fetch;

    const post = await apifyFacebookPost.fetchPostMetrics!(
      'https://facebook.com/p/1', { credentials: CREDS },
    );

    expect(post.likes).toBe(900);
    expect(post.commentCount).toBe(45);
    expect(post.views).toBe(0); // non-reel FB post — '—', not invented
    expect(post.postedAt).toBeInstanceOf(Date);
  });

  it('reads the youtube actor\'s snake_case fields', async () => {
    globalThis.fetch = ok([{
      title: 'POVA Curve 2 review', views: 1_200_000, likes: 44_000,
      comment_count: 2_100, upload_date: '2026-07-20',
    }]) as unknown as typeof fetch;

    const post = await apifyYoutubeVideo.fetchPostMetrics!(
      'https://youtube.com/watch?v=x', { credentials: CREDS },
    );

    expect(post.views).toBe(1_200_000);
    expect(post.likes).toBe(44_000);
    expect(post.commentCount).toBe(2_100);
  });

  it('falls back to the URL as the id when the actor omits one', async () => {
    globalThis.fetch = ok([{ likes: 1 }]) as unknown as typeof fetch;
    const post = await apifyFacebookPost.fetchPostMetrics!('https://fb.com/p/9', { credentials: CREDS });
    expect(post.externalId).toBe('https://fb.com/p/9');
    expect(post.permalink).toBe('https://fb.com/p/9');
  });

  it('refuses a handle lookup rather than reporting zero followers', async () => {
    // These actors cannot resolve a handle. Returning followers:0 would be
    // indistinguishable from a real collapse to zero.
    await expect(apifyInstagramPost.fetchProfile('povaglobal', { credentials: CREDS }))
      .rejects.toThrow(/post URL|follower/i);
    await expect(apifyYoutubeVideo.fetchProfile('povaglobal', { credentials: CREDS }))
      .rejects.toThrow(/post URL|follower/i);
  });

  it('sends the input field each actor actually expects', async () => {
    const bodies: string[] = [];
    globalThis.fetch = vi.fn(async (_u: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify([{ likes: 1 }]), { status: 200 });
    }) as unknown as typeof fetch;

    await apifyInstagramPost.fetchPostMetrics!('u1', { credentials: CREDS });
    await apifyYoutubeVideo.fetchPostMetrics!('u2', { credentials: CREDS });

    expect(JSON.parse(bodies[0])).toEqual({ postUrls: ['u1'] });
    expect(JSON.parse(bodies[1])).toEqual({ videoUrls: ['u2'] });  // NOT postUrls
  });
});

describe('handleToFacebookUrl', () => {
  it('accepts a bare slug or a full URL', () => {
    expect(handleToFacebookUrl('povaglobal')).toBe('https://www.facebook.com/povaglobal');
    expect(handleToFacebookUrl('@povaglobal')).toBe('https://www.facebook.com/povaglobal');
    expect(handleToFacebookUrl('https://www.facebook.com/pova')).toBe('https://www.facebook.com/pova');
  });
});

describe('providerReady', () => {
  it('requires the actor id as well as the token', () => {
    // A token alone is not enough: without the actor id the run would fail
    // at request time. Better to render "needs setup" than to poll and error.
    expect(providerReady(apifyInstagramProfile, {})).toBe(false);
    expect(providerReady(apifyInstagramProfile, { APIFY_TOKEN: 'tok' })).toBe(false);
    expect(providerReady(apifyInstagramProfile, {
      APIFY_TOKEN: '  ', APIFY_ACTOR_INSTAGRAM_PROFILE: 'apify/instagram-profile-scraper',
    })).toBe(false);
    expect(providerReady(apifyInstagramProfile, {
      APIFY_TOKEN: 'tok', APIFY_ACTOR_INSTAGRAM_PROFILE: 'apify/instagram-profile-scraper',
    })).toBe(true);
  });
});

describe('SocialProviderError', () => {
  it('carries provider and retryability for the UI to act on', () => {
    const e = new SocialProviderError('boom', 'apify', true);
    expect(e.provider).toBe('apify');
    expect(e.retryable).toBe(true);
    expect(e).toBeInstanceOf(Error);
  });
});
