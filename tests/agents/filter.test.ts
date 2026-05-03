// Filter Agent tests — verifies the bus subscription, scoring,
// downstream publish, and auto-verify trigger.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { startFilterAgent, scoreRawSignal } from '@/src/agents/filter';
import { MemoryStateBus, STREAMS } from '@/src/core/state';
import type { ScoredTrendMessage, AlertMessage } from '@/src/core/state';
import { POVA_BRAND } from '../fixtures/pova-brand';
import { mkSignal, BRAND_KEYWORD_HITS, BANNED_TOPIC } from '../fixtures/trends';

let bus: MemoryStateBus;

beforeEach(() => {
  bus = new MemoryStateBus({ redeliveryMs: 5000 });
});

afterEach(async () => {
  await bus.close();
});

describe('startFilterAgent', () => {
  it('scores raw signals and publishes to scoredTrends', async () => {
    const handle = startFilterAgent({
      bus,
      loadBrand: async () => POVA_BRAND,
    });

    const received: ScoredTrendMessage[] = [];
    bus.subscribe(STREAMS.scoredTrends, async (msg) => {
      received.push(msg.body);
      await bus.ack(STREAMS.scoredTrends.name, msg.id);
    }, { group: 'test-consumer' });

    await bus.publish(STREAMS.rawSignals, {
      signal: BRAND_KEYWORD_HITS[0],
      brandId: POVA_BRAND.id,
      connectorId: 'reddit_live',
      fetchedAt: new Date(),
    });
    await new Promise(r => setTimeout(r, 50));

    expect(received).toHaveLength(1);
    expect(received[0].brandId).toBe(POVA_BRAND.id);
    expect(received[0].scoreResult.brandKeywordHit).toBe(true);
    expect(typeof received[0].shouldVerify).toBe('boolean');

    handle.stop();
  });

  it('emits alerts on ESCALATE recommendations', async () => {
    const handle = startFilterAgent({
      bus,
      loadBrand: async () => POVA_BRAND,
    });

    const alerts: AlertMessage[] = [];
    bus.subscribe(STREAMS.alerts, async (msg) => {
      alerts.push(msg.body);
      await bus.ack(STREAMS.alerts.name, msg.id);
    }, { group: 'test-alert-listener' });

    // BANNED_TOPIC[0] = high-risk election story → expects ESCALATE
    await bus.publish(STREAMS.rawSignals, {
      signal: BANNED_TOPIC[0],
      brandId: POVA_BRAND.id,
      connectorId: 'news',
      fetchedAt: new Date(),
    });
    await new Promise(r => setTimeout(r, 50));

    // Banned topic with risk ≥ 0.7 → ESCALATE → alert published
    const escalated = alerts.find(a => a.title.includes('ESCALATE'));
    expect(escalated).toBeDefined();
    expect(escalated!.level).toBe('critical');

    handle.stop();
  });

  it('drops the message when brand is missing (acks but does not publish)', async () => {
    const handle = startFilterAgent({
      bus,
      loadBrand: async () => null, // simulate deleted brand
    });

    const received: ScoredTrendMessage[] = [];
    bus.subscribe(STREAMS.scoredTrends, async (msg) => {
      received.push(msg.body);
      await bus.ack(STREAMS.scoredTrends.name, msg.id);
    }, { group: 'sink' });

    await bus.publish(STREAMS.rawSignals, {
      signal: BRAND_KEYWORD_HITS[0],
      brandId: 'gone',
      connectorId: 'reddit_live',
      fetchedAt: new Date(),
    });
    await new Promise(r => setTimeout(r, 50));

    expect(received).toHaveLength(0);
    handle.stop();
  });

  it('uses enrichSignal when provided', async () => {
    let enrichCalled = false;
    const handle = startFilterAgent({
      bus,
      loadBrand: async () => POVA_BRAND,
      enrichSignal: async () => {
        enrichCalled = true;
        return { reproductionRate: 2.0, crossSourceCount: 3 };
      },
    });

    bus.subscribe(STREAMS.scoredTrends, async (msg) => {
      await bus.ack(STREAMS.scoredTrends.name, msg.id);
    }, { group: 'enrichment-test' });

    await bus.publish(STREAMS.rawSignals, {
      signal: BRAND_KEYWORD_HITS[0],
      brandId: POVA_BRAND.id,
      connectorId: 'reddit_live',
      fetchedAt: new Date(),
    });
    await new Promise(r => setTimeout(r, 50));

    expect(enrichCalled).toBe(true);
    handle.stop();
  });
});

describe('scoreRawSignal (one-shot helper)', () => {
  it('returns a full ScoreResult', () => {
    const result = scoreRawSignal(BRAND_KEYWORD_HITS[0], POVA_BRAND);
    expect(result.scores.brandFit).toBeGreaterThan(0.5);
    expect(result.brandKeywordHit).toBe(true);
    expect(result.recommendation).not.toBe('IGNORE');
  });

  it('forwards enrichment to the engine', () => {
    const a = scoreRawSignal(BRAND_KEYWORD_HITS[0], POVA_BRAND, { reproductionRate: 0.2 });
    const b = scoreRawSignal(BRAND_KEYWORD_HITS[0], POVA_BRAND, { reproductionRate: 2.0 });
    // High R → higher CVS
    expect(b.jackingScore).toBeGreaterThan(a.jackingScore);
  });
});
