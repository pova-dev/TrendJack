// Multi-Platform Spillover detector tests.

import { describe, expect, it } from 'vitest';
import { detectSpillover, buildSpilloverLookup } from '@/src/core/scoring/spillover';
import type { Trend } from '@/types';

function mkTrend(id: string, title: string, source: Trend['source']): Trend {
  return {
    id,
    brandId: 'b',
    source,
    title,
    summary: title,
    hashtags: [],
    lineage: 'fixture',
    firstSeenAt: new Date(),
    velocity: 100,
    reach: 0,
    sentiment: 0,
    audienceOverlap: 0,
    velocityDelta: 0,
    formatFatigue: 0,
    competitorClaimed: false,
    competitorClaimants: [],
    brandKeywordHit: false,
    matchedBrandKeywords: [],
    pinned: false,
    examples: [],
    scores: {
      virality: 0, topicalFit: 0, tonalFit: 0, audienceOverlap: 0, brandFit: 0,
      timing: 0, firstMover: 0, saturation: 0, risk: 0, cringe: 0,
      formatFatigue: 0, assetEffort: 0, approvalEffort: 0, productionEffort: 0,
      effort: 0, opportunity: 0,
    },
    rationale: [],
    recommendation: 'IGNORE',
    recommendationReason: '',
    peakWindowEnd: new Date(Date.now() + 24 * 60 * 60 * 1000),
    url: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Trend;
}

describe('detectSpillover', () => {
  it('groups same-content trends across multiple sources', () => {
    const groups = detectSpillover([
      mkTrend('a', 'iQOO Z11 launches in India',  'reddit'),
      mkTrend('b', 'iQOO Z11 launches in India',  'news'),
      mkTrend('c', 'iQOO Z11 launches in India.', 'x'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].crossSourceCount).toBe(3);
    expect(new Set(groups[0].sources)).toEqual(new Set(['reddit', 'news', 'x']));
  });

  it('drops single-source groups', () => {
    const groups = detectSpillover([
      mkTrend('a', 'POVA Curve review',          'reddit'),
      mkTrend('b', 'POVA Curve review (cross)', 'reddit'),
    ]);
    expect(groups).toHaveLength(0); // both reddit → not a spillover
  });

  it('matches across re-cased + re-punctuated titles', () => {
    const groups = detectSpillover([
      mkTrend('a', 'Smartphone Price Shock Hits India',          'news'),
      mkTrend('b', 'smartphone price shock hits india.',          'reddit'),
      mkTrend('c', 'SMARTPHONE PRICE SHOCK HITS INDIA',           'x'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].crossSourceCount).toBe(3);
  });

  it('keeps semantically distinct titles separate', () => {
    const groups = detectSpillover([
      mkTrend('a', 'iQOO Z11 launches', 'reddit'),
      mkTrend('b', 'iQOO Neo 10 review', 'news'),
    ]);
    expect(groups).toHaveLength(0);
  });
});

describe('buildSpilloverLookup', () => {
  it('returns trendId → crossSourceCount map', () => {
    const trends = [
      mkTrend('a', 'iQOO Z11 launches', 'reddit'),
      mkTrend('b', 'iQOO Z11 launches', 'news'),
      mkTrend('c', 'iQOO Z11 launches', 'x'),
      mkTrend('d', 'POVA Curve review', 'reddit'), // single-source, no entry
    ];
    const lookup = buildSpilloverLookup(trends);
    expect(lookup.get('a')).toBe(3);
    expect(lookup.get('b')).toBe(3);
    expect(lookup.get('c')).toBe(3);
    expect(lookup.get('d')).toBeUndefined(); // single-source → no boost
  });
});
