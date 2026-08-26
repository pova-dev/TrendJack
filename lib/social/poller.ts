// Social counter poller.
//
// Every tick: find accounts whose cadence has elapsed, fetch counters, append a
// SocialSample with a precomputed delta, upsert the latest post, and publish an
// SSE event so open dashboards animate without a refresh.
//
// Cost discipline is the reason for the shape of this file. Apify bills per
// result, so a poll fetches exactly one profile per account and nothing else.
// Comment TEXT is never fetched here: it is on-demand only, which is what keeps
// the standing bill near zero.

import 'server-only';
import { prisma } from '@/lib/db';
import { getOrgCredentials } from '@/lib/credentials';
import { bus } from '@/lib/realtime/bus';
import { providerReady, SocialProviderError, type SocialProvider, type SocialPlatform } from './types';
import { youtubeApi } from './youtube';
import {
  apifyInstagramProfile, apifyFacebookPage,
  apifyInstagramComments, apifyFacebookComments,
} from './apify';
import { metaInstagram, metaFacebook } from './meta';

/** Default cadence. Matches the 15-minute decision in the build plan: fast
 *  enough that deltas feel live, slow enough that Apify stays affordable. */
const DEFAULT_CADENCE_SEC = 900;
const TICK_MS = 60_000;          // check for due accounts every minute
const MAX_CONCURRENT = 4;        // be a polite client, and bound burst spend

/**
 * Which provider can read this account.
 *
 * Returns null with a reason rather than throwing, so an unsupported
 * combination shows as a clear per-account message instead of a failed poll.
 * Facebook currently has no follower source at all: the configured Apify actor
 * is addressed by post URL and reports no page followers, and the Graph API
 * only covers pages you own.
 */
export function pickProvider(
  platform: SocialPlatform,
  isOwn: boolean,
  creds: Record<string, string>,
): { provider: SocialProvider } | { provider: null; reason: string } {
  if (platform === 'youtube') {
    return providerReady(youtubeApi, creds)
      ? { provider: youtubeApi }
      : { provider: null, reason: 'Add YOUTUBE_API_KEY in Settings to track YouTube. It is free.' };
  }

  if (platform === 'instagram') {
    // Own accounts prefer Graph: free, exact, and it returns comment text,
    // which no configured Apify actor does. Apify is the fallback, and the
    // only option for competitors.
    if (isOwn && providerReady(metaInstagram, creds)) return { provider: metaInstagram };
    if (providerReady(apifyInstagramProfile, creds)) return { provider: apifyInstagramProfile };
    return {
      provider: null,
      reason: isOwn
        ? 'Add META_ACCESS_TOKEN for your own Instagram (free and exact), or APIFY_TOKEN + APIFY_ACTOR_INSTAGRAM_PROFILE.'
        : 'Add APIFY_TOKEN and APIFY_ACTOR_INSTAGRAM_PROFILE in Settings to track competitor Instagram.',
    };
  }

  // Own pages prefer Graph: free and exact. A pages actor closes the
  // competitor gap, which the post-URL actor never could.
  if (isOwn && providerReady(metaFacebook, creds)) return { provider: metaFacebook };
  if (providerReady(apifyFacebookPage, creds)) return { provider: apifyFacebookPage };

  return {
    provider: null,
    reason: isOwn
      ? 'Add META_ACCESS_TOKEN to track your own Facebook Page. It is free and exact.'
      : 'Competitor Facebook needs a pages actor. Set APIFY_ACTOR_FACEBOOK_PAGE (e.g. apify/facebook-pages-scraper); the configured post actor reads post URLs only and reports no follower count.',
  };
}

/**
 * Which provider can read comment TEXT for a post.
 *
 * Separate from pickProvider because the capability is separate: several
 * providers report a comment COUNT but no bodies. Returning null with a reason
 * lets the UI hide the action instead of offering a button that can only fail.
 */
export function pickCommentProvider(
  platform: SocialPlatform,
  isOwn: boolean,
  creds: Record<string, string>,
): { provider: SocialProvider } | { provider: null; reason: string } {
  // YouTube ships comment text with the free API, so it never needs an actor.
  if (platform === 'youtube') {
    return providerReady(youtubeApi, creds)
      ? { provider: youtubeApi }
      : { provider: null, reason: 'Add YOUTUBE_API_KEY to read YouTube comments. It is free.' };
  }

  if (platform === 'instagram') {
    if (isOwn && providerReady(metaInstagram, creds)) return { provider: metaInstagram };
    if (providerReady(apifyInstagramComments, creds)) return { provider: apifyInstagramComments };
    return {
      provider: null,
      reason: 'Instagram comment text needs a comments actor. Set APIFY_ACTOR_INSTAGRAM_COMMENTS (e.g. apify/instagram-comment-scraper); the profile actor returns counts only.',
    };
  }

  if (isOwn && providerReady(metaFacebook, creds)) return { provider: metaFacebook };
  if (providerReady(apifyFacebookComments, creds)) return { provider: apifyFacebookComments };
  return {
    provider: null,
    reason: 'Facebook comment text needs a comments actor. Set APIFY_ACTOR_FACEBOOK_COMMENTS; the configured post actor returns counts only.',
  };
}

export interface PollOutcome {
  accountId: string;
  handle: string;
  ok: boolean;
  followers?: number;
  delta?: number;
  error?: string;
}

/** Poll one account and persist the result. Never throws: a failure is data. */
export async function pollAccount(accountId: string): Promise<PollOutcome> {
  const acct = await prisma.socialAccount.findUnique({
    where: { id: accountId },
    include: { brand: { select: { orgId: true } } },
  });
  if (!acct) return { accountId, handle: '?', ok: false, error: 'account not found' };

  const creds = await getOrgCredentials(acct.brand.orgId);
  const picked = pickProvider(acct.platform as SocialPlatform, acct.isOwn, creds as Record<string, string>);

  if (!picked.provider) {
    await prisma.socialAccount.update({
      where: { id: acct.id },
      data: { lastPolledAt: new Date(), lastError: picked.reason },
    });
    return { accountId, handle: acct.handle, ok: false, error: picked.reason };
  }

  try {
    const { profile, latestPost } = await picked.provider.fetchProfile(
      acct.handle, { credentials: creds as Record<string, string> },
    );

    // Delta against the previous reading, computed at write time so the UI
    // never has to window over the whole history to render "+412 today".
    const prev = await prisma.socialSample.findFirst({
      where: { accountId: acct.id },
      orderBy: { sampledAt: 'desc' },
      select: { followers: true },
    });
    const followers = BigInt(Math.max(0, Math.round(profile.followers)));
    const delta = prev ? followers - prev.followers : null;

    await prisma.socialSample.create({
      data: {
        accountId: acct.id,
        followers,
        postCount: profile.postCount ?? null,
        followersDelta: delta,
      },
    });

    await prisma.socialAccount.update({
      where: { id: acct.id },
      data: {
        lastPolledAt: new Date(),
        lastError: null,
        displayName: profile.displayName ?? acct.displayName,
        profileUrl: profile.profileUrl ?? acct.profileUrl,
        avatarUrl: profile.avatarUrl ?? acct.avatarUrl,
      },
    });

    if (latestPost?.externalId) {
      // Exactly one post per account carries isLatest, so clear the old flag
      // before setting the new one.
      await prisma.socialPost.updateMany({
        where: { accountId: acct.id, isLatest: true, externalId: { not: latestPost.externalId } },
        data: { isLatest: false },
      });
      await prisma.socialPost.upsert({
        where: { accountId_externalId: { accountId: acct.id, externalId: latestPost.externalId } },
        update: {
          likes: BigInt(Math.max(0, Math.round(latestPost.likes))),
          views: BigInt(Math.max(0, Math.round(latestPost.views))),
          commentCount: Math.max(0, Math.round(latestPost.commentCount)),
          caption: latestPost.caption ?? undefined,
          permalink: latestPost.permalink ?? undefined,
          mediaUrl: latestPost.mediaUrl ?? undefined,
          isLatest: true,
        },
        create: {
          accountId: acct.id,
          externalId: latestPost.externalId,
          postedAt: latestPost.postedAt ?? null,
          caption: latestPost.caption ?? null,
          mediaUrl: latestPost.mediaUrl ?? null,
          permalink: latestPost.permalink ?? null,
          likes: BigInt(Math.max(0, Math.round(latestPost.likes))),
          views: BigInt(Math.max(0, Math.round(latestPost.views))),
          commentCount: Math.max(0, Math.round(latestPost.commentCount)),
          isLatest: true,
        },
      });
    }

    // Nudge open dashboards. Reuses the board channel the brand already
    // subscribes to; the payload names the account so the client can refetch.
    bus.publish(`brand:${acct.brandId}:social`, {
      type: 'trend.updated',
      brandId: acct.brandId,
      trendId: acct.id,
      reason: 'social',
    });

    return {
      accountId, handle: acct.handle, ok: true,
      followers: Number(followers),
      delta: delta === null ? undefined : Number(delta),
    };
  } catch (e) {
    // A provider error is expected operational data (private account, quota,
    // out of credit). Record it against the account so the card can explain
    // itself, and never write a zeroed sample, which would look like a
    // catastrophic follower loss on the chart.
    const msg = e instanceof SocialProviderError ? e.message : (e as Error).message || 'poll failed';
    await prisma.socialAccount.update({
      where: { id: acct.id },
      data: { lastPolledAt: new Date(), lastError: msg.slice(0, 300) },
    });
    return { accountId, handle: acct.handle, ok: false, error: msg };
  }
}

/** Accounts whose cadence has elapsed. */
export async function findDueAccounts(now = new Date()) {
  const rows = await prisma.socialAccount.findMany({
    where: { active: true },
    select: { id: true, cadenceSec: true, lastPolledAt: true },
  });
  return rows.filter(r => {
    if (!r.lastPolledAt) return true;   // never polled
    const cadence = (r.cadenceSec ?? DEFAULT_CADENCE_SEC) * 1000;
    return now.getTime() - r.lastPolledAt.getTime() >= cadence;
  });
}

/** One pass. Exported so a cron route or a test can drive it directly. */
export async function runSocialPollTick(): Promise<PollOutcome[]> {
  const due = await findDueAccounts();
  if (!due.length) return [];

  const out: PollOutcome[] = [];
  for (let i = 0; i < due.length; i += MAX_CONCURRENT) {
    const batch = due.slice(i, i + MAX_CONCURRENT);
    out.push(...await Promise.all(batch.map(a => pollAccount(a.id))));
  }
  return out;
}

declare global {
  // eslint-disable-next-line no-var
  var __tj_social_cron_started: boolean | undefined;
  // eslint-disable-next-line no-var
  var __tj_social_last: { at: string; polled: number; ok: number; failed: number } | undefined;
}

export function getSocialPollStatus() {
  return {
    started: !!global.__tj_social_cron_started,
    last: global.__tj_social_last ?? null,
    defaultCadenceSec: DEFAULT_CADENCE_SEC,
  };
}

export function startSocialPollCron(): void {
  if (global.__tj_social_cron_started) return;
  global.__tj_social_cron_started = true;

  // eslint-disable-next-line no-console
  console.log(`[social-cron] started, checking every ${TICK_MS / 1000}s, per-account cadence ${DEFAULT_CADENCE_SEC}s`);

  const tick = async () => {
    try {
      const res = await runSocialPollTick();
      if (!res.length) return;
      global.__tj_social_last = {
        at: new Date().toISOString(),
        polled: res.length,
        ok: res.filter(r => r.ok).length,
        failed: res.filter(r => !r.ok).length,
      };
      // eslint-disable-next-line no-console
      console.log(`[social-cron] polled ${res.length}, ok ${res.filter(r => r.ok).length}, failed ${res.filter(r => !r.ok).length}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[social-cron] tick failed', (e as Error).message);
    }
  };

  const t = setInterval(tick, TICK_MS);
  if (t.unref) t.unref();
  setTimeout(tick, 5_000);   // first pass shortly after boot
}
