// Architect Agent.
//
// The orchestrator. Watches the bus's `pending()` for stuck messages,
// surfaces per-org budget telemetry from lib/ai/budget, and publishes DLQ
// entries to the audit log for unrecoverable failures.
//
// Design: Architect runs as a singleton process (one per Node instance).
// It owns no agent-specific logic — it's the meta-layer that keeps the
// other agents healthy.
//
// Budget enforcement is NOT done here — it's done at the call site by
// runChat() in lib/ai/provider.ts, which checks isOverBudget(orgId)
// before dispatching and recordCost(orgId, usd) after a successful call.
// This agent just exposes the live snapshot for telemetry.
//
// DLQ (Audit 2026-05-29 U5): when a message is stuck for `dlqThresholdMs`
// (default 5 minutes), the Architect writes a `architect.dlq` entry to the
// auditLog so operators can see WHICH agent group is stuck on WHICH
// messageId. No new schema, and the audit page already renders it.
//
// Caveat: AuditLog.orgId is REQUIRED, but the Architect is a per-process
// singleton and PendingInfo carries no tenant. So the DB write only happens
// when the operator explicitly names an owning org via `dlqOrgId` (a
// self-hosted, single-tenant deploy). Without it we log to stderr instead —
// writing infra events into an arbitrary tenant's audit log would both
// mislead that operator and violate the no-cross-tenant rule in CLAUDE.md.

import type { StateBus, PendingInfo } from '@/src/core/state';
import { budgetSnapshot as readBudgetSnapshot } from '@/lib/ai/budget';
import { prisma } from '@/lib/db';

export interface ArchitectDeps {
  bus: StateBus;
  /** Consumer groups to monitor. The Architect inspects pending() for each. */
  monitorGroups?: string[];
  /** How often to scan pending entries. Default 30s. */
  scanIntervalMs?: number;
  /** Pending messages older than this (ms) are considered "stuck" and
   *  surfaced via the onStuck callback. Default 60s. */
  stuckThresholdMs?: number;
  /** Pending messages older than this (ms) are considered "unrecoverable"
   *  and published to the DLQ (auditLog with action `architect.dlq`).
   *  Default 5 min. Must be > stuckThresholdMs. */
  dlqThresholdMs?: number;
  /** Per-org daily budget caps for AI calls (USD). Architect enforces
   *  by gating Verifier / Creative invocations when budgetSpentUsd ≥ cap. */
  budgetCapsByOrg?: Record<string, number>;
  /** Callback when a stuck message is detected. */
  onStuck?: (info: PendingInfo) => void;
  /** Callback when a message crosses the DLQ threshold. Defaults to the
   *  built-in audit-log writer. Set to a no-op to disable. */
  onDlq?: (info: PendingInfo & { group: string }) => void | Promise<void>;
  /** Org that owns infrastructure-level DLQ entries. Required for the
   *  default handler to persist to `auditLog` (AuditLog.orgId is non-null).
   *  Unset — the multi-tenant default — logs to stderr only. */
  dlqOrgId?: string;
}

export interface ArchitectHandle {
  stop: () => void;
  /** Imperative scan trigger — useful for tests. */
  scanNow: () => Promise<void>;
  /** Return current per-org budget telemetry. */
  budgetSnapshot: () => Record<string, { spentUsd: number; capUsd: number }>;
}

const DEFAULT_GROUPS = ['filter-agent', 'verifier-agent', 'creative-agent', 'lineage-agent'];

// Default DLQ sink — writes a single auditLog row per stuck message.
// Idempotency: we tag each (group, msgId) we've already DLQ'd in this
// process to avoid filling the log with one entry per scan.
const DLQ_SEEN = new Set<string>();
export async function defaultDlqHandler(
  info: PendingInfo & { group: string },
  orgId?: string,
): Promise<void> {
  const key = `${info.group}:${info.msgId}`;
  if (DLQ_SEEN.has(key)) return;
  DLQ_SEEN.add(key);

  const meta = {
    group: info.group,
    stream: info.streamName,
    consumerGroup: info.consumerGroup,
    consumerName: info.consumerName,
    idleMs: info.idleMs,
    deliveryCount: info.deliveryCount,
  };

  // No owning org — stderr is the honest sink. Still deduped by DLQ_SEEN so
  // a permanently stuck message logs once, not once per 30s scan.
  if (!orgId) {
    console.error('[architect] DLQ', JSON.stringify({ msgId: info.msgId, ...meta }));
    return;
  }

  try {
    await prisma.auditLog.create({
      data: {
        orgId,
        action: 'architect.dlq',
        target: info.msgId,
        meta: JSON.stringify(meta),
      },
    });
  } catch (e) {
    // Last-resort: don't let DB hiccups blow up the architect. The
    // in-memory DLQ_SEEN set still prevents flooding the scanner.
    console.error('[architect] failed to write DLQ entry', (e as Error).message);
  }
}

export function startArchitectAgent(deps: ArchitectDeps): ArchitectHandle {
  const groups = deps.monitorGroups ?? DEFAULT_GROUPS;
  const scanIntervalMs = deps.scanIntervalMs ?? 30_000;
  const stuckThresholdMs = deps.stuckThresholdMs ?? 60_000;
  const dlqThresholdMs = deps.dlqThresholdMs ?? 5 * 60_000;
  const onDlq = deps.onDlq ?? ((info: PendingInfo & { group: string }) => defaultDlqHandler(info, deps.dlqOrgId));
  const caps = deps.budgetCapsByOrg ?? {};
  const spent: Record<string, number> = {};
  let stopped = false;

  async function scanNow(): Promise<void> {
    if (stopped) return;
    for (const group of groups) {
      try {
        const pending = await deps.bus.pending(group);
        for (const p of pending) {
          if (p.idleMs > dlqThresholdMs) {
            // Crossed the DLQ threshold — record it.
            await onDlq({ ...p, group });
          } else if (p.idleMs > stuckThresholdMs) {
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
      // Live snapshot from the provider-level tracker (lib/ai/budget).
      // The local `caps` / `spent` maps are kept for backwards compat with
      // tests that injected explicit caps, but the canonical store is the
      // singleton tracker that runChat() reads + writes per call.
      const live = readBudgetSnapshot();
      const out: Record<string, { spentUsd: number; capUsd: number }> = { ...live };
      for (const orgId of new Set([...Object.keys(spent), ...Object.keys(caps)])) {
        if (!out[orgId]) {
          out[orgId] = { spentUsd: spent[orgId] ?? 0, capUsd: caps[orgId] ?? Infinity };
        }
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
