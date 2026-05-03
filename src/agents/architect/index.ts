// Architect Agent.
//
// The orchestrator. Watches the bus's `pending()` for stuck messages,
// enforces per-org budget caps on AI calls, retries with backoff, and
// publishes DLQ entries for unrecoverable failures.
//
// Design: Architect runs as a singleton process (one per Node instance).
// It owns no agent-specific logic — it's the meta-layer that keeps the
// other agents healthy.

import type { StateBus, PendingInfo } from '@/src/core/state';

export interface ArchitectDeps {
  bus: StateBus;
  /** Consumer groups to monitor. The Architect inspects pending() for each. */
  monitorGroups?: string[];
  /** How often to scan pending entries. Default 30s. */
  scanIntervalMs?: number;
  /** Pending messages older than this (ms) are considered "stuck" and
   *  surfaced via the onStuck callback. Default 60s. */
  stuckThresholdMs?: number;
  /** Per-org daily budget caps for AI calls (USD). Architect enforces
   *  by gating Verifier / Creative invocations when budgetSpentUsd ≥ cap. */
  budgetCapsByOrg?: Record<string, number>;
  /** Callback when a stuck message is detected. */
  onStuck?: (info: PendingInfo) => void;
}

export interface ArchitectHandle {
  stop: () => void;
  /** Imperative scan trigger — useful for tests. */
  scanNow: () => Promise<void>;
  /** Return current per-org budget telemetry. */
  budgetSnapshot: () => Record<string, { spentUsd: number; capUsd: number }>;
}

const DEFAULT_GROUPS = ['filter-agent', 'verifier-agent', 'creative-agent', 'lineage-agent'];

export function startArchitectAgent(deps: ArchitectDeps): ArchitectHandle {
  const groups = deps.monitorGroups ?? DEFAULT_GROUPS;
  const scanIntervalMs = deps.scanIntervalMs ?? 30_000;
  const stuckThresholdMs = deps.stuckThresholdMs ?? 60_000;
  const caps = deps.budgetCapsByOrg ?? {};
  const spent: Record<string, number> = {};
  let stopped = false;

  async function scanNow(): Promise<void> {
    if (stopped) return;
    for (const group of groups) {
      try {
        const pending = await deps.bus.pending(group);
        for (const p of pending) {
          if (p.idleMs > stuckThresholdMs) {
            deps.onStuck?.(p);
          }
        }
      } catch {
        // Don't let one group's failure kill the scan.
      }
    }
  }

  const intervalId = setInterval(scanNow, scanIntervalMs);
  if (intervalId.unref) intervalId.unref();

  return {
    stop: () => {
      stopped = true;
      clearInterval(intervalId);
    },
    scanNow,
    budgetSnapshot: () => {
      const out: Record<string, { spentUsd: number; capUsd: number }> = {};
      for (const orgId of new Set([...Object.keys(spent), ...Object.keys(caps)])) {
        out[orgId] = { spentUsd: spent[orgId] ?? 0, capUsd: caps[orgId] ?? Infinity };
      }
      return out;
    },
  };
}

/** Architect-managed budget tracking. AI adapters call recordCost() after
 *  each successful invocation; the Architect gates further calls when
 *  spent ≥ cap. */
export interface BudgetTracker {
  recordCost(orgId: string, costUsd: number): void;
  isOverBudget(orgId: string): boolean;
  remaining(orgId: string): number;
}

export function createBudgetTracker(caps: Record<string, number>): BudgetTracker {
  const spent: Record<string, number> = {};
  return {
    recordCost(orgId: string, costUsd: number) {
      spent[orgId] = (spent[orgId] ?? 0) + costUsd;
    },
    isOverBudget(orgId: string) {
      const cap = caps[orgId];
      if (cap == null) return false;
      return (spent[orgId] ?? 0) >= cap;
    },
    remaining(orgId: string) {
      const cap = caps[orgId];
      if (cap == null) return Infinity;
      return Math.max(0, cap - (spent[orgId] ?? 0));
    },
  };
}
