// Connector registry tests — verify the ≤10-LoC pattern works end-to-end.

import { describe, expect, it, beforeEach } from 'vitest';
import {
  register,
  registerClassic,
  listRegistered,
  getRegistered,
  unregister,
} from '@/src/core/connectors/registry';
import type { ConnectorContext } from '@/src/core/connectors/registry';
import { mkSignal } from '../fixtures/trends';

const sampleCtx: ConnectorContext = {
  brandId: 't',
  brandName: 'POVA',
  brandKeywords: ['pova'],
  competitors: [],
  themes: [],
  since: new Date(),
  credentials: {},
};

describe('connector registry', () => {
  beforeEach(() => {
    // Clean slate per test
    for (const c of listRegistered()) unregister(c.id);
  });

  it('registers a connector with minimal spec', () => {
    register({
      id: 'tiny',
      source: 'reddit',
      poll: async () => [mkSignal({ title: 'tiny test' })],
    });
    const c = getRegistered('tiny');
    expect(c).toBeDefined();
    expect(c!.cadenceSec).toBe(90);   // default
    expect(c!.budgetUsdPerDay).toBe(0); // default
  });

  it('registers exactly N entries', () => {
    register({ id: 'a', source: 'reddit', poll: async () => [] });
    register({ id: 'b', source: 'news',   poll: async () => [] });
    register({ id: 'c', source: 'x',      poll: async () => [] });
    expect(listRegistered()).toHaveLength(3);
  });

  it('replaces prior registration on duplicate id (idempotent for HMR)', () => {
    register({ id: 'dup', source: 'reddit', poll: async () => [], cadenceSec: 90 });
    register({ id: 'dup', source: 'reddit', poll: async () => [], cadenceSec: 200 });
    expect(listRegistered()).toHaveLength(1);
    expect(getRegistered('dup')!.cadenceSec).toBe(200);
  });

  it('poll function returns RawSignal[]', async () => {
    register({
      id: 'fixture',
      source: 'reddit',
      poll: async (ctx) => [
        mkSignal({ title: `hi ${ctx.brandName}` }),
      ],
    });
    const c = getRegistered('fixture')!;
    const signals = await c.poll(sampleCtx);
    expect(signals).toHaveLength(1);
    expect(signals[0].title).toBe('hi POVA');
  });

  it('registerClassic adapts a Connector class instance', async () => {
    const fakeClassic = {
      id: 'fake_classic',
      source: 'news' as const,
      mode: 'live' as const,
      poll: async () => ({
        ok: true as const,
        source: 'news' as const,
        mode: 'live' as const,
        signals: [mkSignal({ title: 'classic-style' })],
        fetchedAt: new Date(),
      }),
    };
    registerClassic(fakeClassic);
    const c = getRegistered('fake_classic')!;
    const signals = await c.poll(sampleCtx);
    expect(signals).toHaveLength(1);
    expect(signals[0].title).toBe('classic-style');
  });

  it('registerClassic propagates errors when the underlying connector fails', async () => {
    const broken = {
      id: 'broken_classic',
      source: 'youtube' as const,
      mode: 'live' as const,
      poll: async () => ({
        ok: false as const,
        source: 'youtube' as const,
        mode: 'live' as const,
        reason: 'http_500',
      }),
    };
    registerClassic(broken);
    await expect(getRegistered('broken_classic')!.poll(sampleCtx)).rejects.toThrow(/http_500/);
  });

  it('unregister removes a connector', () => {
    register({ id: 'goner', source: 'reddit', poll: async () => [] });
    expect(getRegistered('goner')).toBeDefined();
    expect(unregister('goner')).toBe(true);
    expect(getRegistered('goner')).toBeUndefined();
    expect(unregister('does_not_exist')).toBe(false);
  });
});
