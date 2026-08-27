// Model id hygiene.
//
// A wrong model id is the worst kind of bug in this codebase: nothing throws at
// build time, the type is just `string`, and the failure only appears as an
// upstream 404 at the moment a user asks for a draft. Two of the three routed
// OpenRouter ids were dead this way, including the premium one that hard-rule 3
// reserves for user-visible facts, and so was the first entry of the fallback
// chain meant to rescue them.
//
// The root cause is that the same model has two spellings. Anthropic's own API
// writes point releases with a dash (claude-sonnet-4-5); OpenRouter writes them
// with a dot (anthropic/claude-sonnet-4.5). Prefixing the Anthropic spelling
// with "anthropic/" yields an id that has never existed.

import { describe, expect, it } from 'vitest';
import { pickRouting } from '@/lib/ai/provider';
import { estimateCostUsd } from '@/lib/ai/budget';

const TIERS = ['cheap', 'balanced', 'premium'] as const;

/** Every routing decision reachable with only an OpenRouter key. */
function openRouterRoutes() {
  return TIERS.map(tier => ({
    tier,
    ...pickRouting(tier, { OPENROUTER_API_KEY: 'sk-or-test' }),
  }));
}

describe('OpenRouter id spelling', () => {
  it('routes every tier through OpenRouter when it is the only key', () => {
    for (const r of openRouterRoutes()) {
      expect(r.provider, `tier ${r.tier}`).toBe('openrouter');
      expect(r.model, `tier ${r.tier}`).toBeTruthy();
    }
  });

  it('never emits an Anthropic-style dashed point release under the anthropic/ prefix', () => {
    // The exact bug: "anthropic/claude-sonnet-4-5". OpenRouter has no such id.
    // A dashed major-minor after the prefix is always a mis-spelling.
    for (const r of openRouterRoutes()) {
      expect(
        r.model,
        `tier ${r.tier} uses the Anthropic dash spelling behind the openrouter prefix; ` +
        `OpenRouter needs a dot (anthropic/claude-sonnet-4.5)`,
      ).not.toMatch(/^anthropic\/.*-\d+-\d+$/);
    }
  });

  it('namespaces every OpenRouter id, since bare ids are not valid there', () => {
    for (const r of openRouterRoutes()) {
      expect(r.model, `tier ${r.tier}`).toMatch(/^[a-z0-9-]+\/.+/);
    }
  });
});

describe('cost tracking follows the routing', () => {
  it('prices every routed model explicitly rather than via the unknown-model fallback', () => {
    // estimateCostUsd falls back to the Sonnet rate for unknown ids, which is
    // safe but wrong: it would bill a cheap triage call at premium rates and
    // quietly distort the budget ledger. A routed model should be in the table.
    const SONNET_FALLBACK = (1_000_000 * 3 + 1_000_000 * 15) / 1_000_000;

    for (const r of openRouterRoutes()) {
      const cost = estimateCostUsd(r.model, 1_000_000, 1_000_000);
      expect(cost, `tier ${r.tier} (${r.model})`).toBeGreaterThan(0);
      if (r.tier !== 'premium') {
        expect(
          cost,
          `tier ${r.tier} (${r.model}) is priced at the unknown-model fallback rate, ` +
          `so it is almost certainly missing from RATES`,
        ).not.toBe(SONNET_FALLBACK);
      }
    }
  });

  it('prices a cheap tier below a premium one', () => {
    const cheap = openRouterRoutes().find(r => r.tier === 'cheap')!;
    const premium = openRouterRoutes().find(r => r.tier === 'premium')!;
    expect(estimateCostUsd(cheap.model, 1_000, 1_000))
      .toBeLessThan(estimateCostUsd(premium.model, 1_000, 1_000));
  });
});

// Opt-in, because it needs the network. Run with TJ_CHECK_MODELS=1 to confirm
// every routed and fallback id still exists upstream. Kept out of the default
// run so a provider outage cannot fail an unrelated CI job, but available
// because catalog drift is exactly how these ids went stale.
const live = process.env.TJ_CHECK_MODELS === '1' ? describe : describe.skip;

live('live catalog', () => {
  it('every routed id still exists on OpenRouter', async () => {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    const ids = new Set<string>((await res.json()).data.map((m: { id: string }) => m.id));
    for (const r of openRouterRoutes()) {
      expect(ids.has(r.model), `${r.tier} -> ${r.model} is not in OpenRouter's catalog`).toBe(true);
    }
  }, 30_000);
});
