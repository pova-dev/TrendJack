// Per-source backoff + error budget.
//
// When a connector fails repeatedly we don't want to keep hammering it
// every tick. Standard exponential backoff with a ceiling:
//
//   - Each consecutive failure doubles the cooldown (60s → 120s → 240s … → cap)
//   - A successful poll resets the cooldown to 0
//   - During cooldown, the Scout reports the connector as "skipped" rather
//     than calling poll() at all
//
// The state is kept in memory per-process. Across restarts we lose backoff
// state — that's intentional; we want to retry a previously-failing source
// after a deploy in case the upstream issue is fixed.

interface ConnectorState {
  consecutiveFailures: number;
  cooldownUntil: number;
  lastFailureReason: string | null;
}

const DEFAULT_FIRST_COOLDOWN_MS = 60_000;     // 1 min
const DEFAULT_MAX_COOLDOWN_MS   = 30 * 60_000; // 30 min cap
const DEFAULT_MULTIPLIER         = 2;

export interface BackoffOpts {
  firstCooldownMs?: number;
  maxCooldownMs?: number;
  multiplier?: number;
  /** Override `Date.now()` — for tests. */
  now?: () => number;
}

export class BackoffTracker {
  private states = new Map<string, ConnectorState>();
  private readonly firstCooldownMs: number;
  private readonly maxCooldownMs: number;
  private readonly multiplier: number;
  private readonly now: () => number;

  constructor(opts: BackoffOpts = {}) {
    this.firstCooldownMs = opts.firstCooldownMs ?? DEFAULT_FIRST_COOLDOWN_MS;
    this.maxCooldownMs   = opts.maxCooldownMs   ?? DEFAULT_MAX_COOLDOWN_MS;
    this.multiplier      = opts.multiplier      ?? DEFAULT_MULTIPLIER;
    this.now             = opts.now             ?? (() => Date.now());
  }

  /** Should the Scout skip this connector right now? */
  isInCooldown(connectorId: string): boolean {
    const s = this.states.get(connectorId);
    if (!s) return false;
    return s.cooldownUntil > this.now();
  }

  /** Milliseconds until the cooldown lifts. 0 if not in cooldown. */
  cooldownRemaining(connectorId: string): number {
    const s = this.states.get(connectorId);
    if (!s) return 0;
    return Math.max(0, s.cooldownUntil - this.now());
  }

  /** Last failure reason for a connector, if any. */
  lastFailure(connectorId: string): string | null {
    return this.states.get(connectorId)?.lastFailureReason ?? null;
  }

  /** Record a successful poll — resets backoff. */
  recordSuccess(connectorId: string): void {
    this.states.delete(connectorId);
  }

  /** Record a failure — increases the cooldown. */
  recordFailure(connectorId: string, reason: string): void {
    const prior = this.states.get(connectorId);
    const failures = (prior?.consecutiveFailures ?? 0) + 1;
    const cooldown = Math.min(
      this.maxCooldownMs,
      this.firstCooldownMs * Math.pow(this.multiplier, failures - 1),
    );
    this.states.set(connectorId, {
      consecutiveFailures: failures,
      cooldownUntil: this.now() + cooldown,
      lastFailureReason: reason,
    });
  }

  /** Snapshot of current state — for telemetry / dashboard / debugging. */
  snapshot(): Array<{
    connectorId: string;
    consecutiveFailures: number;
    cooldownRemainingMs: number;
    lastFailureReason: string | null;
  }> {
    const out: ReturnType<BackoffTracker['snapshot']> = [];
    for (const [id, s] of this.states) {
      out.push({
        connectorId: id,
        consecutiveFailures: s.consecutiveFailures,
        cooldownRemainingMs: Math.max(0, s.cooldownUntil - this.now()),
        lastFailureReason: s.lastFailureReason,
      });
    }
    return out;
  }
}

/** Module-level singleton — used by the live Scout. Tests construct their
 *  own tracker for isolation. */
export const backoffTracker = new BackoffTracker();
