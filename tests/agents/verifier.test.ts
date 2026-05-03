// Verifier Agent tests.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { startVerifierAgent, stubVerifier, type VerifierAdapter } from '@/src/agents/verifier';
import { MemoryStateBus, STREAMS, type VerifiedTrendMessage } from '@/src/core/state';
import { score } from '@/src/core/scoring';
import { POVA_BRAND } from '../fixtures/pova-brand';
import { BRAND_KEYWORD_HITS } from '../fixtures/trends';

let bus: MemoryStateBus;

beforeEach(() => {
  bus = new MemoryStateBus({ redeliveryMs: 5000 });
});

afterEach(async () => {
  await bus.close();
});

describe('startVerifierAgent', () => {
  it('verifies trends with shouldVerify=true and publishes claims', async () => {
    startVerifierAgent({ bus, adapter: stubVerifier });

    const got: VerifiedTrendMessage[] = [];
    bus.subscribe(STREAMS.verifiedTrends, async (msg) => {
      got.push(msg.body);
      await bus.ack(STREAMS.verifiedTrends.name, msg.id);
    }, { group: 'sink' });

    const signal = BRAND_KEYWORD_HITS[0];
    const scoreResult = score(signal, { brand: POVA_BRAND });

    await bus.publish(STREAMS.scoredTrends, {
      signal,
      scoreResult,
      brandId: POVA_BRAND.id,
      fetchedAt: new Date(),
      shouldVerify: true,  // explicit
    });
    await new Promise(r => setTimeout(r, 50));

    expect(got).toHaveLength(1);
    expect(got[0].claims.length).toBeGreaterThan(0);
    expect(got[0].claims[0].sourceUrl).toBeTruthy();
    expect(got[0].claims[0].confidence).toBeGreaterThan(0);
  });

  it('skips trends where shouldVerify=false', async () => {
    startVerifierAgent({ bus, adapter: stubVerifier });

    const got: VerifiedTrendMessage[] = [];
    bus.subscribe(STREAMS.verifiedTrends, async (msg) => {
      got.push(msg.body);
      await bus.ack(STREAMS.verifiedTrends.name, msg.id);
    }, { group: 'no-verify-sink' });

    const signal = BRAND_KEYWORD_HITS[0];
    const scoreResult = score(signal, { brand: POVA_BRAND });

    await bus.publish(STREAMS.scoredTrends, {
      signal,
      scoreResult,
      brandId: POVA_BRAND.id,
      fetchedAt: new Date(),
      shouldVerify: false,
    });
    await new Promise(r => setTimeout(r, 50));

    expect(got).toHaveLength(0);
  });

  it('demotes low-confidence claims to unverifiedClaims', async () => {
    const flakyAdapter: VerifierAdapter = {
      async verify({ signal }) {
        return {
          summary: 'flaky',
          claims: [
            {
              id: 'high',
              key: 'price',
              value: '$500',
              sourceUrl: 'https://x.test/price',
              quotedSpan: 'priced at $500',
              confidence: 0.9,
            },
            {
              id: 'low',
              key: 'release',
              value: 'May 2026',
              sourceUrl: 'https://x.test/release',
              quotedSpan: 'maybe May, possibly June',
              confidence: 0.15,  // below 0.30 floor
            },
          ],
          unverifiedClaims: [],
          provider: 'test',
          model: 'flaky-test',
          tier: 'premium',
        };
      },
    };
    startVerifierAgent({ bus, adapter: flakyAdapter });

    const got: VerifiedTrendMessage[] = [];
    bus.subscribe(STREAMS.verifiedTrends, async (msg) => {
      got.push(msg.body);
      await bus.ack(STREAMS.verifiedTrends.name, msg.id);
    }, { group: 'flaky-sink' });

    const signal = BRAND_KEYWORD_HITS[0];
    const scoreResult = score(signal, { brand: POVA_BRAND });

    await bus.publish(STREAMS.scoredTrends, {
      signal, scoreResult, brandId: POVA_BRAND.id,
      fetchedAt: new Date(), shouldVerify: true,
    });
    await new Promise(r => setTimeout(r, 50));

    expect(got).toHaveLength(1);
    expect(got[0].claims).toHaveLength(1);
    expect(got[0].claims[0].key).toBe('price');
    expect(got[0].unverifiedClaims).toHaveLength(1);
    expect(got[0].unverifiedClaims[0].key).toBe('release');
    expect(got[0].unverifiedClaims[0].reason).toMatch(/confidence/);
  });
});
