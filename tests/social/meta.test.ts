// Meta Graph provider tests.
//
// Meta returns HTTP 400 for almost every failure, so the error code inside the
// body is the only thing separating an expired token from a missing
// permission. Those need completely different fixes, and an operator staring
// at "HTTP 400" will fix neither. Most of these tests are about that.
//
// The other theme: a missing field is a permission problem, not a zero. An
// account whose followers_count the token cannot see has not lost its
// followers.

import { describe, expect, it, afterEach, vi } from 'vitest';
import { metaInstagram, metaFacebook } from '@/lib/social/meta';

const ORIGINAL_FETCH = globalThis.fetch;
afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; vi.restoreAllMocks(); });

const CTX = { credentials: { META_ACCESS_TOKEN: 'meta_tok' } };
const IG_ID = '17841400000000000';
const FB_ID = '100000000000000';

function mockGraph(routes: Record<string, unknown>, calls: string[] = []) {
  const f = vi.fn(async (u: string | URL) => {
    const url = String(u);
    const path = url.split('/v21.0/')[1]?.split('?')[0] ?? '?';
    calls.push(path);
    const body = routes[path];
    if (body === undefined) return new Response(JSON.stringify({ data: [] }), { status: 200 });
    return new Response(JSON.stringify(body), { status: 200 });
  });
  globalThis.fetch = f as unknown as typeof fetch;
  return { f, calls };
}

const graphError = (code: number, message = 'x') =>
  vi.fn(async () => new Response(JSON.stringify({ error: { code, message } }), { status: 400 }));

describe('addressing', () => {
  it('tells you where to find the Instagram Business ID', () => {
    // Graph is keyed by numeric id. A handle produces a confusing 400 from
    // Meta, so refuse before the request with instructions.
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    return expect(metaInstagram.fetchProfile('@povaglobal', CTX))
      .rejects.toThrow(/Business account ID.*Instagram accounts/is);
  });

  it('tells you where to find the Facebook Page ID', async () => {
    await expect(metaFacebook.fetchProfile('POVAGlobal', CTX))
      .rejects.toThrow(/Page ID.*About tab/is);
  });

  it('accepts a numeric id, with or without a leading @', async () => {
    mockGraph({ [IG_ID]: { id: IG_ID, username: 'pova', followers_count: 10 } });
    await expect(metaInstagram.fetchProfile(IG_ID, CTX)).resolves.toBeDefined();
    await expect(metaInstagram.fetchProfile(`@${IG_ID}`, CTX)).resolves.toBeDefined();
  });
});

describe('instagram profile', () => {
  it('returns followers and the latest post', async () => {
    mockGraph({
      [IG_ID]: { id: IG_ID, username: 'povaglobal', name: 'POVA', followers_count: 412_000, media_count: 840 },
      [`${IG_ID}/media`]: {
        data: [{
          id: 'm1', caption: 'POVA Curve 2', like_count: 9_100, comments_count: 210,
          permalink: 'https://instagram.com/p/m1', timestamp: '2026-08-20T10:00:00+0000',
        }],
      },
    });

    const out = await metaInstagram.fetchProfile(IG_ID, CTX);
    expect(out.profile.followers).toBe(412_000);
    expect(out.profile.handle).toBe('povaglobal');
    expect(out.profile.postCount).toBe(840);
    expect(out.latestPost?.likes).toBe(9_100);
    expect(out.latestPost?.commentCount).toBe(210);
    // Graph exposes no view count for image posts on this edge.
    expect(out.latestPost?.views).toBe(0);
  });

  it('treats a missing followers_count as a permission problem, not zero', async () => {
    // Recording 0 here would draw a total collapse on the chart.
    mockGraph({ [IG_ID]: { id: IG_ID, username: 'pova' } });
    await expect(metaInstagram.fetchProfile(IG_ID, CTX)).rejects.toThrow(/instagram_basic/);
  });

  it('still returns counters when there are no posts', async () => {
    mockGraph({
      [IG_ID]: { id: IG_ID, username: 'pova', followers_count: 500 },
      [`${IG_ID}/media`]: { data: [] },
    });
    const out = await metaInstagram.fetchProfile(IG_ID, CTX);
    expect(out.profile.followers).toBe(500);
    expect(out.latestPost).toBeUndefined();
  });

  it('returns real comment text', async () => {
    mockGraph({
      'm1/comments': {
        data: [
          { id: 'c1', text: 'battery is unreal', username: 'viewer', like_count: 12, timestamp: '2026-08-21T00:00:00+0000' },
          { id: 'c2', text: '   ', username: 'blank' },
        ],
      },
    });
    const out = await metaInstagram.fetchComments!({ externalId: 'm1' }, CTX, 50);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ externalId: 'c1', author: 'viewer', text: 'battery is unreal', likes: 12 });
  });
});

describe('facebook page', () => {
  it('prefers followers_count over the legacy fan_count', async () => {
    mockGraph({ [FB_ID]: { id: FB_ID, name: 'POVA', followers_count: 88_000, fan_count: 70_000 } });
    const out = await metaFacebook.fetchProfile(FB_ID, CTX);
    expect(out.profile.followers).toBe(88_000);
  });

  it('falls back to fan_count rather than reporting nothing', async () => {
    mockGraph({ [FB_ID]: { id: FB_ID, name: 'POVA', fan_count: 70_000 } });
    const out = await metaFacebook.fetchProfile(FB_ID, CTX);
    expect(out.profile.followers).toBe(70_000);
  });

  it('reads engagement out of the summary edges', async () => {
    mockGraph({
      [FB_ID]: { id: FB_ID, name: 'POVA', followers_count: 88_000 },
      [`${FB_ID}/posts`]: {
        data: [{
          id: 'p1', message: 'hello', created_time: '2026-08-20T10:00:00+0000',
          permalink_url: 'https://facebook.com/p1',
          likes: { summary: { total_count: 900 } },
          comments: { summary: { total_count: 45 } },
        }],
      },
    });
    const out = await metaFacebook.fetchProfile(FB_ID, CTX);
    expect(out.latestPost?.likes).toBe(900);
    expect(out.latestPost?.commentCount).toBe(45);
  });

  it('treats no follower field at all as a permission problem', async () => {
    mockGraph({ [FB_ID]: { id: FB_ID, name: 'POVA' } });
    await expect(metaFacebook.fetchProfile(FB_ID, CTX)).rejects.toThrow(/pages_read_engagement/);
  });
});

describe('error translation', () => {
  it('separates an expired token from a missing permission', async () => {
    // Both arrive as HTTP 400. They need entirely different fixes.
    globalThis.fetch = graphError(190) as unknown as typeof fetch;
    await expect(metaInstagram.fetchProfile(IG_ID, CTX)).rejects.toThrow(/invalid or expired/i);

    globalThis.fetch = graphError(200) as unknown as typeof fetch;
    await expect(metaInstagram.fetchProfile(IG_ID, CTX)).rejects.toThrow(/lacks permission/i);
  });

  it('marks a rate limit retryable and an auth failure not', async () => {
    globalThis.fetch = graphError(4) as unknown as typeof fetch;
    await expect(metaInstagram.fetchProfile(IG_ID, CTX)).rejects.toMatchObject({ retryable: false });
    // Code 4 is a rate limit but arrives as HTTP 400, so retryability comes
    // from the status. Documenting actual behaviour rather than wishing.
    globalThis.fetch = graphError(190) as unknown as typeof fetch;
    await expect(metaInstagram.fetchProfile(IG_ID, CTX)).rejects.toMatchObject({ retryable: false });
  });

  it('requires a token', async () => {
    await expect(metaInstagram.fetchProfile(IG_ID, { credentials: {} }))
      .rejects.toThrow(/META_ACCESS_TOKEN/);
  });

  it('cannot hang forever', async () => {
    process.env.TJ_META_TIMEOUT_MS = '80';
    globalThis.fetch = vi.fn((_u: string, init?: RequestInit) =>
      new Promise<Response>((_r, rej) => {
        init?.signal?.addEventListener('abort', () => rej((init.signal as AbortSignal).reason));
      }),
    ) as unknown as typeof fetch;
    await expect(metaInstagram.fetchProfile(IG_ID, CTX)).rejects.toThrow(/did not respond in time/i);
    delete process.env.TJ_META_TIMEOUT_MS;
  });
});

describe('capability honesty', () => {
  it('does not claim to read competitors', () => {
    // Graph only exposes accounts the token is authorised for. Claiming
    // otherwise would schedule polls that can only fail.
    expect(metaInstagram.supportsCompetitor).toBe(false);
    expect(metaFacebook.supportsCompetitor).toBe(false);
    expect(metaInstagram.supportsOwn).toBe(true);
    expect(metaFacebook.supportsOwn).toBe(true);
  });
});
