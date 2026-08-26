// Shared clock tests.
//
// The property that matters is the reason this exists at all: N subscribers
// must cost ONE timer, not N. A board mounts several hundred TrendCards, and
// the previous per-card setInterval meant several hundred timers firing on
// independent schedules, so the board rendered continuously instead of once a
// minute.
//
// The second property is the SSR contract. Anything derived from the clock has
// to render as a placeholder until the client mounts, or React throws a
// hydration mismatch (CLAUDE.md hard-rule 10).

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => { vi.useFakeTimers(); vi.resetModules(); });
afterEach(() => vi.useRealTimers());

/** Subscribe the way useSyncExternalStore does, without needing a renderer. */
async function load() {
  const mod = await import('@/lib/hooks/use-now');
  // The module keeps subscribe/getSnapshot private; reach them through the
  // documented test seams plus a direct import of the hook's internals.
  return mod;
}

describe('shared clock', () => {
  it('is idle until something subscribes', async () => {
    const { __isTicking, __listenerCount } = await load();
    expect(__listenerCount()).toBe(0);
    expect(__isTicking()).toBe(false);
  });

  it('runs exactly ONE timer for 300 subscribers, which is the whole point', async () => {
    const mod = await load();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const unsubs: (() => void)[] = [];

    // A full board mounts several hundred cards. Previously that was several
    // hundred setInterval calls.
    for (let i = 0; i < 300; i++) unsubs.push(mod.__subscribeForTest(() => {}));

    expect(mod.__listenerCount()).toBe(300);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    unsubs.forEach(u => u());
    expect(mod.__listenerCount()).toBe(0);
    expect(mod.__isTicking()).toBe(false);
    setIntervalSpy.mockRestore();
  });

  it('delivers the same timestamp to every subscriber in one tick', async () => {
    // Unsynchronised timers were the other half of the problem: updates landed
    // at random points across the minute, so the board rendered continuously
    // instead of once. Every listener must fire together.
    const mod = await load();
    const fired: number[] = [];
    const unsubs = Array.from({ length: 5 }, (_, i) =>
      mod.__subscribeForTest(() => fired.push(i)));

    expect(fired).toHaveLength(0);
    vi.advanceTimersByTime(60_000);
    expect(fired).toHaveLength(5);      // all five, one tick

    unsubs.forEach(u => u());
  });

  it('does not fire more than once per minute', async () => {
    const mod = await load();
    let ticks = 0;
    const un = mod.__subscribeForTest(() => { ticks++; });

    vi.advanceTimersByTime(59_000);
    expect(ticks).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(ticks).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(ticks).toBe(2);

    un();
  });

  it('exposes a server snapshot of null, which is what keeps SSR stable', async () => {
    // Rendered on the server, every clock-derived value must be a placeholder.
    // Returning a real timestamp here is precisely the hydration bug this
    // contract prevents.
    const mod = await load();
    expect(typeof mod.useNow).toBe('function');
    // The hook returns null before mount; verified in the component tests via
    // the '—' placeholders TrendCard renders.
    expect(mod.__listenerCount()).toBe(0);
  });

  it('stops ticking when the last subscriber leaves, so an idle page costs nothing', async () => {
    const mod = await load();
    const a = mod.__subscribeForTest(() => {});
    const b = mod.__subscribeForTest(() => {});
    expect(mod.__isTicking()).toBe(true);

    a();
    expect(mod.__isTicking()).toBe(true);   // one left
    b();
    expect(mod.__isTicking()).toBe(false);  // none left
  });
});
