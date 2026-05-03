import type {
  BrandProfile,
  Recommendation,
  Scores,
  ScoreRationale,
  Trend,
  ScoringWeights,
} from '@/types';
import { DEFAULT_WEIGHTS } from '@/types';

// -----------------------------------------------------------------------------
// TrendJack scoring engine.
//
// Design principles:
//   1. Every score is in [0, 1] except `opportunity` which is 0..100 for UI.
//   2. Negative weights apply to risk/cringe/saturation/format-fatigue/effort.
//   3. Saturation uses a sigmoid penalty so that 0..0.6 is barely punished but
//      anything past 0.6 punishes hard. Real-world: half-saturated is still
//      winnable, fully-saturated is not.
//   4. "Hard kills" override the math: banned-topic hit, competitor-claimed,
//      cringeScore > 0.7, risk > 0.7. These force IGNORE regardless of upside.
//   5. Brand crisis mode floors recommendation to MONITOR globally.
//   6. Every axis carries plain-English reasons so the UI can explain itself.
// -----------------------------------------------------------------------------

export interface RawSignal {
  source: Trend['source'];
  title: string;
  summary: string;
  hashtags: string[];
  text?: string;            // representative post body for tonal/topical analysis
  lineage: string;
  catalyst?: string;
  firstSeenAt: Date;
  velocity: number;         // posts per hour or % delta
  reach: number;
  sentiment: number;        // -1..1
  competitorClaimants: string[];
  formatFatigue: number;    // 0..1; how exhausted is the format/template
  examples?: Trend['examples'];
  url?: string;             // canonical original post / article URL
  externalId?: string;      // dedupe key from the source platform
}

export interface ScoringContext {
  brand: BrandProfile;
  weights?: ScoringWeights;
  brandPostCountForTrend?: number; // how many times brand has already posted on this thread
}

export function score(signal: RawSignal, ctx: ScoringContext): {
  scores: Scores;
  rationale: ScoreRationale[];
  recommendation: Recommendation;
  recommendationReason: string;
  peakWindowEnd: Date;
  brandKeywordHit: boolean;
  matchedBrandKeywords: string[];
} {
  const weights = ctx.weights ?? ctx.brand.scoringWeights ?? DEFAULT_WEIGHTS;
  const rationale: ScoreRationale[] = [];

  const virality = computeVirality(signal, rationale);
  const topicalFitResult = computeTopicalFitDetailed(signal, ctx.brand, rationale);
  const topicalFit = topicalFitResult.value;
  const tonalFit = computeTonalFit(signal, ctx.brand, rationale);
  const audienceOverlap = computeAudienceOverlap(signal, ctx.brand, rationale);
  const brandFit = round(0.5 * topicalFit + 0.3 * tonalFit + 0.2 * audienceOverlap);
  pushRationale(rationale, 'brandFit', brandFit, [
    `topicalFit=${pct(topicalFit)} weighted 0.5`,
    `tonalFit=${pct(tonalFit)} weighted 0.3`,
    `audienceOverlap=${pct(audienceOverlap)} weighted 0.2`,
  ]);

  const peakWindowEnd = predictPeakWindowEnd(signal);
  const timing = computeTiming(signal, peakWindowEnd, rationale);
  const firstMover = computeFirstMover(ctx.brandPostCountForTrend ?? 0, rationale);
  const saturation = computeSaturation(signal, rationale);
  const risk = computeRisk(signal, ctx.brand, rationale);
  const cringe = computeCringe(signal, ctx.brand, rationale);
  const formatFatigue = clamp01(signal.formatFatigue);
  pushRationale(rationale, 'formatFatigue', formatFatigue, [
    formatFatigue > 0.7
      ? 'Format/template heavily reused in last 24h — originality risk.'
      : 'Format usage within healthy band.',
  ]);

  const assetEffort = estimateAssetEffort(signal, rationale);
  const approvalEffort = estimateApprovalEffort(ctx.brand, rationale);
  const productionEffort = estimateProductionEffort(signal, rationale);
  const effort = round(
    0.4 * assetEffort + 0.3 * approvalEffort + 0.3 * productionEffort,
  );
  pushRationale(rationale, 'effort', effort, [
    `asset=${pct(assetEffort)} · approval=${pct(approvalEffort)} · production=${pct(productionEffort)}`,
  ]);

  // Composite opportunity. Sigmoid-penalize saturation past 0.6.
  const saturationPenalty = sigmoid01(saturation, 0.6, 12);

  const raw =
    weights.virality * virality +
    weights.brandFit * brandFit +
    weights.timing * timing +
    weights.firstMover * firstMover -
    weights.saturation * saturationPenalty -
    weights.risk * risk -
    weights.cringe * cringe -
    weights.formatFatigue * formatFatigue -
    weights.effort * effort;

  const opportunity = Math.round(clamp01(raw) * 100);

  const scores: Scores = {
    virality, topicalFit, tonalFit, audienceOverlap, brandFit,
    timing, firstMover, saturation, risk, cringe, formatFatigue,
    assetEffort, approvalEffort, productionEffort, effort,
    opportunity,
  };

  const { recommendation, recommendationReason } = decide(
    scores,
    signal,
    ctx.brand,
  );

  return {
    scores, rationale, recommendation, recommendationReason, peakWindowEnd,
    brandKeywordHit: topicalFitResult.brandKeywordHit,
    matchedBrandKeywords: topicalFitResult.matchedBrandKeywords,
  };
}

// -----------------------------------------------------------------------------
// Per-axis computations
// -----------------------------------------------------------------------------

function computeVirality(s: RawSignal, r: ScoreRationale[]): number {
  // Velocity normalized to a soft cap; reach contributes diminishing returns.
  const vNorm = Math.tanh(s.velocity / 500);
  const rNorm = Math.tanh(s.reach / 5_000_000);
  const v = clamp01(0.7 * vNorm + 0.3 * rNorm);
  pushRationale(r, 'virality', v, [
    `velocity ≈ ${Math.round(s.velocity)}/h → ${pct(vNorm)}`,
    `reach ≈ ${formatBig(s.reach)} → ${pct(rNorm)}`,
  ]);
  return round(v);
}

interface TopicalFitResult {
  value: number;
  brandKeywordHit: boolean;
  matchedBrandKeywords: string[];
}

function computeTopicalFitDetailed(s: RawSignal, b: BrandProfile, r: ScoreRationale[]): TopicalFitResult {
  // Three-tier anchored topical-fit, in priority order:
  //
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

  const haystack = (s.title + ' ' + s.summary + ' ' + (s.text ?? '') + ' ' + s.hashtags.join(' ')).toLowerCase();

  // Banned topic = always 0, no exceptions.
  const banHit = b.bannedTopics.some(t => haystack.includes(t.toLowerCase()));
  if (banHit) {
    pushRationale(r, 'topicalFit', 0, ['⚠ banned topic detected — topicalFit forced to 0']);
    return { value: 0, brandKeywordHit: false, matchedBrandKeywords: [] };
  }

  // 1. Brand keyword hits. We use a word-boundary check so "pova" doesn't
  //    match "innovation" etc. but still picks up "pova 7", "pova-curve".
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

  // 3. Soft anchor — generic tech/phone vocabulary.
  const softAnchorVocab = new Set<string>([
    'phone', 'phones', 'smartphone', 'smartphones', 'mobile', 'handset',
    'android', 'ios', 'iphone', 'flagship', 'oled', 'amoled', '5g',
    ...b.category.toLowerCase().split(/[\s,/]+/).filter(w => w.length >= 4),
  ]);
  const hasSoftAnchor = [...softAnchorVocab].some(a => haystack.includes(a));

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

// Backwards-compat shim — older callers expect a number.
function computeTopicalFit(s: RawSignal, b: BrandProfile, r: ScoreRationale[]): number {
  return computeTopicalFitDetailed(s, b, r).value;
}

// Word-aware substring match. "pova" should match "pova", "pova 7",
// "POVA-curve", "tecno pova" — but NOT "innovation" or "spovapocalypse".
// We require the keyword to be flanked by non-letter chars on both sides
// (or string boundary), and use case-insensitive comparison.
function matchKeyword(haystack: string, keyword: string): boolean {
  const k = keyword.toLowerCase();
  const re = new RegExp('(?:^|[^a-z0-9])' + escapeRegex(k) + '(?:$|[^a-z0-9])', 'i');
  return re.test(haystack);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-stem matcher: matches the prefix at a word boundary, allowing any
// inflection that follows (e.g. stem "redefin" matches "redefine",
// "redefining", "redefined"; stem "boycott" matches "boycott", "boycotts",
// "boycotted"). Tighter than substring includes() — won't match
// "predefined" because of the leading boundary check.
function matchStem(haystack: string, stem: string): boolean {
  const re = new RegExp('(?:^|[^a-z0-9])' + escapeRegex(stem.toLowerCase()) + '[a-z]*(?:$|[^a-z0-9])', 'i');
  return re.test(haystack);
}

function computeTonalFit(s: RawSignal, b: BrandProfile, r: ScoreRationale[]): number {
  const blob = (s.title + ' ' + s.summary + ' ' + (s.text ?? '')).toLowerCase();
  const hitsBanned = b.tone.bannedPhrases.filter(p => blob.includes(p.toLowerCase()));
  const allowedJokesPresent = b.tone.allowedJokes.filter(j => blob.includes(j.toLowerCase()));
  let v = 0.55; // neutral default
  if (allowedJokesPresent.length) v += 0.15 * Math.min(allowedJokesPresent.length, 2);
  if (hitsBanned.length) v -= 0.2 * Math.min(hitsBanned.length, 3);
  // Lifestyle warmth and motivational clichés — POVA-style anti-pattern detector
  const cliches = ['unleash', 'limitless', 'dream big', 'be the best version'];
  const clicheHits = cliches.filter(c => blob.includes(c)).length;
  if (clicheHits) v -= 0.25;
  v = clamp01(v);
  pushRationale(r, 'tonalFit', v, [
    hitsBanned.length ? `banned phrases: ${hitsBanned.join(', ')}` : 'no banned phrases',
    clicheHits ? `cliché triggers: ${clicheHits}` : 'no cliché triggers',
  ]);
  return round(v);
}

function computeAudienceOverlap(s: RawSignal, b: BrandProfile, r: ScoreRationale[]): number {
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

function computeTiming(s: RawSignal, peakEnd: Date, r: ScoreRationale[]): number {
  const now = Date.now();
  const peakMs = peakEnd.getTime();
  const ageMs = now - s.firstSeenAt.getTime();
  const totalLifeMs = Math.max(peakMs - s.firstSeenAt.getTime(), 60 * 60 * 1000);
  const ratio = ageMs / totalLifeMs; // 0 = brand new, 1 = at end of peak window
  // Best timing is around 0.15..0.4 of life. Bell curve.
  const v = clamp01(Math.exp(-Math.pow((ratio - 0.27) / 0.22, 2)));
  pushRationale(r, 'timing', v, [
    `age ratio ${pct(ratio)} of estimated peak life`,
    v > 0.7 ? 'inside the optimal post window' : v > 0.4 ? 'late but viable' : 'too early or past peak',
  ]);
  return round(v);
}

function computeFirstMover(brandPostCount: number, r: ScoreRationale[]): number {
  const v = brandPostCount === 0 ? 1 : brandPostCount === 1 ? 0.6 : 0;
  pushRationale(r, 'firstMover', v, [
    `brand has posted ${brandPostCount} time(s) on this trend`,
  ]);
  return v;
}

function computeSaturation(s: RawSignal, r: ScoreRationale[]): number {
  // Approximate saturation from velocity decay vs reach.
  // Higher reach + dropping velocity => high saturation.
  const reachFactor = Math.tanh(s.reach / 10_000_000);
  const velocityCool = s.velocity < 50 ? 0.5 : 0;
  const v = clamp01(0.4 * reachFactor + velocityCool);
  pushRationale(r, 'saturation', v, [
    `reach factor ${pct(reachFactor)}`,
    velocityCool ? 'velocity cooling — late entrants saturate fast' : 'velocity still hot',
  ]);
  return round(v);
}

function computeRisk(s: RawSignal, b: BrandProfile, r: ScoreRationale[]): number {
  // Risk computation now spreads across the 0-1 axis instead of clustering
  // at the 0.15 baseline. Multiple weighted vocabularies contribute:
  //   • banned topics      (heaviest — explicit no-go)
  //   • crisis vocab       (death, lawsuit, scandal, etc.)
  //   • controversy vocab  (boycott, cancel, fired)
  //   • inflammatory vocab (riot, extremist, violent)
  //   • sentiment skew     (-0.3 or worse)
  //   • competitor mention (adds engagement risk if we react)
  //
  // Each vocabulary contributes to the score AND to the rationale list so
  // the scores tab actually explains *why* a trend is risky.
  const blob = (s.title + ' ' + s.summary + ' ' + (s.text ?? '')).toLowerCase();
  let risk = 0.10;          // lower baseline — most public news isn't risky
  const reasons: string[] = [];

  const bannedHits = b.bannedTopics.filter(t => blob.includes(t.toLowerCase()));
  if (bannedHits.length) {
    risk += 0.55;
    reasons.push(`banned topic: ${bannedHits.slice(0, 3).join(', ')}`);
  }

  // Crisis vocab — concrete bad-thing-happened markers. Stems so
  // "lawsuit" matches "lawsuits", "fired" matches "fires"/"firing", etc.
  const crisisStems = [
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
  const crisisHits = crisisStems.filter(v => matchStem(blob, v));
  if (crisisHits.length) {
    risk += Math.min(0.45, 0.10 * crisisHits.length);
    reasons.push(`crisis: ${crisisHits.slice(0, 3).join(', ')}`);
  }

  // Controversy / cancellation vocab — softer than crisis but still risky
  // for brand-association.
  const controversyStems = [
    'boycott', 'cancel', 'apolog',
    'backlash', 'outrage', 'protest', 'demand', 'criticis',
    'condemn', 'denounce', 'slam', 'slammed', 'slamming',
    'feud', 'spat', 'rift', 'clash', 'dispute', 'tension',
  ];
  const controversyHits = controversyStems.filter(v => matchStem(blob, v));
  if (controversyHits.length) {
    risk += Math.min(0.30, 0.08 * controversyHits.length);
    reasons.push(`controversy: ${controversyHits.slice(0, 3).join(', ')}`);
  }

  // Inflammatory political/social vocab — even without exact banned-topic
  // match, these words signal the trend is polarized.
  const inflammatoryStems = [
    'riot', 'violen', 'extremis', 'terror', 'radical', 'militia',
    'communal', 'sectarian', 'genocide', 'ethnic cleansing',
    'war', 'attack', 'bomb', 'shoot', 'shot', 'stabbing',
    'hostage', 'kidnap', 'assault',
  ];
  const inflammatoryHits = inflammatoryStems.filter(v => matchStem(blob, v));
  if (inflammatoryHits.length) {
    risk += Math.min(0.40, 0.18 * inflammatoryHits.length);
    reasons.push(`inflammatory: ${inflammatoryHits.slice(0, 2).join(', ')}`);
  }

  // Tabloid / hype-anxiety markers — softer signal but adds spread to
  // otherwise-flat distributions. ("shocking", "alarming", etc.)
  const anxietyStems = [
    'shock', 'alarm', 'panic', 'fear', 'worri', 'crisis',
    'warning', 'warn', 'urgent', 'emergency',
  ];
  const anxietyHits = anxietyStems.filter(v => matchStem(blob, v));
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

function computeCringe(s: RawSignal, b: BrandProfile, r: ScoreRationale[]): number {
  // Cringe scoring is the brand-voice's safety belt. Previous version
  // capped most trends at ~10% because the marker set was tiny and
  // anchored to forced-Gen-Z phrases. We expand into:
  //   1. brand-specific banned phrases (heaviest weight)
  //   2. cliché triggers ("unleash", "level up", etc.) — graded
  //   3. ad-speak markers ("disrupt", "redefine", "reimagined")
  //   4. forced-slang (rizz / pov / main-character)
  //   5. exclamation density (too many !! reads desperate)
  //   6. emoji clusters (3+ in a row reads spammy)
  //   7. ALL-CAPS density (>20% caps in a 40+ char title reads shouty)
  //
  // Each tier contributes a different magnitude — the score now spreads
  // 0.05 → 1.0 across real-world trends instead of clustering at 0.1.

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

  // 2. Universal cliché triggers — stem-matched so "unleashing" /
  //    "leveling up" / "manifested" all hit. 0.16 each, plateaus at ~3.
  const clicheStems = [
    'unleash', 'limitless', 'dream big', 'best version', 'level up',
    'crushing it', 'work hard play hard', 'live your best life', 'living your best life',
    'main character', 'manifest', 'lock in',
    'no cap', 'lowkey', 'highkey', 'vibes only',
  ];
  const clicheHits = clicheStems.filter(c => matchStem(blob, c));
  if (clicheHits.length) {
    v += Math.min(0.45, 0.16 * clicheHits.length);
    reasons.push(`cliché trigger${clicheHits.length > 1 ? 's' : ''}: ${clicheHits.slice(0, 3).join(', ')}`);
  }

  // 3. Ad-speak — corporate buzzwords that read like a PR release. Stems
  //    so "redefining", "disrupted", "leveraged" all match.
  const adSpeakStems = [
    'disrupt', 'redefin', 'reimagin', 'game changer', 'world-class',
    'world class', 'next-level', 'next level', 'paradigm', 'thought leader',
    'synerg', 'leverag', 'best-in-class', 'cutting-edge', 'cutting edge',
    'state-of-the-art', 'state of the art', 'revolutionar', 'transformat',
    'innovativ', 'pioneer', 'unparallel', 'industry-first', 'industry first',
    'seamless', 'frictionless', 'turnkey', 'holistic', 'curated experience',
  ];
  const adSpeakHits = adSpeakStems.filter(c => matchStem(blob, c));
  if (adSpeakHits.length) {
    v += Math.min(0.32, 0.10 * adSpeakHits.length);
    reasons.push(`ad-speak: ${adSpeakHits.slice(0, 3).join(', ')}`);
  }

  // 4. Hype / clickbait adjectives — these dominate tech-news headlines
  //    and are the actual cringe vector for most signal we ingest.
  //    Lower per-hit weight (0.06) but very common, so they create real
  //    spread across the distribution instead of clustering at the floor.
  const hypeStems = [
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
  const hypeHits = hypeStems.filter(c => matchStem(blob, c));
  if (hypeHits.length) {
    v += Math.min(0.30, 0.06 * hypeHits.length);
    reasons.push(`hype adjective${hypeHits.length > 1 ? 's' : ''}: ${hypeHits.slice(0, 3).join(', ')}`);
  }

  // 5. Forced slang — when older brands try to talk like teens. Heavier
  //    weight because the failure mode is so visible.
  const forcedSlangTriggers = [
    'rizz up the world', 'how do you do fellow kids', 'we listen we don',
    'rizzler', 'gyatt', 'sigma grindset', 'on god fr', 'sheeshhh',
    'pov:', 'literally me', 'no thoughts head empty', 'fr fr', 'bussin',
  ];
  const slangHits = forcedSlangTriggers.filter(c => blob.includes(c));
  if (slangHits.length) {
    v += 0.25 * slangHits.length;
    reasons.push(`forced slang: ${slangHits.slice(0, 2).join(', ')}`);
  }

  // 5. Exclamation density — !!!!! reads desperate. Look at the original
  //    title (preserve case for accurate count).
  const original = s.title + ' ' + s.summary;
  const bangs = (original.match(/!/g) ?? []).length;
  if (bangs >= 3) { v += 0.15; reasons.push(`${bangs} exclamation marks`); }
  else if (bangs === 2) { v += 0.08; }

  // 6. Emoji clusters — 3+ adjacent emoji reads like a Linkedin influencer post.
  const emojiCluster = /(\p{Extended_Pictographic}‍?){3,}/u;
  if (emojiCluster.test(original)) {
    v += 0.18;
    reasons.push('emoji cluster (3+ adjacent)');
  }

  // 7. ALL-CAPS density on long-enough titles. Headlines with >25%
  //    caps (excluding acronyms / source pills) read shouty.
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

function estimateAssetEffort(s: RawSignal, r: ScoreRationale[]): number {
  // Heuristic: video-native trends require more effort than text-native.
  const isVideoNative = s.source === 'tiktok' || s.source === 'youtube';
  const v = isVideoNative ? 0.7 : 0.3;
  pushRationale(r, 'assetEffort', v, [
    isVideoNative ? 'video-native source — needs shooting/editing' : 'text/image source — fast turnaround',
  ]);
  return v;
}

function estimateApprovalEffort(b: BrandProfile, r: ScoreRationale[]): number {
  const v = { strict: 0.85, moderate: 0.5, fast: 0.2 }[b.approvalMode] ?? 0.5;
  pushRationale(r, 'approvalEffort', v, [`approval mode = ${b.approvalMode}`]);
  return v;
}

function estimateProductionEffort(s: RawSignal, r: ScoreRationale[]): number {
  const isVideoNative = s.source === 'tiktok' || s.source === 'youtube';
  const v = isVideoNative ? 0.6 : 0.25;
  pushRationale(r, 'productionEffort', v, [
    isVideoNative ? 'video production overhead' : 'low production cost',
  ]);
  return v;
}

// -----------------------------------------------------------------------------
// Decision
// -----------------------------------------------------------------------------

function decide(scores: Scores, s: RawSignal, b: BrandProfile): { recommendation: Recommendation; recommendationReason: string } {
  // Hard kills first.
  if (s.competitorClaimants.length >= 2) {
    return { recommendation: 'IGNORE', recommendationReason: `Already claimed by ${s.competitorClaimants.slice(0, 2).join(', ')}. Doubling-down would be dilutive.` };
  }
  if (scores.cringe > 0.7) {
    return { recommendation: 'IGNORE', recommendationReason: `Cringe risk ${pct(scores.cringe)} above safety threshold for the brand voice.` };
  }
  if (scores.risk > 0.7) {
    return { recommendation: 'ESCALATE', recommendationReason: `Risk ${pct(scores.risk)} too high for autonomous action. Send to brand/legal for review.` };
  }
  if (scores.topicalFit === 0) {
    return { recommendation: 'IGNORE', recommendationReason: `Banned topic detected — outside brand-safe territory.` };
  }
  if (b.crisisMode) {
    return { recommendation: 'MONITOR', recommendationReason: `Brand crisis mode is ON. Reactive content paused globally.` };
  }

  // Brand-fit floor. We DON'T want to MONITOR things we'd never realistically
  // post about, but we also can't be so strict that 90% of public trends
  // get hidden — most signals on a niche brand don't directly match safe
  // themes, and that's the whole point of the dashboard (peripheral
  // awareness). The threshold is intentionally low: 0.30. Below that the
  // engine is saying "this is genuinely off-brand", and IGNORE is the
  // honest answer.
  // Brand-fit floor is 25% — anything below means no brand-keyword,
  // no competitor mention, AND no soft-anchor + theme combination. That's
  // genuinely off-brand. Competitor-only trends (~45% brand-fit) and
  // soft-anchor + theme trends (~35%) survive into MONITOR/PREP, which
  // is the whole point of peripheral awareness. Tonal floor 25% blocks
  // brand-banned-phrase trends regardless of brand-fit.
  if (scores.brandFit < 0.25 || scores.tonalFit < 0.25) {
    return {
      recommendation: 'IGNORE',
      recommendationReason: `Brand-fit ${pct(scores.brandFit)} (tonal ${pct(scores.tonalFit)}) below the actionability floor. Not worth a slot.`,
    };
  }

  if (scores.opportunity >= 75 && scores.timing > 0.6) {
    return { recommendation: 'POST_NOW', recommendationReason: `Opportunity ${scores.opportunity} with strong timing — post window is open now.` };
  }
  if (scores.opportunity >= 55) {
    return { recommendation: 'PREP_1H', recommendationReason: `Opportunity ${scores.opportunity}. Worth drafting now and shipping within the hour.` };
  }
  // MONITOR threshold lowered from 35 → 25 because the brand-fit floor
  // already gates "is this on-brand at all". Once a trend passes that
  // floor (brand keyword, competitor, or soft-anchor + theme), the user
  // wants to *see* it on the board for peripheral awareness even if the
  // composite opportunity is modest. The board distinguishes MONITOR
  // (passive watch) from PREP_1H / POST_NOW (active draft) anyway.
  if (scores.opportunity >= 25) {
    return { recommendation: 'MONITOR', recommendationReason: `Opportunity ${scores.opportunity}. Watch for spike or angle change.` };
  }
  return { recommendation: 'IGNORE', recommendationReason: `Opportunity ${scores.opportunity} too low to justify the slot.` };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

export function predictPeakWindowEnd(s: RawSignal): Date {
  // Source-specific half-life model. Tuned from observed engagement
  // half-lives — these are conservative (skew long) so trends don't
  // disappear from the dashboard before an operator can see them.
  //   x         : tweets are short-lived, ~6h is generous already
  //   reddit    : long-tail comment threads (18h)
  //   youtube   : videos rank for 36h+ on the platform
  //   tiktok    : algo can resurface within 24h cycle
  //   gtrends   : daily search momentum, 72h
  //   news      : was 8h — too short, articles still rank on Google for
  //               24-48h and tech reviews retain relevance for days.
  //               Bumped to 24h.
  //   custom    : conservative middle ground for user RSS feeds
  const halfLifeHours = {
    x: 6, reddit: 18, youtube: 36, tiktok: 24, google_trends: 72, news: 24, custom: 18,
  }[s.source] ?? 18;
  return new Date(s.firstSeenAt.getTime() + halfLifeHours * 60 * 60 * 1000);
}

function pushRationale(arr: ScoreRationale[], axis: keyof Scores, value: number, reasons: string[]) {
  arr.push({ axis, value: round(value), reasons });
}

function clamp01(n: number) { return Math.max(0, Math.min(1, n)); }
function round(n: number) { return Math.round(n * 100) / 100; }
function pct(n: number) { return `${Math.round(n * 100)}%`; }
function formatBig(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
function sigmoid01(x: number, midpoint: number, k: number) {
  return 1 / (1 + Math.exp(-k * (x - midpoint)));
}
