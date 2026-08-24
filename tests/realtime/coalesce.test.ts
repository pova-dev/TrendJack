// Coalescer tests.
//
// The number that matters: a burst of ingest events must collapse to a small
// constant number of refetches, not one per event. Before coalescing, an idle
// board issued ~125 requests/minute (~7,500/hour) because every inserted trend
// published its own SSE event and every event refetched 200 trends.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createCoalescer } from '@/lib/realtime/coalesce';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createCoalescer', () => {
  it('collapses a burst of 120 events into ONE run', async () => {
    const fn = vi.fn(async () => {});
    const c = createCoalescer(fn, 1_500);

    // One cron tick inserting 120 trends.
    for (let i = 0; i < 120; i++) c.trigger();
    expect(fn).not.toHaveBeenCalled();   // nothing fires during the burst

    await vi.advanceTimersByTimeAsync(1_500);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs again for a genuinely separate burst', async () => {
    const fn = vi.fn(async () => {});
    const c = createCoalescer(fn, 1_000);

    c.trigger();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fn).toHaveBeenCalledTimes(1);

    c.trigger();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('never runs two at once, and schedules exactly one tail run', async () => {
    let active = 0;
    let maxActive = 0;
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });

    const fn = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await gate;
      active--;
    });

    const c = createCoalescer(fn, 100);
    c.trigger();
    await vi.advanceTimersByTimeAsync(100);   // first run starts, blocks on gate
    expect(fn).toHaveBeenCalledTimes(1);

    // 50 more events land while the request is in flight.
    for (let i = 0; i < 50; i++) c.trigger();
    await vi.advanceTimersByTimeAsync(100);

    release();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    // Exactly one follow-up, not 50.
    expect(fn).toHaveBeenCalledTimes(2);
    expect(maxActive, 'two requests overlapped').toBe(1);
  });

  it('cancel prevents a pending run', async () => {
    const fn = vi.fn(async () => {});
    const c = createCoalescer(fn, 1_000);

    c.trigger();
    c.cancel();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('a rejecting run does not wedge the coalescer', async () => {
    // If a failed refetch left inFlight stuck true, the board would freeze on
    // stale data forever. The finally block is what prevents that.
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(undefined);
    const c = createCoalescer(fn as unknown as () => Promise<void>, 100);

    c.trigger();
    await vi.advanceTimersByTimeAsync(100);

    c.trigger();
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('flush bypasses the debounce', async () => {
    const fn = vi.fn(async () => {});
    const c = createCoalescer(fn, 10_000);

    c.trigger();
    await c.flush();
    expect(fn).toHaveBeenCalledTimes(1);

    // The pending timer was consumed, so nothing fires later.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('sustained event storm stays proportional to time, not event count', async () => {
    const fn = vi.fn(async () => {});
    const c = createCoalescer(fn, 1_500);

    // 10 minutes of ingest at 2 events/second = 1,200 events.
    for (let sec = 0; sec < 600; sec++) {
      c.trigger(); c.trigger();
      await vi.advanceTimersByTimeAsync(1_000);
    }

    // Debounce keeps resetting under continuous load, so runs stay far below
    // the old one-per-event behaviour. The point is the order of magnitude.
    expect(fn.mock.calls.length).toBeLessThan(60);
  });
});
