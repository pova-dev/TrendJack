// Watchlist API — derives the unified WatchTerm[] from a BrandProfile.
//
// During the Phase-5 migration we read from existing BrandProfile fields
// (brandKeywords / competitors / safeThemes / tone.bannedPhrases /
// bannedTopics). This is the SHIM. When the watchlist editor lands as
// the canonical source of truth, this function will instead read from
// a watch_term Prisma table and the brand fields become derived views.
//
// The interface stays stable across the migration — callers continue
// to use deriveFromWatchlist() / loadWatchlist() unchanged.

import type { BrandProfile } from '@/types';
import type { WatchTerm } from './types';
export type { WatchTerm, WatchTermKind, DerivedQueryLists } from './types';
export { deriveFromWatchlist } from './types';

/**
 * Build the WatchTerm[] view of a brand. Idempotent — same brand input
 * produces the same output. Term ids are deterministic so they're stable
 * across reads (useful for diff-based UI).
 */
export function watchlistFromBrand(b: BrandProfile): WatchTerm[] {
  const terms: WatchTerm[] = [];
  const now = new Date();

  for (const kw of b.brandKeywords ?? []) {
    if (!kw?.trim()) continue;
    terms.push({
      id: `brand:${kw.toLowerCase()}`,
      brandId: b.id,
      kind: 'brand',
      term: kw,
      weight: 5,
      createdAt: now,
    });
  }
  for (const c of b.competitors ?? []) {
    if (!c?.trim()) continue;
    terms.push({
      id: `competitor:${c.toLowerCase()}`,
      brandId: b.id,
      kind: 'competitor',
      term: c,
      weight: 3,
      createdAt: now,
    });
  }
  for (const t of b.safeThemes ?? []) {
    if (!t?.trim()) continue;
    terms.push({
      id: `theme:${t.toLowerCase()}`,
      brandId: b.id,
      kind: 'theme',
      term: t,
      weight: 2,
      createdAt: now,
    });
  }
  for (const p of b.tone.bannedPhrases ?? []) {
    if (!p?.trim()) continue;
    terms.push({
      id: `banned:phrase:${p.toLowerCase()}`,
      brandId: b.id,
      kind: 'banned',
      term: p,
      weight: 5,
      createdAt: now,
    });
  }
  for (const t of b.bannedTopics ?? []) {
    if (!t?.trim()) continue;
    terms.push({
      id: `banned:topic:${t.toLowerCase()}`,
      brandId: b.id,
      kind: 'banned',
      term: t,
      weight: 5,
      createdAt: now,
    });
  }
  return terms;
}

/**
 * Group a WatchTerm[] by kind for UI rendering. Returns an object
 * keyed by kind, each value an array of terms sorted by weight DESC.
 */
export function groupByKind(terms: WatchTerm[]): Record<string, WatchTerm[]> {
  const out: Record<string, WatchTerm[]> = {
    brand: [], competitor: [], theme: [], account: [], hashtag: [], banned: [],
  };
  for (const t of terms) {
    (out[t.kind] ?? (out[t.kind] = [])).push(t);
  }
  for (const list of Object.values(out)) {
    list.sort((a, b) => b.weight - a.weight);
  }
  return out;
}
