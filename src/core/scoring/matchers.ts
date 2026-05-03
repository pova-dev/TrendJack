// Word-aware text matchers used by every scoring axis.
//
// Two flavors:
//   matchKeyword — exact token match with word boundaries.
//                  "pova" matches "pova", "pova 7", "POVA-curve",
//                  "tecno pova"; does NOT match "innovation" or
//                  "spovapocalypse".
//
//   matchStem    — prefix match with word boundaries.
//                  Stem "redefin" matches "redefine", "redefining",
//                  "redefined", "redefines"; does NOT match "predefined"
//                  (leading boundary check).
//
// Both are ASCII-letter-aware (a-z, 0-9). Non-ASCII scripts like Hindi or
// Arabic fall back to permissive substring matching, which is fine — those
// scripts don't have the prefix/suffix edge cases that broke the old
// `String.includes()` approach for English content.

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchKeyword(haystack: string, keyword: string): boolean {
  const k = keyword.toLowerCase();
  const re = new RegExp('(?:^|[^a-z0-9])' + escapeRegex(k) + '(?:$|[^a-z0-9])', 'i');
  return re.test(haystack);
}

export function matchStem(haystack: string, stem: string): boolean {
  const re = new RegExp(
    '(?:^|[^a-z0-9])' + escapeRegex(stem.toLowerCase()) + '[a-z]*(?:$|[^a-z0-9])',
    'i',
  );
  return re.test(haystack);
}

// Exported for advanced callers (and for tests that want to verify regex
// safety on operator-curated keyword lists with special characters).
export { escapeRegex };
