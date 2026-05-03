// Cringe axis. Brand-voice safety belt. Spreads 0.05 → 1.0 across real-world
// trends instead of clustering at the floor. Seven detection tiers:
//   1. brand-specific banned phrases (heaviest weight)
//   2. cliché triggers ("unleash", "level up", etc.) — graded
//   3. ad-speak markers ("disrupt", "redefine", "reimagined")
//   4. hype clickbait adjectives ("wild", "stunning", "premium", "iconic")
//   5. forced-slang (rizz / pov / main-character)
//   6. exclamation density / emoji clusters / ALL-CAPS density
//
// Each vocabulary is exported so tests can introspect, and so future tooling
// can let operators see "your trend hit ad-speak: 'redefining'".

import type { BrandProfile, RawSignal, ScoreRationale } from './types';
import { matchStem } from './matchers';
import { clamp01, pushRationale, round } from './helpers';
import { detectForbiddenStyles } from './forbidden-styles';

export const CLICHE_STEMS = [
  'unleash', 'limitless', 'dream big', 'best version', 'level up',
  'crushing it', 'work hard play hard', 'live your best life', 'living your best life',
  'main character', 'manifest', 'lock in',
  'no cap', 'lowkey', 'highkey', 'vibes only',
];

export const AD_SPEAK_STEMS = [
  'disrupt', 'redefin', 'reimagin', 'game changer', 'world-class',
  'world class', 'next-level', 'next level', 'paradigm', 'thought leader',
  'synerg', 'leverag', 'best-in-class', 'cutting-edge', 'cutting edge',
  'state-of-the-art', 'state of the art', 'revolutionar', 'transformat',
  'innovativ', 'pioneer', 'unparallel', 'industry-first', 'industry first',
  'seamless', 'frictionless', 'turnkey', 'holistic', 'curated experience',
];

export const HYPE_STEMS = [
  'wild', 'insane', 'crazy', 'stunning', 'shocking', 'jaw-dropping',
  'jaw dropping', 'mind-blowing', 'mind blowing', 'breathtaking',
  'breakthrough', 'blazing', 'lavish', 'gorgeous', 'epic', 'absurd',
  'ludicrous', 'monstrous', 'beast', 'beastly', 'whopping',
  'mega', 'ultra', 'super', 'massive', 'huge', 'biggest', 'fastest',
  'sleek', 'sleekest', 'thinnest', 'lightest', 'most powerful', 'most advanced',
  'unbelievable', 'incredible', 'amazing', 'astonishing', 'remarkabl',
  'won\'t believe', 'wont believe', 'you need to know',
  // phone / consumer-tech marketing adjectives
  'fashionable', 'stylish', 'elegant', 'premium', 'iconic', 'flagship',
  'powerhouse', 'must-have', 'must have', 'finally', 'finally arrived',
  'official', 'officially', 'exclusive', 'limited edition',
];

export const FORCED_SLANG_TRIGGERS = [
  'rizz up the world', 'how do you do fellow kids', 'we listen we don',
  'rizzler', 'gyatt', 'sigma grindset', 'on god fr', 'sheeshhh',
  'pov:', 'literally me', 'no thoughts head empty', 'fr fr', 'bussin',
];

export function computeCringe(s: RawSignal, b: BrandProfile, r: ScoreRationale[]): number {
  const blob = (s.title + ' ' + s.summary + ' ' + (s.text ?? '')).toLowerCase();
  const reasons: string[] = [];
  let v = 0.05; // base — neutral content reads slightly above zero

  // 1. Brand-banned phrases hurt the most — ~30% per hit. These are the
  //    user-curated landmines that should never make it to draft.
  const bannedHits = b.tone.bannedPhrases.filter(p => blob.includes(p.toLowerCase()));
  if (bannedHits.length) {
    v += 0.30 * bannedHits.length;
    reasons.push(`brand-banned phrase${bannedHits.length > 1 ? 's' : ''}: ${bannedHits.slice(0, 3).join(', ')}`);
  }

  // 2. Universal cliché triggers — stem-matched so "unleashing" / "leveling up"
  //    / "manifested" all hit. 0.16 each, plateaus at ~3.
  const clicheHits = CLICHE_STEMS.filter(c => matchStem(blob, c));
  if (clicheHits.length) {
    v += Math.min(0.45, 0.16 * clicheHits.length);
    reasons.push(`cliché trigger${clicheHits.length > 1 ? 's' : ''}: ${clicheHits.slice(0, 3).join(', ')}`);
  }

  // 3. Ad-speak — corporate buzzwords that read like a PR release.
  const adSpeakHits = AD_SPEAK_STEMS.filter(c => matchStem(blob, c));
  if (adSpeakHits.length) {
    v += Math.min(0.32, 0.10 * adSpeakHits.length);
    reasons.push(`ad-speak: ${adSpeakHits.slice(0, 3).join(', ')}`);
  }

  // 4. Hype / clickbait adjectives — dominate tech-news headlines and are
  //    the actual cringe vector for most signal we ingest. Lower per-hit
  //    weight (0.06) but very common, so they create real spread across
  //    the distribution instead of clustering at the floor.
  const hypeHits = HYPE_STEMS.filter(c => matchStem(blob, c));
  if (hypeHits.length) {
    v += Math.min(0.30, 0.06 * hypeHits.length);
    reasons.push(`hype adjective${hypeHits.length > 1 ? 's' : ''}: ${hypeHits.slice(0, 3).join(', ')}`);
  }

  // 5. Forced slang — when older brands try to talk like teens. Heavier
  //    weight because the failure mode is so visible. Substring match
  //    (not stem) because these are multi-word phrases.
  const slangHits = FORCED_SLANG_TRIGGERS.filter(c => blob.includes(c));
  if (slangHits.length) {
    v += 0.25 * slangHits.length;
    reasons.push(`forced slang: ${slangHits.slice(0, 2).join(', ')}`);
  }

  // 5b. Brand-curated forbidden styles. Each style on the brand's
  //     `tone.forbiddenStyles` list maps to a vocabulary in
  //     forbidden-styles.ts. A doom-messaging-banned brand sees its
  //     cringe lift on apocalyptic news; a lifestyle-warmth-banned
  //     luxury brand sees it lift on "cozy magical journey" copy.
  //     +0.20 per style hit, capped at +0.40.
  const forbiddenHits = detectForbiddenStyles(blob, b.tone.forbiddenStyles ?? []);
  if (forbiddenHits.length) {
    v += Math.min(0.40, 0.20 * forbiddenHits.length);
    reasons.push(`brand-forbidden style${forbiddenHits.length > 1 ? 's' : ''}: ${forbiddenHits.join(', ')}`);
  }

  // 6a. Exclamation density — !!!!! reads desperate. Use original-case text.
  const original = s.title + ' ' + s.summary;
  const bangs = (original.match(/!/g) ?? []).length;
  if (bangs >= 3) { v += 0.15; reasons.push(`${bangs} exclamation marks`); }
  else if (bangs === 2) { v += 0.08; }

  // 6b. Emoji clusters — 3+ adjacent emoji reads like a Linkedin influencer post.
  const emojiCluster = /(\p{Extended_Pictographic}‍?){3,}/u;
  if (emojiCluster.test(original)) {
    v += 0.18;
    reasons.push('emoji cluster (3+ adjacent)');
  }

  // 6c. ALL-CAPS density on long-enough titles. Headlines with >55% caps
  //     (excluding acronyms / source pills) read shouty.
  if (s.title.length > 40) {
    const letters = s.title.replace(/[^A-Za-z]/g, '');
    if (letters.length > 20) {
      const caps = letters.replace(/[^A-Z]/g, '').length;
      const ratio = caps / letters.length;
      if (ratio > 0.55) { v += 0.15; reasons.push(`${Math.round(ratio * 100)}% caps`); }
      else if (ratio > 0.35) { v += 0.07; }
    }
  }

  v = clamp01(v);
  if (reasons.length === 0) reasons.push('clean — no cringe markers detected');
  pushRationale(r, 'cringe', v, [
    v > 0.7 ? `HIGH cringe — multiple markers, would fail brand-voice review` :
    v > 0.4 ? `moderate cringe — rewrite required before shipping` :
    v > 0.2 ? `low cringe — minor cleanup likely` :
              `clean tone`,
    ...reasons,
  ]);
  return round(v);
}
