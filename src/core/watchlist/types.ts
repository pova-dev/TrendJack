// Operator-curated watchlist — the unified abstraction over
// brandKeywords, competitors, themes, and accounts-to-watch.
//
// Today these live as four separate fields on BrandProfile. The
// Watchlist model unifies them so the operator edits one taxonomy and
// every connector / agent reads from the same source of truth.
//
// Migration path: BrandProfile keeps brandKeywords / competitors /
// safeThemes for backward compatibility, but new code should derive
// them from this Watchlist model. Phase 5 ships the editor; subsequent
// connectors switch to reading watchlist directly.

import type { SourceId } from '@/types';

export type WatchTermKind =
  /** Specific brand / product / service mentions. Tier-1 priority — these
   *  drive Brand Matches. Examples: "pova", "tecno pova", "pova curve". */
  | 'brand'
  /** Competitor names. Tier-2 priority — these drive Competitor Activity. */
  | 'competitor'
  /** Broader category themes. Tier-3 priority — these drive Rising Trends
   *  and broaden the soft-anchor topical-fit. Example: "battery life". */
  | 'theme'
  /** Specific accounts to watch (X handles, Reddit users, YouTube channels). */
  | 'account'
  /** Hashtags to track verbatim. */
  | 'hashtag'
  /** Phrases to actively avoid (banned topics that override brand-fit). */
  | 'banned';

export interface WatchTerm {
  /** Unique id within the brand. */
  id: string;
  brandId: string;
  kind: WatchTermKind;
  /** The literal term to search for. Case-insensitive at match time. */
  term: string;
  /** Per-source restriction — if set, this term only matches signals from
   *  these sources. Useful for account watches ("@elonmusk" only on x). */
  sources?: SourceId[];
  /** Operator-set weight 1..5. Higher = more important. Used for tiebreaking
   *  + for the Architect to budget more API calls toward higher-weight terms. */
  weight: number;
  /** When the operator added this term — used for staleness detection. */
  createdAt: Date;
  /** Last time this term produced an actionable signal. Used for "your
   *  watchlist has dead terms" hints in the editor. */
  lastHitAt?: Date;
}

/** Convenience derivations — what each connector type expects to receive. */
export interface DerivedQueryLists {
  brandKeywords: string[];
  competitors: string[];
  themes: string[];
  accounts: string[];
  hashtags: string[];
  banned: string[];
}

export function deriveFromWatchlist(terms: WatchTerm[]): DerivedQueryLists {
  const out: DerivedQueryLists = {
    brandKeywords: [], competitors: [], themes: [],
    accounts: [], hashtags: [], banned: [],
  };
  for (const t of terms) {
    switch (t.kind) {
      case 'brand':      out.brandKeywords.push(t.term); break;
      case 'competitor': out.competitors.push(t.term);   break;
      case 'theme':      out.themes.push(t.term);        break;
      case 'account':    out.accounts.push(t.term);      break;
      case 'hashtag':    out.hashtags.push(t.term);      break;
      case 'banned':     out.banned.push(t.term);        break;
    }
  }
  return out;
}
