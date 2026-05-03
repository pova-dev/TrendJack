// Risk axis. Spreads across 0..1 via five weighted vocabularies + sentiment +
// competitor-mention adjustment. Each vocab is exposed as a constant array so
// tests + future tooling can introspect the dictionary.

import type { BrandProfile, RawSignal, ScoreRationale } from './types';
import { matchStem } from './matchers';
import { clamp01, pushRationale, round } from './helpers';

// Crisis vocab — concrete bad-thing-happened markers. Stems so "lawsuit"
// matches "lawsuits", "fired" matches "fires"/"firing", etc.
export const CRISIS_STEMS = [
  'lawsuit', 'sue', 'sued', 'sues', 'suing',
  'arrest', 'indict', 'fraud', 'embezzl',
  'death', 'died', 'killed', 'fatal', 'casualt',
  'crash', 'collision', 'explosion', 'explod',
  'fire', 'resign', 'oust', 'step down', 'stepped down',
  'breach', 'hack', 'leak',
  'outage', 'crashed', 'fail',
  'recall', 'defect',
  'controvers', 'scandal', 'misconduct',
  'plunge', 'tank', 'slump', 'collaps',
  'probe', 'investigat', 'allegation', 'allege',
  'raid', 'sanction', 'penalt', 'fined',
  'shutdown', 'shut down', 'halt', 'banned',
  'strike', 'walkout', 'lockout',
];

// Controversy / cancellation — softer than crisis but still risky for
// brand association.
export const CONTROVERSY_STEMS = [
  'boycott', 'cancel', 'apolog',
  'backlash', 'outrage', 'protest', 'demand', 'criticis',
  'condemn', 'denounce', 'slam', 'slammed', 'slamming',
  'feud', 'spat', 'rift', 'clash', 'dispute', 'tension',
];

// Inflammatory political/social vocab — even without exact banned-topic
// match, these words signal the trend is polarized.
export const INFLAMMATORY_STEMS = [
  'riot', 'violen', 'extremis', 'terror', 'radical', 'militia',
  'communal', 'sectarian', 'genocide', 'ethnic cleansing',
  'war', 'attack', 'bomb', 'shoot', 'shot', 'stabbing',
  'hostage', 'kidnap', 'assault',
];

// Tabloid / hype-anxiety markers — softer signal but adds spread to
// otherwise-flat distributions.
export const ANXIETY_STEMS = [
  'shock', 'alarm', 'panic', 'fear', 'worri', 'crisis',
  'warning', 'warn', 'urgent', 'emergency',
];

export function computeRisk(s: RawSignal, b: BrandProfile, r: ScoreRationale[]): number {
  const blob = (s.title + ' ' + s.summary + ' ' + (s.text ?? '')).toLowerCase();
  let risk = 0.10; // baseline — most public news isn't risky
  const reasons: string[] = [];

  const bannedHits = b.bannedTopics.filter(t => blob.includes(t.toLowerCase()));
  if (bannedHits.length) {
    risk += 0.55;
    reasons.push(`banned topic: ${bannedHits.slice(0, 3).join(', ')}`);
  }

  const crisisHits = CRISIS_STEMS.filter(v => matchStem(blob, v));
  if (crisisHits.length) {
    risk += Math.min(0.45, 0.10 * crisisHits.length);
    reasons.push(`crisis: ${crisisHits.slice(0, 3).join(', ')}`);
  }

  const controversyHits = CONTROVERSY_STEMS.filter(v => matchStem(blob, v));
  if (controversyHits.length) {
    risk += Math.min(0.30, 0.08 * controversyHits.length);
    reasons.push(`controversy: ${controversyHits.slice(0, 3).join(', ')}`);
  }

  const inflammatoryHits = INFLAMMATORY_STEMS.filter(v => matchStem(blob, v));
  if (inflammatoryHits.length) {
    risk += Math.min(0.40, 0.18 * inflammatoryHits.length);
    reasons.push(`inflammatory: ${inflammatoryHits.slice(0, 2).join(', ')}`);
  }

  const anxietyHits = ANXIETY_STEMS.filter(v => matchStem(blob, v));
  if (anxietyHits.length) {
    risk += Math.min(0.18, 0.05 * anxietyHits.length);
    reasons.push(`anxiety vocab: ${anxietyHits.slice(0, 2).join(', ')}`);
  }

  // Sentiment skew (already proxied from the connector — most stay at 0).
  if (s.sentiment < -0.5) {
    risk += 0.20;
    reasons.push(`strongly negative sentiment (${s.sentiment.toFixed(2)})`);
  } else if (s.sentiment < -0.2) {
    risk += 0.10;
    reasons.push(`negative sentiment (${s.sentiment.toFixed(2)})`);
  }

  // Mentioning a competitor adds modest engagement risk only — not toxic.
  if (b.competitors.some(c => blob.includes(c.toLowerCase()))) {
    risk += 0.05;
  }

  const tolerance = { low: 1.20, medium: 1.0, high: 0.80 }[b.riskTolerance] ?? 1.0;
  const v = clamp01(risk * tolerance);
  pushRationale(r, 'risk', v, [
    reasons.length ? reasons.join(' · ') : 'no risk markers detected',
    `risk tolerance ${b.riskTolerance} → ×${tolerance}`,
  ]);
  return round(v);
}
