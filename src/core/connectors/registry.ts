// Connector registry — the ≤10-LoC pattern for adding new sources.
//
// Adding a connector:
//
//   import { register } from '@/src/core/connectors/registry';
//   register({
//     id: 'tiktok_official',
//     source: 'tiktok',
//     poll: async (ctx) => fetchTikTokTrending(ctx),  // returns RawSignal[]
//     cadenceSec: 120,                                 // optional, default 90
//     budgetUsdPerDay: 5,                              // optional cap (Phase 8)
//   });
//
// That's it. The registry handles scheduling, scout integration, dedup
// keys, and (Phase 8) budget tracking. The legacy class-based `Connector`
// interface in lib/connectors/types.ts is preserved for the existing 9
// implementations — `registerClassic()` adapts a Connector instance to
// the new shape so we don't have to rewrite anything.

import type { RawSignal } from '@/src/core/scoring/types';
import type { SourceId } from '@/types';
import type { Connector } from '@/lib/connectors/types';

export interface ConnectorContext {
  brandId: string;
  brandName: string;
  brandKeywords: string[];
  competitors: string[];
  themes: string[];
  since: Date;
  /** Per-org credentials (X bearer, YouTube key, Google Alerts feed URLs, etc.) */
  credentials: Record<string, string>;
}

export interface RegisteredConnector {
  id: string;
  source: SourceId;
  /** How often the Architect re-polls. Defaults to 90s (matching legacy cron). */
  cadenceSec: number;
  /** Soft daily cost cap in USD. Architect Agent enforces. 0 = no API cost. */
  budgetUsdPerDay: number;
  /** The actual fetch. Returns normalized RawSignal[]. */
  poll: (ctx: ConnectorContext) => Promise<RawSignal[]>;
  /** When to fall back / never fire. Currently informational; Phase 8 wires
   *  this into the Architect's gating. */
  requires?: string[];
}

const REGISTRY = new Map<string, RegisteredConnector>();

/** Register a connector. Idempotent — calling twice with the same id
 *  replaces the prior registration (useful for HMR in dev). */
export function register(opts: {
  id: string;
  source: SourceId;
  poll: (ctx: ConnectorContext) => Promise<RawSignal[]>;
  cadenceSec?: number;
  budgetUsdPerDay?: number;
  requires?: string[];
}): void {
  REGISTRY.set(opts.id, {
    id: opts.id,
    source: opts.source,
    cadenceSec: opts.cadenceSec ?? 90,
    budgetUsdPerDay: opts.budgetUsdPerDay ?? 0,
    poll: opts.poll,
    requires: opts.requires,
  });
}

/** Wrap a legacy class-based Connector so it conforms to the registry shape.
 *  Existing 9 connectors register through this without rewrites. */
export function registerClassic(c: Connector, opts: {
  cadenceSec?: number;
  budgetUsdPerDay?: number;
} = {}): void {
  register({
    id: c.id,
    source: c.source,
    cadenceSec: opts.cadenceSec,
    budgetUsdPerDay: opts.budgetUsdPerDay,
    poll: async (ctx) => {
      const result = await c.poll({
        since: ctx.since,
        brandKeywords: ctx.brandKeywords,
        competitors: ctx.competitors,
        themes: ctx.themes,
        limit: 50,
        credentials: ctx.credentials,
      });
      if (!result.ok) {
        throw new Error(result.reason);
      }
      return result.signals;
    },
  });
}

export function getRegistered(id: string): RegisteredConnector | undefined {
  return REGISTRY.get(id);
}

export function listRegistered(): RegisteredConnector[] {
  return Array.from(REGISTRY.values());
}

export function unregister(id: string): boolean {
  return REGISTRY.delete(id);
}
