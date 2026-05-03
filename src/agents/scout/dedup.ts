// Content-level deduplication for the Scout pipeline.
//
// The existing externalId-based dedup (e.g. `reddit:${postId}`) only catches
// duplicates of the EXACT same post on the EXACT same platform. It misses:
//
//   - Cross-posts: r/TECNOphone post + r/Android post about the same review
//   - Copy-paste reposts: u/UserA's post and u/UserB's post sharing the
//     same title and URL
//   - Same article surfacing from different connectors: Google News and
//     HackerNews both pulling the same TechCrunch URL
//
// We add a content fingerprint that's stable across all of those. Two
// signals are considered duplicates if they share:
//   - Normalized title (lowercase, alphanumeric only) AND
//   - Same source kind OR the same canonical URL
//
// The earliest one wins (its `firstSeenAt` is preserved). Later duplicates
// contribute their velocity and lineage to the canonical signal.

import type { RawSignal } from '@/src/core/scoring/types';

/**
 * Compute a content fingerprint suitable for dedup. Stable across casing,
 * punctuation, leading/trailing whitespace, and the all-too-common trailing
 * source-pill ("- The Verge", "- HotHardware").
 *
 * Examples:
 *   "POVA Curve 2 Battery Life is Insane.✨"          → "povacurve2batterylifeisinsane"
 *   "POVA Curve 2 Battery Life is Insane - The Verge" → "povacurve2batterylifeisinsane"
 *   "POVA curve 2 battery life is insane!"             → "povacurve2batterylifeisinsane"
 */
export function contentFingerprint(s: { title: string }): string {
  return s.title
    // Strip trailing source-pill — "- The Verge", "- HotHardware.com",
    // "— MSN". Conservative: only strip if the trailer is short (≤25 chars)
    // and looks publication-like (Title-Case words, ends near string end).
    .replace(/\s*[-–—]\s*([A-Z][A-Za-z0-9.]*(?:\s+[A-Z][A-Za-z0-9.]*){0,3})\s*$/, '')
    .toLowerCase()
    // Strip Unicode emoji (single chars + ZWJ sequences).
    .replace(/\p{Extended_Pictographic}/gu, '')
    // Keep only alphanumerics — punctuation, spaces, hyphens stripped.
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 120);
}

/**
 * Stable dedup key. Two signals collide iff they have the same fingerprint
 * AND (same source OR same canonical URL).
 *
 * Same-source rule: catches cross-posts within Reddit (different post IDs,
 * same title) without conflating "Reddit thread about iQOO" with "News
 * article about iQOO" — those are legitimately different signals.
 *
 * URL rule: catches cross-connector duplicates of the same canonical
 * article (Google News + HackerNews both surfacing TechCrunch.com/...).
 */
export function dedupKey(s: RawSignal): string {
  const fp = contentFingerprint(s);
  const url = canonicalizeUrl(s.url);
  return url ? `url:${url}` : `${s.source}:${fp}`;
}

/** Strip query strings, trailing slashes, and protocol from URLs to make
 *  cross-source matching of "the same article" reliable. Returns null if
 *  the URL is missing or malformed. */
export function canonicalizeUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return (u.host + u.pathname).toLowerCase().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/**
 * Reduce a flat list of RawSignals to a deduplicated list. When duplicates
 * are found, the earliest-published signal wins; later duplicates merge
 * their velocity (max) and lineage (concatenated) into it.
 *
 * This is idempotent: dedup(dedup(x)) === dedup(x).
 */
export function dedupSignals(signals: RawSignal[]): RawSignal[] {
  const byKey = new Map<string, RawSignal>();

  for (const sig of signals) {
    const key = dedupKey(sig);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, sig);
      continue;
    }

    // Earliest publication wins as the canonical signal.
    const earlier = existing.firstSeenAt <= sig.firstSeenAt ? existing : sig;
    const later   = existing.firstSeenAt <= sig.firstSeenAt ? sig : existing;

    // Merge: max velocity (the duplicate is more recent → likely higher
    // velocity), max reach, max competitor claimants, joined lineage.
    const merged: RawSignal = {
      ...earlier,
      velocity: Math.max(earlier.velocity, later.velocity),
      reach:    Math.max(earlier.reach,    later.reach),
      lineage:  earlier.lineage === later.lineage
        ? earlier.lineage
        : `${earlier.lineage} · also seen: ${later.lineage}`,
      competitorClaimants: dedupStrings([
        ...earlier.competitorClaimants,
        ...later.competitorClaimants,
      ]),
    };
    byKey.set(key, merged);
  }

  return Array.from(byKey.values());
}

function dedupStrings(arr: string[]): string[] {
  return Array.from(new Set(arr));
}
