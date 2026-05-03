// Scout Agent tests:
//   - parallel poll (latency = max(connectors), not sum)
//   - per-source backoff (failed sources skip subsequent ticks)
//   - content-fingerprint dedup (cross-post / repost detection)
//   - publishing to STREAMS.rawSignals

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { runScout } from '@/src/agents/scout/runner';
import { BackoffTracker } from '@/src/agents/scout/backoff';
import {
  contentFingerprint,
  dedupKey,
  dedupSignals,
  canonicalizeUrl,
} from '@/src/agents/scout/dedup';
import { MemoryStateBus, STREAMS } from '@/src/core/state';
import { mkSignal } from '../fixtures/trends';
import type { ScoutContext } from '@/src/agents/scout/types';
import type { RawSignal } from '@/src/core/scoring/types';

const ctx: ScoutContext = {
  brandId: 'test-brand',
  brandName: 'POVA',
  brandKeywords: ['pova', 'tecno'],
  competitors: ['Xiaomi'],
  themes: ['gaming', 'battery'],
  since: new Date(Date.now() - 24 * 60 * 60 * 1000),
  credentials: {},
};

// ---------------------------------------------------------------------------
// Content fingerprint + dedup
// ---------------------------------------------------------------------------

describe('contentFingerprint', () => {
  it('strips case, punctuation, and emoji', () => {
    expect(contentFingerprint({ title: 'POVA Curve 2 Battery Life is Insane.✨' }))
      .toBe('povacurve2batterylifeisinsane');
  });

  it('strips trailing source-pill', () => {
    expect(contentFingerprint({ title: 'POVA Curve 2 Battery Life is Insane - The Verge' }))
      .toBe('povacurve2batterylifeisinsane');
  });

  it('matches across re-cased + re-punctuated variants', () => {
    const a = contentFingerprint({ title: 'POVA Curve 2 Battery Life is Insane.' });
    const b = contentFingerprint({ title: 'pova curve 2 battery life is insane!' });
    const c = contentFingerprint({ title: 'POVA  curve  2  battery  life  is  insane' });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('strips publication-name source-pills correctly', () => {
    // Real-world headline patterns the dedup needs to handle.
    expect(contentFingerprint({ title: 'iQOO Z11 launch confirmed - The Verge' }))
      .toBe(contentFingerprint({ title: 'iQOO Z11 launch confirmed - Engadget' }));
    expect(contentFingerprint({ title: 'iQOO Z11 launch confirmed' }))
      .toBe(contentFingerprint({ title: 'iQOO Z11 launch confirmed - HotHardware.com' }));
  });

  it('keeps semantically distinct titles distinct', () => {
    const a = contentFingerprint({ title: 'POVA Curve 2 review' });
    const b = contentFingerprint({ title: 'iQOO Neo 10 review' });
    expect(a).not.toBe(b);
  });
});

describe('canonicalizeUrl', () => {
  it('strips protocol, query, trailing slash, lowercases host', () => {
    expect(canonicalizeUrl('https://Example.COM/some/path/?utm=x'))
      .toBe('example.com/some/path');
    expect(canonicalizeUrl('http://example.com/path/'))
      .toBe('example.com/path');
  });

  it('returns null for missing or malformed URLs', () => {
    expect(canonicalizeUrl(undefined)).toBeNull();
    expect(canonicalizeUrl('not a url')).toBeNull();
    expect(canonicalizeUrl('')).toBeNull();
  });
});

describe('dedupSignals', () => {
  it('merges three Reddit posts with the same title across different post IDs', () => {
    const signals: RawSignal[] = [
      { ...mkSignal({ title: 'POVA Curve 2 Battery Life is Insane', source: 'reddit', velocity: 100 }), externalId: 'reddit:abc1' },
      { ...mkSignal({ title: 'POVA Curve 2 Battery Life is Insane', source: 'reddit', velocity: 200 }), externalId: 'reddit:abc2' },
      { ...mkSignal({ title: 'POVA curve 2 battery life is insane!', source: 'reddit', velocity: 50 }), externalId: 'reddit:abc3' },
    ];
    const out = dedupSignals(signals);
    expect(out).toHaveLength(1);
    // Earliest wins; velocity merged to max.
    expect(out[0].velocity).toBe(200);
  });

  it('keeps news + reddit separate even with same title (when URLs differ)', () => {
    // mkSignal defaults to a shared example URL — override so URL-dedup
    // doesn't kick in. The intent: same content from genuinely different
    // platforms with different canonical URLs is two distinct trends.
    const signals: RawSignal[] = [
      { ...mkSignal({ title: 'POVA Curve 2 review', source: 'reddit' }),
        externalId: 'reddit:r1', url: 'https://reddit.com/r/Android/x' },
      { ...mkSignal({ title: 'POVA Curve 2 review', source: 'news'   }),
        externalId: 'news:n1',   url: 'https://techcrunch.com/y' },
    ];
    const out = dedupSignals(signals);
    expect(out).toHaveLength(2);
  });

  it('merges across sources when canonical URL matches', () => {
    const signals: RawSignal[] = [
      { ...mkSignal({ title: 'A about B', source: 'reddit' }), url: 'https://techcrunch.com/x', externalId: 'reddit:x' },
      { ...mkSignal({ title: 'B about A', source: 'news'   }), url: 'https://techcrunch.com/x?utm=foo', externalId: 'news:x' },
    ];
    const out = dedupSignals(signals);
    expect(out).toHaveLength(1);
  });

  it('is idempotent', () => {
    const signals: RawSignal[] = [
      { ...mkSignal({ title: 'POVA Curve 2', source: 'reddit' }), externalId: 'reddit:1' },
      { ...mkSignal({ title: 'POVA Curve 2', source: 'reddit' }), externalId: 'reddit:2' },
    ];
    const once  = dedupSignals(signals);
    const twice = dedupSignals(once);
    expect(once).toHaveLength(twice.length);
    expect(once[0].title).toBe(twice[0].title);
  });

  it('preserves competitorClaimants from both duplicates', () => {
    const a: RawSignal = { ...mkSignal({ title: 'X review', source: 'reddit' }), competitorClaimants: ['xiaomi'] };
    const b: RawSignal = { ...mkSignal({ title: 'X review', source: 'reddit' }), competitorClaimants: ['samsung'] };
    const out = dedupSignals([a, b]);
    expect(out[0].competitorClaimants.sort()).toEqual(['samsung', 'xiaomi']);
  });
});

// ---------------------------------------------------------------------------
// Backoff tracker
// ---------------------------------------------------------------------------

describe('BackoffTracker', () => {
  let mockTime = 1_000_000;
  let tracker: BackoffTracker;

  beforeEach(() => {
    mockTime = 1_000_000;
    tracker = new BackoffTracker({
      firstCooldownMs: 1000,
      multiplier: 2,
      maxCooldownMs: 10_000,
      now: () => mockTime,
    });
  });

  it('reports no cooldown for an unknown connector', () => {
    expect(tracker.isInCooldown('reddit')).toBe(false);
    expect(tracker.cooldownRemaining('reddit')).toBe(0);
  });

  it('cools down for firstCooldownMs after first failure', () => {
    tracker.recordFailure('reddit', 'http_500');
    expect(tracker.isInCooldown('reddit')).toBe(true);
    mockTime += 999;
    expect(tracker.isInCooldown('reddit')).toBe(true);
    mockTime += 2;  // 1001ms total — past first cooldown
    expect(tracker.isInCooldown('reddit')).toBe(false);
  });

  it('doubles the cooldown each consecutive failure', () => {
    tracker.recordFailure('reddit', 'fail-1');
    expect(tracker.cooldownRemaining('reddit')).toBe(1000);
    tracker.recordFailure('reddit', 'fail-2');
    expect(tracker.cooldownRemaining('reddit')).toBe(2000);
    tracker.recordFailure('reddit', 'fail-3');
    expect(tracker.cooldownRemaining('reddit')).toBe(4000);
  });

  it('caps at maxCooldownMs', () => {
    for (let i = 0; i < 20; i++) tracker.recordFailure('reddit', `fail-${i}`);
    expect(tracker.cooldownRemaining('reddit')).toBe(10_000);
  });

  it('resets on success', () => {
    tracker.recordFailure('reddit', 'fail');
    tracker.recordSuccess('reddit');
    expect(tracker.isInCooldown('reddit')).toBe(false);
    expect(tracker.lastFailure('reddit')).toBeNull();
  });

  it('snapshots active backoffs for telemetry', () => {
    tracker.recordFailure('reddit', 'http_429');
    tracker.recordFailure('hn', 'timeout');
    const snap = tracker.snapshot();
    expect(snap).toHaveLength(2);
    expect(snap.map(s => s.connectorId).sort()).toEqual(['hn', 'reddit']);
  });
});

// ---------------------------------------------------------------------------
// runScout
// ---------------------------------------------------------------------------

describe('runScout', () => {
  let bus: MemoryStateBus;
  let backoff: BackoffTracker;

  beforeEach(() => {
    bus = new MemoryStateBus();
    backoff = new BackoffTracker({ firstCooldownMs: 1000, now: () => Date.now() });
  });

  afterEach(async () => {
    await bus.close();
  });

  it('polls connectors in parallel — latency is max, not sum', async () => {
    const slow = (delay: number) => async () => {
      await new Promise(r => setTimeout(r, delay));
      return { ok: true as const, signals: [mkSignal({ title: `slow-${delay}` })] };
    };

    const report = await runScout(ctx, {
      connectors: [
        { id: 'a', source: 'reddit', fn: slow(200) },
        { id: 'b', source: 'news',   fn: slow(200) },
        { id: 'c', source: 'x',      fn: slow(200) },
      ],
      perPollTimeoutMs: 5000,
      backoff,
      bus,
    });

    expect(report.signals).toHaveLength(3);
    // Sequential would take ~600ms; parallel should be ~200ms (with some slack).
    expect(report.totalLatencyMs).toBeLessThan(450);
  });

  it('does not let one slow connector block faster ones', async () => {
    const fast = async () => ({ ok: true as const, signals: [mkSignal({ title: 'fast' })] });
    const slow = async () => {
      await new Promise(r => setTimeout(r, 800));
      return { ok: true as const, signals: [mkSignal({ title: 'slow' })] };
    };

    const report = await runScout(ctx, {
      connectors: [
        { id: 'fast-a', source: 'reddit', fn: fast },
        { id: 'fast-b', source: 'news',   fn: fast },
        { id: 'slow',   source: 'x',      fn: slow },
      ],
      perPollTimeoutMs: 2000,
      backoff,
      bus,
    });

    expect(report.signals).toHaveLength(3);
    expect(report.outcomes.find(o => o.connectorId === 'fast-a')!.latencyMs).toBeLessThan(100);
    expect(report.outcomes.find(o => o.connectorId === 'slow')!.latencyMs).toBeGreaterThan(700);
  });

  it('marks failing connector outcomes with ok=false and records backoff', async () => {
    const failing = async () => ({ ok: false as const, signals: [], reason: 'http_500' });
    const ok = async () => ({ ok: true as const, signals: [mkSignal({ title: 'ok' })] });

    const report = await runScout(ctx, {
      connectors: [
        { id: 'broken',  source: 'youtube', fn: failing },
        { id: 'working', source: 'reddit',  fn: ok },
      ],
      backoff,
      bus,
    });

    expect(report.failed).toEqual(['broken']);
    expect(report.signals).toHaveLength(1); // only the working one
    expect(backoff.isInCooldown('broken')).toBe(true);
    expect(backoff.isInCooldown('working')).toBe(false);
  });

  it('skips connectors in cooldown without invoking poll()', async () => {
    backoff.recordFailure('reddit', 'http_429'); // already cooled down

    let invoked = false;
    const fn = async () => {
      invoked = true;
      return { ok: true as const, signals: [] };
    };

    const report = await runScout(ctx, {
      connectors: [{ id: 'reddit', source: 'reddit', fn }],
      backoff,
      bus,
    });

    expect(invoked).toBe(false);
    expect(report.outcomes[0].ok).toBe(false);
    expect(report.outcomes[0].reason).toMatch(/in_cooldown/);
  });

  it('publishes successful signals to STREAMS.rawSignals', async () => {
    const ok = async () => ({ ok: true as const, signals: [mkSignal({ title: 'pub-test' })] });

    const received: string[] = [];
    bus.subscribe(STREAMS.rawSignals, async (msg) => {
      received.push(msg.body.signal.title);
      await bus.ack(STREAMS.rawSignals.name, msg.id);
    }, { group: 'test-filter' });

    await runScout(ctx, {
      connectors: [{ id: 'pub', source: 'reddit', fn: ok }],
      backoff,
      bus,
    });
    await new Promise(r => setTimeout(r, 20));

    expect(received).toEqual(['pub-test']);
  });

  it('honors dryRun=true — no bus publish', async () => {
    const ok = async () => ({ ok: true as const, signals: [mkSignal({ title: 'dry' })] });
    let bumped = 0;
    bus.subscribe(STREAMS.rawSignals, () => { bumped++; }, { group: 'no-publish' });

    await runScout(ctx, {
      connectors: [{ id: 'a', source: 'reddit', fn: ok }],
      backoff,
      bus,
      dryRun: true,
    });
    await new Promise(r => setTimeout(r, 20));
    expect(bumped).toBe(0);
  });

  it('times out a stuck connector at perPollTimeoutMs', async () => {
    const stuck = () => new Promise<{ ok: false; signals: never[]; reason: string }>(() => { /* never resolves */ });
    const report = await runScout(ctx, {
      connectors: [{ id: 'stuck', source: 'reddit', fn: stuck }],
      perPollTimeoutMs: 100,
      backoff,
      bus,
      dryRun: true,
    });
    expect(report.outcomes[0].ok).toBe(false);
    expect(report.outcomes[0].reason).toMatch(/poll_timeout/);
    expect(report.totalLatencyMs).toBeLessThan(200);
  });
});
