// Three-tier anchored topical-fit. Drives both the brandFit composite and
// the Brand Matches column filter via the brandKeywordHit flag.
//
// Priority order:
//   1. BRAND KEYWORD hit  — trend mentions our brand or product name
//                            ("pova", "tecno pova", "pova curve").
//                            Highest topicalFit + flags brandKeywordHit
//                            so the Brand Matches column filter picks it.
//
//   2. COMPETITOR mention — trend names a competitor.
//                            Moderate topicalFit (so we score it as
//                            on-topic for Competitor Activity / Rising)
//                            but explicitly NOT a Brand Match.
//
//   3. SOFT ANCHOR + theme — generic tech/phone vocabulary plus a
//                            safeTheme keyword hit. Moderate fit,
//                            peripheral awareness.
//
// Single keyword hits without any anchor get a small floor (peripheral
// tangent) and won't satisfy the Brand Matches threshold.

import type { BrandProfile, RawSignal, ScoreRationale, TopicalFitResult } from './types';
import { matchKeyword } from './matchers';
import { clamp01, pushRationale, round } from './helpers';

export function computeTopicalFitDetailed(
  s: RawSignal,
  b: BrandProfile,
  r: ScoreRationale[],
): TopicalFitResult {
  const haystack = (
    s.title + ' ' + s.summary + ' ' + (s.text ?? '') + ' ' + s.hashtags.join(' ')
  ).toLowerCase();

  // Banned topic = always 0, no exceptions.
  const banHit = b.bannedTopics.some(t => haystack.includes(t.toLowerCase()));
  if (banHit) {
    pushRationale(r, 'topicalFit', 0, ['⚠ banned topic detected — topicalFit forced to 0']);
    return { value: 0, brandKeywordHit: false, matchedBrandKeywords: [] };
  }

  // 1. Brand keyword hits. Word-boundary check — "pova" doesn't match
  //    "innovation" but still picks up "pova 7", "pova-curve".
  const brandKeywords = (b.brandKeywords ?? [])
    .filter(k => k.trim().length >= 2)
    .map(k => k.trim().toLowerCase());
  const matchedBrandKeywords = brandKeywords.filter(k => matchKeyword(haystack, k));
  const hasBrandKeyword = matchedBrandKeywords.length > 0;

  // 2. Competitor mention (excluding any term that's also a brand keyword
  //    so things like "tecno" don't collide if both are listed).
  const competitorMatches = b.competitors
    .map(c => c.trim().toLowerCase())
    .filter(c => c.length >= 2 && !brandKeywords.includes(c) && matchKeyword(haystack, c));
  const hasCompetitor = competitorMatches.length > 0;

  // 3. Soft anchor — derived FROM the brand's category, not hardcoded.
  // Earlier this was hardcoded to a smartphone vocabulary plus optional
  // category words, which made every gaming-phone trend hit the soft-
  // anchor for unrelated brands (footwear, finance, etc.) — a major
  // cross-category hallucination source surfaced by the Trinity Swarm
  // Solera audit. Now we only widen to the smartphone preset when the
  // brand's category text actually mentions tech/phone/mobile/electronics.
  const categoryWords = b.category.toLowerCase()
    .split(/[\s,/&-]+/)
    .filter(w => w.length >= 4);
  const isTechBrand = /\b(phone|smartphone|mobile|electronics?|tech|device|gadget|consumer\s*tech)\b/i.test(b.category);
  const softAnchorVocab = new Set<string>([
    ...categoryWords,
    ...(isTechBrand
      ? ['phone', 'phones', 'smartphone', 'smartphones', 'mobile', 'handset',
         'android', 'ios', 'iphone', 'flagship', 'oled', 'amoled', '5g']
      : []),
  ]);
  const hasSoftAnchor = softAnchorVocab.size > 0
    && [...softAnchorVocab].some(a => haystack.includes(a));

  // Theme hits — brand.safeThemes (battery, gaming, …).
  const themeMatches = b.safeThemes.filter(t => haystack.includes(t.toLowerCase()));
  const themeHits = themeMatches.length;

  let v: number;
  let reason: string;

  if (hasBrandKeyword) {
    // Trend names the brand or our product — Brand Match territory.
    v = clamp01(0.85 + Math.min(0.15, 0.05 * themeHits));
    reason = `brand keyword(s) hit: ${matchedBrandKeywords.slice(0, 3).join(', ')}`;
  } else if (hasCompetitor) {
    // Competitor only — relevant for Competitor Activity / Rising, but
    // NOT Brand Matches. Capped at 0.55 so it never qualifies as one.
    v = clamp01(0.45 + Math.min(0.10, 0.05 * themeHits));
    reason = `competitor mention only: ${competitorMatches.slice(0, 2).join(', ')} (NOT a Brand Match)`;
  } else if (hasSoftAnchor && themeHits >= 1) {
    v = clamp01(0.35 + Math.min(0.20, 0.08 * themeHits));
    reason = `tech/phone context + ${themeHits} theme hit(s)`;
  } else if (hasSoftAnchor) {
    v = 0.20;
    reason = 'tech/phone context, no theme hit';
  } else if (themeHits >= 2) {
    v = 0.20 + 0.04 * (themeHits - 2);
    reason = `${themeHits} theme hits but no category anchor — likely tangential`;
  } else if (themeHits === 1) {
    v = 0.08;
    reason = `1 keyword match (${themeMatches[0]}) but no anchor — likely false positive`;
  } else if (s.source === 'google_trends') {
    // Peripheral-awareness floor for gtrends. The operator configured
    // gtrends ingestion knowing items would lack brand-keyword anchor.
    // Treat as low-but-not-rejected so it still surfaces in
    // observerOnly columns + Trending Now.
    v = 0.10;
    reason = 'peripheral gtrends item — no brand anchor (expected for general trending)';
  } else {
    v = 0.05;
    reason = 'no theme or anchor';
  }

  pushRationale(r, 'topicalFit', v, [
    reason,
    hasBrandKeyword ? `BRAND keywords: ${matchedBrandKeywords.join(', ')}` : 'no brand-keyword hit',
    hasCompetitor   ? `competitors: ${competitorMatches.join(', ')}`         : 'no competitor mention',
    `themes: ${themeMatches.join(', ') || '—'}`,
  ]);
  return {
    value: round(v),
    brandKeywordHit: hasBrandKeyword,
    matchedBrandKeywords,
  };
}

// Backwards-compat shim — older callers expect a plain number.
export function computeTopicalFit(
  s: RawSignal,
  b: BrandProfile,
  r: ScoreRationale[],
): number {
  return computeTopicalFitDetailed(s, b, r).value;
}
