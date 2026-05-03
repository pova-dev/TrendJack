// Per-org AI budget tracker.
//
// Keeps an in-memory ledger of how much each org has spent on LLM calls
// today (USD), and a per-org daily cap. The provider layer
// (lib/ai/provider.ts) checks isOverBudget(orgId) before dispatching a
// call and recordCost(orgId, usd) after the call returns. The Architect
// agent's budgetSnapshot reads the same singleton so the dashboard can
// surface budget telemetry without a second source of truth.
//
// Caps are read from env at module-init:
//
//   TJ_AI_BUDGET_DAILY_USD             — default cap for all orgs
//   TJ_AI_BUDGET_DAILY_USD_<orgId>     — per-org override (rare)
//
// Cap = 0 means "no AI calls allowed" (useful for free-tier orgs that
// haven't connected a key). Cap = unset / Infinity means unlimited.
//
// Spend is reset at the next UTC midnight via a setTimeout chain. The
// in-memory ledger is intentional: we don't persist daily spend to the
// DB because (a) the truth source is the provider's own dashboard and
// (b) per-second writes for a tracker is overkill. After a process
// restart, the ledger zeros out — which is fine; the provider's hard
// cap is the safety net.

import 'server-only';

const DAY_MS = 24 * 60 * 60 * 1000;

interface BudgetState {
  spentUsd: number;
  capUsd: number;
}

const ledger = new Map<string, BudgetState>();
let lastReset = startOfUtcDay(Date.now());

function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function maybeRollover(): void {
  const now = Date.now();
  if (now - lastReset >= DAY_MS) {
    for (const v of ledger.values()) v.spentUsd = 0;
    lastReset = startOfUtcDay(now);
  }
}

function readCapFromEnv(orgId: string): number {
  const perOrg = process.env[`TJ_AI_BUDGET_DAILY_USD_${orgId}`];
  if (perOrg !== undefined) return parseCap(perOrg);
  const global = process.env.TJ_AI_BUDGET_DAILY_USD;
  if (global !== undefined) return parseCap(global);
  return Infinity;
}

function parseCap(raw: string): number {
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return Infinity;
  return n;
}

function getOrInit(orgId: string): BudgetState {
  maybeRollover();
  let s = ledger.get(orgId);
  if (!s) {
    s = { spentUsd: 0, capUsd: readCapFromEnv(orgId) };
    ledger.set(orgId, s);
  }
  return s;
}

export function isOverBudget(orgId: string | undefined): boolean {
  if (!orgId) return false;
  const s = getOrInit(orgId);
  return s.spentUsd >= s.capUsd;
}

export function remainingBudget(orgId: string | undefined): number {
  if (!orgId) return Infinity;
  const s = getOrInit(orgId);
  return Math.max(0, s.capUsd - s.spentUsd);
}

export function recordCost(orgId: string | undefined, costUsd: number): void {
  if (!orgId || costUsd <= 0) return;
  const s = getOrInit(orgId);
  s.spentUsd += costUsd;
}

export function budgetSnapshot(): Record<string, BudgetState> {
  maybeRollover();
  const out: Record<string, BudgetState> = {};
  for (const [k, v] of ledger.entries()) out[k] = { ...v };
  return out;
}

// Per-model cost rates: USD per 1M tokens, [input, output].
// Source: provider pricing pages (anthropic.com/pricing, openai.com/pricing,
// ai.google.dev/pricing, openrouter.ai/models). Pin a conservative rate so
// occasional drift doesn't undercount.
const RATES: Record<string, [number, number]> = {
  // Anthropic
  'claude-sonnet-4-5':  [3.0,  15.0],
  'claude-haiku-4-5':   [1.0,   5.0],
  // OpenAI
  'gpt-4o':             [2.5,  10.0],
  'gpt-4o-mini':        [0.15,  0.6],
  // Google
  'gemini-2.5-pro':     [1.25, 10.0],
  'gemini-2.5-flash':   [0.075, 0.3],
  'gemini-2.0-flash-001': [0.075, 0.3],
  // OpenRouter passthroughs (mirror upstream)
  'anthropic/claude-sonnet-4-5':         [3.0,  15.0],
  'meta-llama/llama-3.3-70b-instruct':   [0.35, 0.4],
  'google/gemini-2.0-flash-001':         [0.075, 0.3],
};

export function estimateCostUsd(
  model: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): number {
  if (!model || (!inputTokens && !outputTokens)) return 0;
  const rate = RATES[model];
  if (!rate) {
    // Unknown model — fall back to a conservative estimate (Sonnet rate)
    // so we don't silently undercount premium calls on a new model.
    return ((inputTokens ?? 0) * 3 + (outputTokens ?? 0) * 15) / 1_000_000;
  }
  return ((inputTokens ?? 0) * rate[0] + (outputTokens ?? 0) * rate[1]) / 1_000_000;
}
