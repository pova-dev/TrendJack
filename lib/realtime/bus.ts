// Realtime pub/sub bus.
//
// MVP adapter: in-process EventEmitter — works for single-instance dev/server.
// Multi-instance (Vercel/Edge/Postgres replicas) will need a Redis or NATS
// adapter; the public API below is shaped so swap-in is one file change.
//
// Channel naming convention: `<scope>:<id>:<resource>`
//   brand:<brandId>:trends    — new/updated/dismissed trend events
//   brand:<brandId>:profile   — brand profile mutations (broadcast to all
//                                viewers of that brand)
//   brand:<brandId>:weights   — scoring weight changes (top-5 reshuffle)
//   org:<orgId>:audit         — audit log tail

import EventEmitter from 'eventemitter3';
import type { RealtimeTransport } from './redis-bus';

export type RTEvent =
  | { type: 'trend.created'; brandId: string; trendId: string }
  | { type: 'trend.updated'; brandId: string; trendId: string; reason?: string }
  | { type: 'trend.dismissed'; brandId: string; trendId: string }
  | { type: 'brand.profile_changed'; brandId: string; fields: string[] }
  | { type: 'brand.weights_changed'; brandId: string }
  | { type: 'brand.crisis_toggle'; brandId: string; on: boolean }
  | { type: 'draft.created'; brandId: string; trendId: string; draftId: string }
  | { type: 'draft.shipped'; brandId: string; trendId: string; draftId: string }
  | { type: 'tick'; at: string };

class Bus {
  private ee = new EventEmitter();
  /** Set once Redis connects. Until then everything runs in-process, which is
   *  correct for a single server and for local development. */
  private transport: RealtimeTransport | null = null;
  /** Channels subscribed before a transport existed, so they can be bridged
   *  retroactively when one attaches. */
  private bridged = new Set<string>();
  private unbridge = new Map<string, () => void>();

  publish(channel: string, event: RTEvent) {
    // Emit locally first: subscribers on THIS instance should not wait for a
    // round trip through Redis to see an event this process produced.
    this.ee.emit(channel, event);
    // Then fan out to the other instances, if there are any.
    this.transport?.publish(channel, event);
  }

  subscribe(channel: string, handler: (e: RTEvent) => void): () => void {
    this.ee.on(channel, handler);
    this.ensureBridge(channel);
    return () => {
      this.ee.off(channel, handler);
      // The remote bridge stays for the channel's lifetime rather than being
      // torn down per listener; channels here are per-brand and long-lived, so
      // churning Redis subscriptions on every SSE reconnect would cost more
      // than it saves.
    };
  }

  /** One Redis subscription per channel, however many local listeners it has. */
  private ensureBridge(channel: string) {
    this.bridged.add(channel);
    if (!this.transport || this.unbridge.has(channel)) return;
    const off = this.transport.subscribe(channel, event => {
      // Re-emit remote events locally. Local publishes never come back through
      // here, because publish() emits directly rather than round-tripping.
      this.ee.emit(channel, event);
    });
    this.unbridge.set(channel, off);
  }

  /** Promote an already-running in-process bus onto a transport. Existing
   *  subscribers keep working; they simply start receiving remote events too. */
  attach(transport: RealtimeTransport) {
    this.transport = transport;
    for (const channel of this.bridged) this.ensureBridge(channel);
  }

  describe(): string {
    return this.transport ? this.transport.describe() : 'in-process (single instance only)';
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __tj_bus: Bus | undefined;
}

export const bus = global.__tj_bus ?? new Bus();
if (!global.__tj_bus) global.__tj_bus = bus;

declare global {
  // eslint-disable-next-line no-var
  var __tj_bus_init: boolean | undefined;
}

/**
 * Connect the realtime fan-out. Idempotent; safe to call at boot everywhere.
 *
 *   REDIS_URL set   → events reach every instance.
 *   REDIS_URL unset → in-process only. On a platform that runs several
 *                     instances by default that is almost certainly a mistake,
 *                     so it says so loudly rather than silently serving a
 *                     broken realtime layer to most users. That silence was
 *                     the actual defect being fixed here.
 */
export async function initRealtime(): Promise<void> {
  if (global.__tj_bus_init) return;
  global.__tj_bus_init = true;

  const url = process.env.REDIS_URL;
  if (!url) {
    const { looksMultiInstance } = await import('./redis-bus');
    if (looksMultiInstance()) {
      console.error(
        '[realtime] REDIS_URL is not set and this looks like a multi-instance deploy. ' +
        'Server-sent events only reach clients connected to THIS process, so live updates ' +
        'will stop working for most users with no error. Set REDIS_URL.',
      );
    } else {
      console.log('[realtime] in-process bus (single instance)');
    }
    return;
  }

  try {
    const { createRedisTransport, redactUrl } = await import('./redis-bus');
    bus.attach(await createRedisTransport(url));
    console.log(`[realtime] connected to ${redactUrl(url)} — events fan out across instances`);
  } catch (e) {
    // Deliberately not fatal. A Redis outage should degrade realtime to
    // single-instance, never take the dashboard down with it. Loud, so the
    // degradation is never a mystery.
    console.error('[realtime] Redis unavailable, using in-process bus:', (e as Error).message);
  }
}

/** Which transport is actually live. Surfaced by /api/health. */
export function realtimeStatus(): string {
  return bus.describe();
}

// Convenience helpers ---------------------------------------------------------

export function publishBrandTrend(brandId: string, event: Extract<RTEvent, { type: `trend.${string}` }>) {
  bus.publish(`brand:${brandId}:trends`, event);
}
export function publishBrandProfile(brandId: string, event: Extract<RTEvent, { type: `brand.${string}` }>) {
  bus.publish(`brand:${brandId}:profile`, event);
}
export function publishBrandWeights(brandId: string) {
  bus.publish(`brand:${brandId}:weights`, { type: 'brand.weights_changed', brandId });
}
