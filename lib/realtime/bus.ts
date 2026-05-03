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
  publish(channel: string, event: RTEvent) { this.ee.emit(channel, event); }
  subscribe(channel: string, handler: (e: RTEvent) => void): () => void {
    this.ee.on(channel, handler);
    return () => this.ee.off(channel, handler);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __tj_bus: Bus | undefined;
}

export const bus = global.__tj_bus ?? new Bus();
if (!global.__tj_bus) global.__tj_bus = bus;

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
