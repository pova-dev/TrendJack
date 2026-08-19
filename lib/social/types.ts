// Social Channel Analytics — provider contract.
//
// One interface, three implementations, chosen per account:
//
//   meta-graph    → POVA's own Instagram + Facebook. Free, exact, and the
//                   only source for owned-account metrics like reach.
//   youtube-api   → YouTube for ANY channel. The official Data API v3 is
//                   free (10k units/day) and returns subscribers, views,
//                   likes and comments, so Apify is never worth paying for
//                   here — not for us, not for competitors.
//   apify         → competitor Instagram + Facebook. The only way to read
//                   a page you don't own. Billed per result, so the poller
//                   keeps counters (cheap) separate from comments (dear).
//
// Every provider returns these normalized shapes. The store never sees a
// platform-specific payload, which is what lets a different Apify actor be
// swapped in by editing one mapper instead of the pipeline.
//
// CLAUDE.md hard-rule 1 applies throughout: a metric the platform does not
// expose is `0`, and the UI renders an em-dash. Instagram reports no view
// count on static image posts — that is a 0, never an estimate.

export type SocialPlatform = 'instagram' | 'facebook' | 'youtube';

/** Account-level counters. The 15-minute fast lane. */
export interface ProfileSnapshot {
  handle: string;
  displayName?: string;
  profileUrl?: string;
  avatarUrl?: string;
  /** Followers, or subscribers on YouTube. */
  followers: number;
  /** Total posts/videos published. Undefined when the platform is silent. */
  postCount?: number;
}

/** A single post/video and its engagement counters. */
export interface PostSnapshot {
  externalId: string;
  postedAt?: Date;
  caption?: string;
  mediaUrl?: string;
  permalink?: string;
  likes: number;
  /** 0 when the platform exposes no view count → rendered '—'. */
  views: number;
  commentCount: number;
}

/** One comment. Fetched on demand only. */
export interface CommentSnapshot {
  externalId: string;
  author?: string;
  text: string;
  likes: number;
  postedAt?: Date;
}

/** Counters + latest post, returned by a single fast-lane poll. */
export interface ProfileResult {
  profile: ProfileSnapshot;
  /** The account's most recent post, when the provider returns it cheaply. */
  latestPost?: PostSnapshot;
}

export interface SocialProviderContext {
  /** Per-org credential bag (APIFY_TOKEN, META_ACCESS_TOKEN, YOUTUBE_API_KEY…). */
  credentials: Record<string, string>;
}

/** Thrown for a provider-level failure the operator can act on. The message
 *  is surfaced verbatim on the account card, so it must read like advice
 *  rather than a stack trace. */
export class SocialProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    /** True when retrying later could plausibly succeed (rate limit, 5xx). */
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'SocialProviderError';
  }
}

export interface SocialProvider {
  /** Stable id: 'apify:instagram', 'meta-graph:facebook', 'youtube-api'. */
  id: string;
  platform: SocialPlatform;
  /** Can it read accounts we own? (official APIs can; scrapers also can) */
  supportsOwn: boolean;
  /** Can it read accounts we DON'T own? (Graph API cannot, meaningfully) */
  supportsCompetitor: boolean;
  /** Credential keys that must be present before this provider is usable. */
  requires: string[];

  /** Fast lane: counters + latest post. Called every cadence tick. */
  fetchProfile(handle: string, ctx: SocialProviderContext): Promise<ProfileResult>;

  /** Slow lane: comment text for one post. Called on demand only.
   *
   *  Optional, because it is not universally available: several Apify actors
   *  return a comment COUNT but no comment bodies. A provider without this
   *  reports `commentCount` and the UI offers no "load comments" action,
   *  rather than showing a button that can only fail. */
  fetchComments?(
    post: { externalId: string; permalink?: string },
    ctx: SocialProviderContext,
    limit: number,
  ): Promise<CommentSnapshot[]>;

  /** Deep metrics for one already-known post URL.
   *
   *  Separate from fetchProfile because these actors are addressed by POST
   *  URL, not by handle — they can enrich a post we already discovered but
   *  cannot find posts on their own. */
  fetchPostMetrics?(url: string, ctx: SocialProviderContext): Promise<PostSnapshot>;
}

/** Is every required credential present? Used to render "needs setup" in the
 *  UI instead of letting a poll fail with an opaque auth error. */
export function providerReady(p: SocialProvider, creds: Record<string, string>): boolean {
  return p.requires.every(k => !!creds[k]?.trim());
}
