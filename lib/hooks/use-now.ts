'use client';
import * as React from 'react';

// One clock for the whole app.
//
// Every TrendCard used to run its own setInterval to refresh relative times.
// A board with eight columns mounts several hundred cards, so that was several
// hundred independent timers, each firing on its own schedule and triggering
// its own render. The work was not just duplicated, it was smeared: because
// each timer started whenever its card mounted, updates landed at random
// points across the minute instead of together, so the board was doing a
// trickle of layout work continuously rather than one batch per minute.
//
// A single module-level ticker fixes both. Subscribers share one timer, and
// they all receive the same timestamp in the same tick, which React batches
// into one render pass.
//
// The interval only runs while something is subscribed, so a page with no
// time-dependent UI costs nothing.

type Listener = () => void;

const listeners = new Set<Listener>();
let timer: ReturnType<typeof setInterval> | null = null;
let snapshot = 0;

/** Tick period. Relative times are rendered to the minute, so anything faster
 *  would re-render without changing a single visible character. */
const TICK_MS = 60_000;

function start() {
  if (timer) return;
  snapshot = Date.now();
  timer = setInterval(() => {
    snapshot = Date.now();
    for (const l of listeners) l();
  }, TICK_MS);
  // Never hold the process open for a clock.
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    (timer as unknown as { unref: () => void }).unref?.();
  }
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

function getSnapshot(): number {
  // First reader primes the clock, so a component mounting between ticks still
  // gets a real timestamp rather than 0.
  if (!snapshot) snapshot = Date.now();
  return snapshot;
}

/** Server renders have no clock, which is what keeps SSR output stable. */
function getServerSnapshot(): null {
  return null;
}

/**
 * Current time, shared across every subscriber, refreshed once a minute.
 *
 * Returns `null` on the server and on the first client render, then the real
 * timestamp. That is the same contract the per-card version had, and it is
 * what prevents a hydration mismatch: any value derived from the clock must
 * render as a placeholder until the client has mounted (CLAUDE.md hard-rule
 * 10). Callers keep gating on `now != null` exactly as before.
 */
export function useNow(): number | null {
  const value = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return mounted ? value : null;
}

/** Test seam: subscribe without a React renderer, so the one-timer-for-N-
 *  subscribers property can actually be asserted rather than assumed. */
export function __subscribeForTest(listener: Listener): () => void {
  return subscribe(listener);
}

/** Test seam: how many components currently share the clock. */
export function __listenerCount(): number {
  return listeners.size;
}

/** Test seam: whether the interval is running. */
export function __isTicking(): boolean {
  return timer !== null;
}
