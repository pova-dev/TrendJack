// 20 hand-labeled trend fixtures sliced into the categories the audit plan
// promised:
//
//   Direct brand-keyword hit       (4) — brandFit ≥ 0.85, recommendation ≠ IGNORE
//   Competitor-only mention        (5) — brandFit 0.45-0.55, MONITOR (not POST_NOW)
//   Soft anchor + theme            (3) — brandFit 0.30-0.50, MONITOR
//   Banned topic                   (3) — IGNORE or ESCALATE
//   Cringe-heavy marketing         (2) — cringe ≥ 0.5, IGNORE
//   Pure noise                     (3) — IGNORE
//
// Each fixture is built with `mkSignal()` so we can keep timestamps and
// per-source defaults consistent without copy-pasting boilerplate.

import type { RawSignal } from '@/src/core/scoring/types';
import type { Trend } from '@/types';

const NOW = new Date('2026-04-30T12:00:00Z');
const MS_HOUR = 60 * 60 * 1000;

interface MkSignalInput {
  source?: Trend['source'];
  title: string;
  summary?: string;
  text?: string;
  hashtags?: string[];
  velocity?: number;
  reach?: number;
  sentiment?: number;
  ageHours?: number;
  competitorClaimants?: string[];
}

export function mkSignal(input: MkSignalInput): RawSignal {
  const ageHours = input.ageHours ?? 1;
  return {
    source: input.source ?? 'news',
    title: input.title,
    summary: input.summary ?? input.title,
    hashtags: input.hashtags ?? [],
    text: input.text,
    lineage: `fixture · ${input.source ?? 'news'} · ${ageHours}h ago`,
    firstSeenAt: new Date(NOW.getTime() - ageHours * MS_HOUR),
    velocity: input.velocity ?? 100,
    reach: input.reach ?? 50_000,
    sentiment: input.sentiment ?? 0,
    competitorClaimants: input.competitorClaimants ?? [],
    formatFatigue: 0.1,
    url: 'https://example.test/fixture',
    externalId: `fixture:${input.title.slice(0, 30)}`,
  };
}

// ---------------------------------------------------------------------------
// 1. DIRECT BRAND KEYWORD HITS (4) — should be Brand Matches.

export const BRAND_KEYWORD_HITS: RawSignal[] = [
  mkSignal({
    title: 'Tecno POVA 7 Pro review: gaming monster at a flagship-killer price',
    source: 'news',
    velocity: 200,
    reach: 80_000,
  }),
  mkSignal({
    title: 'Is Tecno POVA worth buying in 2026? Long-term review',
    source: 'reddit',
    summary: 'r/IndianGaming · 320 upvotes',
    velocity: 150,
    reach: 45_000,
  }),
  mkSignal({
    title: 'POVA Curve unboxing — first look at the new design',
    source: 'youtube',
    velocity: 400,
    reach: 200_000,
    ageHours: 3,
  }),
  mkSignal({
    title: 'Compare Tecno Pova vs Samsung Galaxy A57 — which wins?',
    source: 'news',
    summary: 'WhatMobile India compares specs and pricing',
    velocity: 120,
    reach: 60_000,
  }),
];

// ---------------------------------------------------------------------------
// 2. COMPETITOR-ONLY MENTIONS (5) — relevant for Competitor Activity, not BM.

export const COMPETITOR_ONLY: RawSignal[] = [
  mkSignal({
    title: 'iQOO Neo 10 launched in India with Dimensity 9500 chip',
    velocity: 200,
    reach: 100_000,
  }),
  mkSignal({
    title: 'Xiaomi 17T Pro shows up in Geekbench with 12GB RAM',
    velocity: 150,
    reach: 70_000,
  }),
  mkSignal({
    title: 'OnePlus Ace 6 Ultra is official as latest gaming powerhouse',
    velocity: 180,
    reach: 90_000,
  }),
  mkSignal({
    title: 'Realme Buds T500 Pro Review — strong basics, smart extras',
    source: 'news',
    velocity: 100,
    reach: 40_000,
  }),
  mkSignal({
    title: 'Samsung Galaxy A57 leaks reveal AMOLED display and 5000mAh battery',
    velocity: 130,
    reach: 55_000,
  }),
];

// ---------------------------------------------------------------------------
// 3. SOFT ANCHOR + THEME (3) — phone/smartphone vocabulary + a safeTheme hit.

export const SOFT_ANCHOR_THEMED: RawSignal[] = [
  mkSignal({
    title: 'Best smartphone gaming benchmarks of April 2026',
    source: 'news',
    summary: 'Top performers across budget and flagship segments',
    velocity: 90,
    reach: 30_000,
  }),
  mkSignal({
    title: 'How thin can a phone get before battery life suffers?',
    source: 'reddit',
    summary: 'r/Android discussion · 800 upvotes',
    velocity: 80,
    reach: 25_000,
  }),
  mkSignal({
    title: 'Smartphone thermal performance under sustained load',
    source: 'news',
    velocity: 70,
    reach: 18_000,
  }),
];

// ---------------------------------------------------------------------------
// 4. BANNED TOPIC (3) — should be IGNORE (topicalFit=0) or ESCALATE (high risk).

export const BANNED_TOPIC: RawSignal[] = [
  mkSignal({
    title: 'Election rally photo controversy sparks national debate',
    source: 'news',
    summary: 'Political backlash spreads across social media',
    sentiment: -0.5,
    velocity: 500,
    reach: 1_500_000,
  }),
  mkSignal({
    title: 'Apple supply-chain lawsuit filed in India over labour practices',
    source: 'news',
    summary: 'Major lawsuit raises caste and labour concerns',
    sentiment: -0.6,
    velocity: 300,
    reach: 600_000,
  }),
  mkSignal({
    title: 'Tragedy in Mumbai: religion at the centre of communal tension',
    source: 'news',
    sentiment: -0.7,
    velocity: 600,
    reach: 2_000_000,
  }),
];

// ---------------------------------------------------------------------------
// 5. CRINGE-HEAVY MARKETING (2) — should be IGNORE due to cringe ≥ 0.5.

export const CRINGE_HEAVY: RawSignal[] = [
  mkSignal({
    title: '"Unleash your potential" Monday motivation thread for hustlers',
    source: 'reddit',
    summary: 'Crushing it. Limitless. Living your best life. Lock in. Level up your game changer mindset.',
    velocity: 50,
    reach: 5_000,
  }),
  mkSignal({
    title: 'WORLD-CLASS, REVOLUTIONARY, MIND-BLOWING phone redefining smartphones!!!',
    source: 'news',
    summary: 'Disrupt the paradigm with our cutting-edge state-of-the-art innovative pioneer device — game changer!',
    velocity: 80,
    reach: 12_000,
  }),
];

// ---------------------------------------------------------------------------
// 6. PURE NOISE (3) — short / no-anchor / no-theme. IGNORE.

export const PURE_NOISE: RawSignal[] = [
  mkSignal({
    title: 'sinner',
    source: 'google_trends',
    summary: 'Trending in IN.',
    velocity: 5,
    reach: 1_000,
  }),
  mkSignal({
    title: 'bengaluru weather today',
    source: 'google_trends',
    summary: 'Trending in IN.',
    velocity: 8,
    reach: 5_000,
  }),
  mkSignal({
    title: 'madrid open',
    source: 'google_trends',
    summary: 'Trending in IN.',
    velocity: 10,
    reach: 8_000,
  }),
];

// ---------------------------------------------------------------------------
// Convenience: all fixtures concatenated, with their expected category.

export type FixtureCategory =
  | 'brand_keyword'
  | 'competitor_only'
  | 'soft_anchor'
  | 'banned_topic'
  | 'cringe'
  | 'noise';

export interface LabeledFixture {
  category: FixtureCategory;
  signal: RawSignal;
}

export const ALL_FIXTURES: LabeledFixture[] = [
  ...BRAND_KEYWORD_HITS.map(s => ({ category: 'brand_keyword'   as const, signal: s })),
  ...COMPETITOR_ONLY.map(s    => ({ category: 'competitor_only' as const, signal: s })),
  ...SOFT_ANCHOR_THEMED.map(s => ({ category: 'soft_anchor'     as const, signal: s })),
  ...BANNED_TOPIC.map(s       => ({ category: 'banned_topic'    as const, signal: s })),
  ...CRINGE_HEAVY.map(s       => ({ category: 'cringe'          as const, signal: s })),
  ...PURE_NOISE.map(s         => ({ category: 'noise'           as const, signal: s })),
];
