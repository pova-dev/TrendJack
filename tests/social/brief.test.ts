// Daily brief and viral analysis tests.
//
// The single most important behaviour here is that a narrative citing a number
// nobody supplied gets REJECTED rather than displayed. A model writing "up 12%
// this week" when the real figure is 3% produces something that looks
// completely normal on a dashboard and is wrong in the direction that changes
// decisions. The computed fallback is shown instead.

import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  briefToPrompt, unsupportedNumbers, fallbackSummary,
  generateBriefNarrative, analyzeViralPatterns, type ViralPost,
} from '@/lib/social/brief';
import { buildDailyBrief, type AccountSeries, type SamplePoint } from '@/lib/social/analytics';

const DAY = 86_400_000;
const now = Date.now();

function series(start: number, perDay: number, days: number): SamplePoint[] {
  const out: SamplePoint[] = [];
  for (let d = days; d >= 0; d--) out.push({ at: new Date(now - d * DAY), followers: Math.round(start + perDay * (days - d)) });
  return out;
}
const acct = (o: Partial<AccountSeries>): AccountSeries => ({
  accountId: 'a', platform: 'instagram', handle: 'h', label: 'L',
  isOwn: false, samples: [], latestPost: null, ...o,
});

const BRIEF = () => buildDailyBrief([
  acct({ accountId: 'p', label: 'POVA', isOwn: true, samples: series(100_000, 500, 7), latestPost: { likes: 9_000, commentCount: 1_000, views: 0 } }),
  acct({ accountId: 'i', label: 'iQOO', samples: series(150_000, 100, 7), latestPost: { likes: 4_000, commentCount: 200, views: 0 } }),
]);

const ORIGINAL = globalThis.fetch;
afterEach(() => { globalThis.fetch = ORIGINAL; vi.restoreAllMocks(); vi.resetModules(); });

/** Make runChat succeed with a given JSON payload. */
function mockModel(payload: unknown) {
  vi.doMock('@/lib/ai/provider', () => ({
    runChat: vi.fn(async () => ({
      ok: true, text: JSON.stringify(payload), provider: 'openrouter', model: 'anthropic/claude-sonnet-4-5',
    })),
    resolveOpenRouterReferer: () => 'http://localhost',
  }));
}
function mockModelFailure(error: string) {
  vi.doMock('@/lib/ai/provider', () => ({
    runChat: vi.fn(async () => ({ ok: false, error, provider: 'openrouter' })),
    resolveOpenRouterReferer: () => 'http://localhost',
  }));
}

describe('briefToPrompt', () => {
  it('hands over finished figures, never raw series', () => {
    // Given samples the model would be tempted to compute a rate. Given only
    // finished figures there is nothing to compute.
    const p = briefToPrompt(BRIEF());
    expect(p).toMatch(/INSTAGRAM STANDINGS/);
    expect(p).toMatch(/POVA \(US\)/);
    expect(p).toMatch(/followers/);
    expect(p).toMatch(/engagement/);
    expect(p).not.toMatch(/sampledAt|"at":/);
  });

  it('marks which account is ours', () => {
    expect(briefToPrompt(BRIEF())).toContain('(US)');
  });
});

describe('unsupportedNumbers', () => {
  const allowed = new Set(['100000', '100,000', '5.00', '412']);

  it('accepts figures that were supplied', () => {
    expect(unsupportedNumbers('We have 100,000 followers at 5.00% engagement', allowed)).toEqual([]);
  });

  it('catches an invented figure', () => {
    expect(unsupportedNumbers('Growth hit 47,213 this week', allowed)).toContain('47,213');
  });

  it('ignores small integers, which are language rather than claims', () => {
    // "3 moves", "top 5", "the 2 channels" are not data claims.
    expect(unsupportedNumbers('Here are 3 moves across 2 platforms', allowed)).toEqual([]);
  });

  it('catches an invented percentage', () => {
    expect(unsupportedNumbers('engagement is 88.4%', allowed)).toContain('88.4%');
  });
});

describe('generateBriefNarrative', () => {
  it('returns the model narrative when every figure checks out', async () => {
    mockModel({
      summary: 'POVA sits second on Instagram behind iQOO.',
      moves: ['Keep the current cadence.'],
    });
    const { generateBriefNarrative: gen } = await import('@/lib/social/brief');

    const out = await gen(BRIEF());
    expect(out.aiGenerated).toBe(true);
    expect(out.summary).toMatch(/POVA sits second/);
    expect(out.moves).toHaveLength(1);
  });

  it('REJECTS a narrative that invents a figure, and falls back to computed text', async () => {
    // The core protection. This is the failure that would quietly mislead.
    mockModel({
      summary: 'POVA grew 47,213 followers this week, a 62.5% surge.',
      moves: ['Double down.'],
    });
    const { generateBriefNarrative: gen } = await import('@/lib/social/brief');

    const out = await gen(BRIEF());
    expect(out.aiGenerated).toBe(false);
    expect(out.error).toMatch(/absent from the data/i);
    expect(out.summary).not.toMatch(/47,213/);
    expect(out.summary).toMatch(/followers/);   // computed fallback still useful
  });

  it('falls back gracefully when the model is unavailable', async () => {
    // The out-of-credit case. The panel must still say something true.
    mockModelFailure('Insufficient credits');
    const { generateBriefNarrative: gen } = await import('@/lib/social/brief');

    const out = await gen(BRIEF());
    expect(out.aiGenerated).toBe(false);
    expect(out.error).toMatch(/Insufficient credits/);
    expect(out.summary.length).toBeGreaterThan(10);
    expect(out.moves.length).toBeGreaterThan(0);   // computed opportunities
  });

  it('falls back when the model returns unparseable output', async () => {
    vi.doMock('@/lib/ai/provider', () => ({
      runChat: vi.fn(async () => ({ ok: true, text: 'not json at all', provider: 'openrouter', model: 'm' })),
      resolveOpenRouterReferer: () => 'http://localhost',
    }));
    const { generateBriefNarrative: gen } = await import('@/lib/social/brief');

    const out = await gen(BRIEF());
    expect(out.aiGenerated).toBe(false);
    expect(out.error).toMatch(/unparseable/i);
  });

  it('says so plainly when there is no data, rather than asking a model to pad', async () => {
    const out = await generateBriefNarrative(buildDailyBrief([]));
    expect(out.aiGenerated).toBe(false);
    expect(out.summary).toMatch(/No readings yet/i);
  });
});

describe('fallbackSummary', () => {
  it('is entirely computed and quotes real totals', () => {
    const b = BRIEF();
    const s = fallbackSummary(b);
    expect(s).toContain(b.facts.ownFollowersTotal!.toLocaleString());
    expect(unsupportedNumbers(s, new Set([
      b.facts.ownFollowersTotal!.toLocaleString(),
      Math.abs(b.facts.ownFollowersDelta ?? 0).toLocaleString(),
      ...b.rows.map(r => r.followers.toLocaleString()),
      ...b.opportunities.flatMap(o => (`${o.headline} ${o.detail}`.match(/[\d,]+(?:\.\d+)?/g) ?? [])),
    ]))).toEqual([]);
  });

  it('never returns an empty string', () => {
    expect(fallbackSummary(buildDailyBrief([])).length).toBeGreaterThan(0);
  });
});

describe('analyzeViralPatterns', () => {
  const post = (over: Partial<ViralPost>): ViralPost => ({
    label: 'POVA', platform: 'instagram', caption: 'c',
    likes: 100, views: 0, commentCount: 10, engagementRatePct: 1, ...over,
  });

  it('refuses to find patterns in fewer than 3 posts', async () => {
    // Patterns from one or two posts are decoration, not analysis.
    const out = await analyzeViralPatterns([post({}), post({})]);
    expect(out.aiGenerated).toBe(false);
    expect(out.error).toMatch(/at least 3 posts/i);
    expect(out.patterns).toEqual([]);
  });

  it('returns structured patterns when the model succeeds', async () => {
    mockModel({
      patterns: [{ name: 'Spec-led hook', evidence: 'Top post opens with battery capacity' }],
      formats: ['Short teardown clips'],
      audienceThemes: ['Battery life questions dominate'],
    });
    const { analyzeViralPatterns: run } = await import('@/lib/social/brief');

    const out = await run([post({ engagementRatePct: 9 }), post({ engagementRatePct: 4 }), post({ engagementRatePct: 1 })]);
    expect(out.aiGenerated).toBe(true);
    expect(out.patterns[0].name).toBe('Spec-led hook');
    expect(out.sampleSize).toBe(3);
  });

  it('reports the model error instead of inventing patterns', async () => {
    mockModelFailure('Insufficient credits');
    const { analyzeViralPatterns: run } = await import('@/lib/social/brief');

    const out = await run([post({}), post({}), post({})]);
    expect(out.aiGenerated).toBe(false);
    expect(out.patterns).toEqual([]);
    expect(out.error).toMatch(/Insufficient credits/);
  });

  it('always reports the sample size, so a thin analysis is visibly thin', async () => {
    const out = await analyzeViralPatterns([post({}), post({})]);
    expect(out.sampleSize).toBe(2);
  });
});
