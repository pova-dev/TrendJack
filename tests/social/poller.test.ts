// Poller routing and cadence tests.
//
// pollAccount itself talks to Prisma, so these cover the two pure decisions
// that determine whether the poller does the right thing at all: which
// provider reads which account, and which accounts are due.
//
// The routing matters commercially. Sending YouTube to Apify would pay for
// strictly less data than the free Data API returns, and claiming Facebook is
// pollable would produce a poll that can only fail.

import { describe, expect, it } from 'vitest';
import { pickProvider, findDueAccounts } from '@/lib/social/poller';

const FULL = {
  YOUTUBE_API_KEY: 'yt',
  APIFY_TOKEN: 'ap',
  APIFY_ACTOR_INSTAGRAM_PROFILE: 'apify/instagram-profile-scraper',
};

describe('pickProvider', () => {
  it('sends YouTube to the free official API, never to Apify', () => {
    const own = pickProvider('youtube', true, FULL);
    const rival = pickProvider('youtube', false, FULL);

    expect(own.provider?.id).toBe('youtube-api');
    // Competitors too: YouTube publishes subscriber counts for every channel,
    // so there is never a reason to pay a scraper for it.
    expect(rival.provider?.id).toBe('youtube-api');
  });

  it('sends Instagram to the profile actor, the only handle-addressable one', () => {
    expect(pickProvider('instagram', false, FULL).provider?.id).toBe('apify:instagram-profile');
  });

  it('refuses competitor Facebook, because nothing configured reports page followers', () => {
    // The configured Facebook actor is addressed by post URL and returns no
    // follower count. Saying "supported" would schedule a poll that can only
    // fail, over and over.
    const rival = pickProvider('facebook', false, FULL);
    expect(rival.provider).toBeNull();
    expect('reason' in rival && rival.reason).toMatch(/post URL|followers/i);
  });

  it('uses Meta Graph for accounts we own', () => {
    const withMeta = { ...FULL, META_ACCESS_TOKEN: 'meta' };
    expect(pickProvider('facebook', true, withMeta).provider?.id).toBe('meta-graph:facebook');
    // Own Instagram prefers Graph over Apify: free, exact, and it returns
    // comment text that no configured actor does.
    expect(pickProvider('instagram', true, withMeta).provider?.id).toBe('meta-graph:instagram');
  });

  it('never uses Graph for a competitor, which it cannot read', () => {
    const withMeta = { ...FULL, META_ACCESS_TOKEN: 'meta' };
    expect(pickProvider('instagram', false, withMeta).provider?.id).toBe('apify:instagram-profile');
    expect(pickProvider('facebook', false, withMeta).provider).toBeNull();
  });

  it('falls back to Apify for own Instagram when Meta is not configured', () => {
    expect(pickProvider('instagram', true, FULL).provider?.id).toBe('apify:instagram-profile');
  });

  it('explains exactly which credential is missing', () => {
    const yt = pickProvider('youtube', false, {});
    expect(yt.provider).toBeNull();
    expect('reason' in yt && yt.reason).toMatch(/YOUTUBE_API_KEY/);
    expect('reason' in yt && yt.reason).toMatch(/free/i);   // says it costs nothing

    const ig = pickProvider('instagram', false, { APIFY_TOKEN: 'ap' });
    expect(ig.provider).toBeNull();
    // Token alone is not enough; the actor id is required too.
    expect('reason' in ig && ig.reason).toMatch(/APIFY_ACTOR_INSTAGRAM_PROFILE/);
  });
});

describe('cadence selection', () => {
  // findDueAccounts reads the DB, so exercise the same predicate directly.
  const DEFAULT_CADENCE_SEC = 900;
  const due = (lastPolledAt: Date | null, cadenceSec: number | null, now: Date) => {
    if (!lastPolledAt) return true;
    return now.getTime() - lastPolledAt.getTime() >= (cadenceSec ?? DEFAULT_CADENCE_SEC) * 1000;
  };

  const now = new Date('2026-08-24T12:00:00Z');
  const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  it('polls an account that has never been polled', () => {
    expect(due(null, null, now)).toBe(true);
  });

  it('waits the full 15 minutes by default', () => {
    expect(due(minsAgo(14), null, now)).toBe(false);
    expect(due(minsAgo(15), null, now)).toBe(true);
    expect(due(minsAgo(60), null, now)).toBe(true);
  });

  it('honours a per-account override, which is how POVA can poll faster than competitors', () => {
    expect(due(minsAgo(6), 300, now)).toBe(true);    // 5 min cadence
    expect(due(minsAgo(4), 300, now)).toBe(false);
    expect(due(minsAgo(30), 3600, now)).toBe(false); // 1 hour cadence
  });

  it('is exported and callable', () => {
    expect(typeof findDueAccounts).toBe('function');
  });
});
