// Tonal-fit + audience-overlap.
//
// Two cousins of brand-fit that look at *how* the trend reads vs the brand
// voice (tonal) and *who* it reaches vs the brand audience (audience).
// Both feed into the brandFit composite (50% topical + 30% tonal + 20% audience).

import type { BrandProfile, RawSignal, ScoreRationale } from './types';
import { clamp01, pushRationale, round } from './helpers';
import { detectForbiddenStyles } from './forbidden-styles';

export function computeTonalFit(s: RawSignal, b: BrandProfile, r: ScoreRationale[]): number {
  const blob = (s.title + ' ' + s.summary + ' ' + (s.text ?? '')).toLowerCase();
  const hitsBanned = b.tone.bannedPhrases.filter(p => blob.includes(p.toLowerCase()));
  const allowedJokesPresent = b.tone.allowedJokes.filter(j => blob.includes(j.toLowerCase()));
  let v = 0.55; // neutral default
  if (allowedJokesPresent.length) v += 0.15 * Math.min(allowedJokesPresent.length, 2);
  if (hitsBanned.length) v -= 0.2 * Math.min(hitsBanned.length, 3);
  // Lifestyle warmth and motivational clichés — POVA-style anti-pattern detector.
  // Note: these are universal cliches; brand-specific cliches go through
  // tone.bannedPhrases (above).
  const cliches = ['unleash', 'limitless', 'dream big', 'be the best version'];
  const clicheHits = cliches.filter(c => blob.includes(c)).length;
  if (clicheHits) v -= 0.25;
  // Brand-curated forbidden styles. Per-style vocabulary lookup in
  // forbidden-styles.ts. Drops fit by 0.15 per style hit (capped at 0.30).
  const forbiddenHits = detectForbiddenStyles(blob, b.tone.forbiddenStyles ?? []);
  if (forbiddenHits.length) {
    v -= Math.min(0.30, 0.15 * forbiddenHits.length);
  }
  v = clamp01(v);
  pushRationale(r, 'tonalFit', v, [
    hitsBanned.length ? `banned phrases: ${hitsBanned.join(', ')}` : 'no banned phrases',
    clicheHits ? `cliché triggers: ${clicheHits}` : 'no cliché triggers',
    forbiddenHits.length ? `forbidden styles hit: ${forbiddenHits.join(', ')}` : 'no forbidden styles',
  ]);
  return round(v);
}

export function computeAudienceOverlap(s: RawSignal, b: BrandProfile, r: ScoreRationale[]): number {
  // Without real demographic data on the trend, infer from hashtags and lineage.
  const blob = (s.hashtags.join(' ') + ' ' + s.lineage).toLowerCase();
  const segments = b.audience.primary.map(p => p.toLowerCase());
  const segHits = segments.filter(seg => blob.includes(seg.split(' ')[0])).length;
  const psychos = b.audience.psychographics.map(p => p.toLowerCase());
  const psyHits = psychos.filter(p => blob.includes(p.split(' ')[0])).length;
  const v = clamp01(0.35 + 0.15 * segHits + 0.1 * psyHits);
  pushRationale(r, 'audienceOverlap', v, [
    `primary-segment matches: ${segHits}`,
    `psychographic matches: ${psyHits}`,
  ]);
  return round(v);
}
