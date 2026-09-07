// Social Channel Analytics — read/write helpers.
//
// Every query is scoped by brandId. CLAUDE.md: no cross-tenant leakage, and
// the reviewer rejects any new query that doesn't filter.

import 'server-only';
import { prisma } from '@/lib/db';
import type { SocialPlatform } from './types';

export const PLATFORMS: SocialPlatform[] = ['instagram', 'facebook', 'youtube'];

export function isPlatform(v: string): v is SocialPlatform {
  return (PLATFORMS as string[]).includes(v);
}

/** One account plus everything the card needs to render in a single pass. */
export interface AccountView {
  id: string;
  platform: SocialPlatform;
  handle: string;
  displayName: string | null;
  profileUrl: string | null;
  avatarUrl: string | null;
  isOwn: boolean;
  competitorName: string | null;
  /** Removed by an operator. Kept rather than deleted so its history survives
   *  a re-add, but it must stay visible or the account becomes unreachable:
   *  the list hid it, the empty state then claimed no channels existed, and
   *  there was no way to restore it from the UI. */
  archived: boolean;
  lastPolledAt: string | null;
  lastError: string | null;
  /** Latest counter reading. Null until the first poll lands. */
  followers: number | null;
  /** Change since the previous reading. Null on the very first sample. */
  followersDelta: number | null;
  postCount: number | null;
  /** Follower readings oldest→newest for the sparkline. */
  history: { at: string; followers: number }[];
  /** The account's most recent post. */
  latestPost: {
    id: string;
    externalId: string;
    postedAt: string | null;
    caption: string | null;
    permalink: string | null;
    likes: number;
    views: number;
    commentCount: number;
    commentsFetchedAt: string | null;
    commentsLoaded: number;
  } | null;
}

const HISTORY_POINTS = 48; // 48 × 15min ≈ 12h of sparkline

/**
 * Every channel for the brand, archived ones included and flagged.
 *
 * Previously filtered on `active: true`, which made a removed account
 * invisible. Since removal is a soft delete, those rows still existed and
 * still counted elsewhere: the landing view reported "7 channels configured,
 * all switched off" while this page said "No channels tracked yet". Both read
 * the same table. Returning them flagged lets the UI show what is actually
 * there and offer a way back.
 */
export async function listAccounts(brandId: string): Promise<AccountView[]> {
  const rows = await prisma.socialAccount.findMany({
    where: { brandId },
    orderBy: [{ active: 'desc' }, { isOwn: 'desc' }, { platform: 'asc' }, { competitorName: 'asc' }],
    include: {
      samples: { orderBy: { sampledAt: 'desc' }, take: HISTORY_POINTS },
      posts: {
        where: { isLatest: true },
        take: 1,
        include: { _count: { select: { comments: true } } },
      },
    },
  });

  return rows.map(r => {
    const newest = r.samples[0];
    const post = r.posts[0];
    return {
      id: r.id,
      platform: r.platform as SocialPlatform,
      handle: r.handle,
      displayName: r.displayName,
      profileUrl: r.profileUrl,
      avatarUrl: r.avatarUrl,
      isOwn: r.isOwn,
      competitorName: r.competitorName,
      archived: !r.active,
      lastPolledAt: r.lastPolledAt?.toISOString() ?? null,
      lastError: r.lastError,
      followers: newest ? Number(newest.followers) : null,
      followersDelta: newest?.followersDelta != null ? Number(newest.followersDelta) : null,
      postCount: newest?.postCount ?? null,
      // Stored newest-first for the "latest" lookup; charts read left→right.
      history: [...r.samples].reverse().map(s => ({
        at: s.sampledAt.toISOString(),
        followers: Number(s.followers),
      })),
      latestPost: post
        ? {
            id: post.id,
            externalId: post.externalId,
            postedAt: post.postedAt?.toISOString() ?? null,
            caption: post.caption,
            permalink: post.permalink,
            likes: Number(post.likes),
            views: Number(post.views),
            commentCount: post.commentCount,
            commentsFetchedAt: post.commentsFetchedAt?.toISOString() ?? null,
            commentsLoaded: post._count.comments,
          }
        : null,
    };
  });
}

export interface AddAccountInput {
  brandId: string;
  platform: SocialPlatform;
  handle: string;
  isOwn: boolean;
  competitorName?: string | null;
}

export async function addAccount(input: AddAccountInput) {
  const handle = normalizeHandle(input.handle, input.platform);
  return prisma.socialAccount.upsert({
    where: {
      brandId_platform_handle: {
        brandId: input.brandId, platform: input.platform, handle,
      },
    },
    // Re-adding a previously removed account revives it rather than erroring,
    // and keeps its history.
    update: { active: true, isOwn: input.isOwn, competitorName: input.competitorName ?? null },
    create: {
      brandId: input.brandId,
      platform: input.platform,
      handle,
      isOwn: input.isOwn,
      competitorName: input.competitorName ?? null,
    },
  });
}

/** Bring an archived channel back. The counterpart to removeAccount, without
 *  which a removal is effectively permanent from the UI's point of view. */
export async function restoreAccount(brandId: string, accountId: string) {
  const existing = await prisma.socialAccount.findUnique({ where: { id: accountId } });
  if (!existing || existing.brandId !== brandId) return null; // cross-tenant guard
  return prisma.socialAccount.update({ where: { id: accountId }, data: { active: true } });
}

/** Soft-delete: keeps the sample history so re-adding restores the chart. */
export async function removeAccount(brandId: string, accountId: string) {
  const existing = await prisma.socialAccount.findUnique({ where: { id: accountId } });
  if (!existing || existing.brandId !== brandId) return null; // cross-tenant guard
  return prisma.socialAccount.update({ where: { id: accountId }, data: { active: false } });
}

/** Strip the decoration people paste — @, full URLs, trailing slashes. */
export function normalizeHandle(raw: string, platform: SocialPlatform): string {
  let h = raw.trim();

  if (/^https?:\/\//i.test(h)) {
    try {
      const u = new URL(h);
      // YouTube channel URLs keep their @handle or /channel/<id> segment.
      const parts = u.pathname.split('/').filter(Boolean);
      h = platform === 'youtube' && parts[0] === 'channel' ? parts[1] ?? '' : parts[0] ?? '';
    } catch { /* fall through with the raw string */ }
  }

  h = h.replace(/^@/, '').replace(/\/+$/, '');
  return h;
}

/** Comments for one post, newest first. */
export async function listComments(brandId: string, postId: string, limit = 100) {
  const post = await prisma.socialPost.findUnique({
    where: { id: postId },
    include: { account: { select: { brandId: true } } },
  });
  if (!post || post.account.brandId !== brandId) return null; // cross-tenant guard

  const rows = await prisma.socialComment.findMany({
    where: { postId },
    orderBy: [{ likes: 'desc' }, { postedAt: 'desc' }],
    take: limit,
  });
  return rows.map(c => ({
    id: c.id,
    author: c.author,
    text: c.text,
    likes: c.likes,
    postedAt: c.postedAt?.toISOString() ?? null,
    sentiment: c.sentiment,
  }));
}
