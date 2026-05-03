// Scout Agent runner.
//
// Pulls from every registered connector IN PARALLEL and produces a
// ScoutRunReport. Honors per-source backoff: connectors in cooldown are
// skipped without invoking poll(). Each connector gets its own per-call
// timeout so a slow source can't drag down faster ones.
//
// This is the structural fix for the "sequential connector polling"
// audit finding. Worst-case latency before: SUM of all connector
// timeouts (Invidious 13s × 9 connectors = 117s). After: MAX latency
// of the slowest connector that actually responded (~13s ceiling).

import type { ScoutContext, ScoutPollOutcome, ScoutRunReport, ConnectorFn } from './types';
import { connectorFn } from './types';
import { BackoffTracker, backoffTracker as defaultBackoff } from './backoff';
import { getBus, STREAMS } from '@/src/core/state';
import type { Connector } from '@/lib/connectors/types';
import type { StateBus } from '@/src/core/state';

export interface ScoutRunOpts {
  /** Connectors to poll. Each gets its own timeout + backoff entry. */
  connectors: Array<{ id: string; source: string; fn: ConnectorFn }>;
  /** Per-connector poll timeout. Defaults to 15s. */
  perPollTimeoutMs?: number;
  /** Backoff tracker. Defaults to the module singleton. Tests pass their own. */
  backoff?: BackoffTracker;
  /** Optional StateBus override. Defaults to the singleton from @/src/core/state. */
  bus?: StateBus;
  /** When true, do NOT publish to STREAMS.rawSignals. Used by tests + by the
   *  legacy ingestForBrand() shim that handles persistence itself. */
  dryRun?: boolean;
}

export async function runScout(
  ctx: ScoutContext,
  opts: ScoutRunOpts,
): Promise<ScoutRunReport> {
  const startedAt = new Date();
  const startMs = startedAt.getTime();
  const backoff = opts.backoff ?? defaultBackoff;
  const timeoutMs = opts.perPollTimeoutMs ?? 15_000;

  // Run all connectors in parallel. Each Promise resolves to a
  // ScoutPollOutcome — never rejects, so one failure can't take down the
  // whole batch.
  const outcomes = await Promise.all(
    opts.connectors.map(c => pollOne(c, ctx, timeoutMs, backoff)),
  );

  const signals = outcomes.flatMap(o => o.signals);
  const failed = outcomes.filter(o => !o.ok).map(o => o.connectorId);

  // Publish to STREAMS.rawSignals so any downstream agent can consume.
  // Phase 4's Filter Agent subscribes here. The legacy ingest pipeline
  // continues to score+persist directly via the dryRun=true path.
  if (!opts.dryRun) {
    const bus = opts.bus ?? getBus();
    for (const o of outcomes) {
      if (!o.ok) continue;
      for (const sig of o.signals) {
        await bus.publish(STREAMS.rawSignals, {
          signal: sig,
          brandId: ctx.brandId,
          connectorId: o.connectorId,
          fetchedAt: new Date(),
        });
      }
    }
  }

  return {
    brandId: ctx.brandId,
    startedAt,
    totalLatencyMs: Date.now() - startMs,
    outcomes,
    signals,
    failed,
  };
}

async function pollOne(
  c: { id: string; source: string; fn: ConnectorFn },
  ctx: ScoutContext,
  timeoutMs: number,
  backoff: BackoffTracker,
): Promise<ScoutPollOutcome> {
  const startMs = Date.now();

  // Skip if cooled down.
  if (backoff.isInCooldown(c.id)) {
    return {
      connectorId: c.id,
      source: c.source,
      latencyMs: 0,
      signals: [],
      ok: false,
      reason: `in_cooldown_${Math.round(backoff.cooldownRemaining(c.id) / 1000)}s · last: ${backoff.lastFailure(c.id) ?? 'n/a'}`,
    };
  }

  try {
    const result = await Promise.race([
      c.fn(ctx),
      timeoutAfter(timeoutMs),
    ]);
    if (result.ok) {
      backoff.recordSuccess(c.id);
      return {
        connectorId: c.id,
        source: c.source,
        latencyMs: Date.now() - startMs,
        signals: result.signals,
        ok: true,
      };
    }
    const reason = result.reason ?? 'unknown';
    backoff.recordFailure(c.id, reason);
    return {
      connectorId: c.id,
      source: c.source,
      latencyMs: Date.now() - startMs,
      signals: [],
      ok: false,
      reason,
    };
  } catch (err) {
    const reason = (err as Error).message;
    backoff.recordFailure(c.id, reason);
    return {
      connectorId: c.id,
      source: c.source,
      latencyMs: Date.now() - startMs,
      signals: [],
      ok: false,
      reason,
    };
  }
}

function timeoutAfter(ms: number): Promise<{ ok: false; signals: never[]; reason: string }> {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      resolve({ ok: false, signals: [], reason: `poll_timeout_${ms}ms` });
    }, ms);
    if (t.unref) t.unref();
  });
}

// ---------------------------------------------------------------------------
// Convenience: build the default connector list from existing lib/connectors.
// ---------------------------------------------------------------------------

/** Wraps a Connector class instance so it conforms to the {id, source, fn}
 *  shape `runScout` expects. */
export function fromConnector(c: Connector): {
  id: string;
  source: string;
  fn: ConnectorFn;
} {
  return { id: c.id, source: c.source, fn: connectorFn(c) };
}
