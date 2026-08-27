// Cost-aware AI provider abstraction.
//
// Tasks have a tier: 'cheap' | 'balanced' | 'premium'.
//   cheap   — quick classification, reformatting, short summaries
//   balanced— research summaries, draft generation
//   premium — high-stakes brand-tone tasks (cringe arbitration, crisis copy)
//
// Supported providers:
//   - anthropic  (Claude direct)
//   - openai     (GPT-4o family)
//   - google     (Gemini direct via generativelanguage.googleapis.com)
//   - openrouter (one key, all models — Claude / Kimi-K2 / Llama / DeepSeek / etc.)
//
// Default routing (when OPENROUTER_API_KEY present):
//   cheap     →  google/gemini-3.5-flash-lite         (~$0.30 / $2.50 per M)
//   balanced  →  meta-llama/llama-3.3-70b-instruct    (~$0.35 / $0.40 per M)
//   premium   →  anthropic/claude-sonnet-5            (~$2 / $10 per M)
//
// Direct keys (Anthropic / OpenAI / Gemini) take precedence for their tier
// when present, since native APIs have lower latency and prompt-caching
// support that OpenRouter relays sometimes lose.
//
// Per-tier overrides:
//   TJ_PROVIDER_BALANCED=openai  TJ_MODEL_BALANCED=gpt-4o-mini

import { pickCred, type OrgCredentials } from '@/lib/credentials';
import { isOverBudget, recordCost, estimateCostUsd, remainingBudget } from './budget';

export type AiTier = 'cheap' | 'balanced' | 'premium';
export type AiProvider = 'anthropic' | 'openai' | 'google' | 'openrouter' | 'none';

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiRunOptions {
  tier?: AiTier;
  system?: string;
  messages: AiMessage[];
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  /** Org-level credential bag from getOrgCredentials() — preferred over env */
  credentials?: OrgCredentials;
  /** Org id used by the budget tracker. When set, runChat refuses to dispatch
   *  if the org's daily cap (TJ_AI_BUDGET_DAILY_USD or per-org override) is
   *  exhausted, and records the cost on success. Pass undefined for system-
   *  level calls that shouldn't count against any org's quota. */
  orgId?: string;
}

export interface AiResult {
  ok: true;
  text: string;
  provider: AiProvider;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}
export interface AiErr { ok: false; error: string; provider: AiProvider }
export type AiResponse = AiResult | AiErr;

interface Routing { provider: AiProvider; model: string }

function pick(creds: OrgCredentials | undefined, key: string): string | undefined {
  return pickCred(creds, key);
}

// Audit 2026-05-29 D8 — don't leak "localhost:3000" to OpenRouter from prod.
// Prefer TRENDJACK_BASE_URL or OPENROUTER_REFERER. Fall back to localhost only
// when explicitly in non-production.
export function resolveOpenRouterReferer(): string {
  const explicit = process.env.OPENROUTER_REFERER || process.env.TRENDJACK_BASE_URL;
  if (explicit) return explicit;
  if (process.env.NODE_ENV === 'production') {
    // No referer is better than a misleading one. OpenRouter accepts the
    // request without it; analytics will just lump the call under "unknown".
    return 'https://trendjack.app';
  }
  return 'http://localhost:3000';
}

// Exported for tests. The tier→model decision is what enforces CLAUDE.md
// hard-rule 3 (no free-tier model behind a user-visible fact), so it needs
// to be assertable rather than buried.
export function pickRouting(tier: AiTier, creds?: OrgCredentials): Routing {
  const hasAnthropic  = !!pick(creds, 'ANTHROPIC_API_KEY');
  const hasOpenAI     = !!pick(creds, 'OPENAI_API_KEY');
  const hasGoogle     = !!pick(creds, 'GOOGLE_API_KEY');
  const hasOpenRouter = !!pick(creds, 'OPENROUTER_API_KEY');
  const forceOpenRouter = pick(creds, 'TJ_FORCE_OPENROUTER') === '1';

  // Per-tier overrides (highest precedence)
  const envProvider = pick(creds, `TJ_PROVIDER_${tier.toUpperCase()}`) as AiProvider | undefined;
  const envModel    = pick(creds, `TJ_MODEL_${tier.toUpperCase()}`);
  if (envProvider && envModel) return { provider: envProvider, model: envModel };

  // Model IDs differ by route for the SAME model: Anthropic's own API spells it
  // claude-sonnet-5, OpenRouter spells it anthropic/claude-sonnet-5, and
  // OpenRouter uses dots in point releases (claude-sonnet-4.5) where Anthropic
  // uses dashes (claude-sonnet-4-5). Prefixing the Anthropic-style id with
  // "anthropic/" therefore produces an id OpenRouter does not have, which is
  // what was here and why every premium call 404'd. Verified against
  // /api/v1/models on 2026-08-27.
  if (tier === 'premium') {
    if (hasAnthropic && !forceOpenRouter) return { provider: 'anthropic',  model: 'claude-sonnet-5' };
    if (hasOpenRouter)                    return { provider: 'openrouter', model: 'anthropic/claude-sonnet-5' };
    if (hasOpenAI)                        return { provider: 'openai',     model: 'gpt-4o' };
    if (hasGoogle)                        return { provider: 'google',     model: 'gemini-2.5-pro' };
    if (hasAnthropic)                     return { provider: 'anthropic',  model: 'claude-sonnet-5' };
  }

  if (tier === 'balanced') {
    // Llama 3.3 70B has the most stable OpenRouter availability today.
    // Users can pin Kimi-K2, DeepSeek, etc. via TJ_MODEL_BALANCED.
    if (hasOpenRouter) return { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct' };
    if (hasAnthropic)  return { provider: 'anthropic',  model: 'claude-sonnet-5' };
    if (hasOpenAI)     return { provider: 'openai',     model: 'gpt-4o-mini' };
    if (hasGoogle)     return { provider: 'google',     model: 'gemini-2.5-flash' };
  }

  if (tier === 'cheap') {
    // gemini-2.0-flash-001 was delisted from OpenRouter; the call 404'd rather
    // than falling back, so triage silently produced nothing.
    if (hasOpenRouter) return { provider: 'openrouter', model: 'google/gemini-3.5-flash-lite' };
    if (hasGoogle)     return { provider: 'google',     model: 'gemini-2.0-flash-001' };
    if (hasOpenAI)     return { provider: 'openai',     model: 'gpt-4o-mini' };
    if (hasAnthropic)  return { provider: 'anthropic',  model: 'claude-haiku-4-5' };
  }

  return { provider: 'none', model: '' };
}

export async function runChat(opts: AiRunOptions): Promise<AiResponse> {
  const tier = opts.tier ?? 'balanced';
  const { provider, model } = pickRouting(tier, opts.credentials);

  if (provider === 'none') return { ok: false, error: 'no_ai_key', provider: 'none' };

  // Architect-managed budget gate. We refuse the call when the org has
  // already hit its daily USD cap. The error is structured so callers
  // (Verifier / draft-gen) can degrade gracefully — e.g. fall back to
  // the stub verifier or skip premium-tier drafts — instead of bubbling
  // a fetch error that looks like an outage.
  if (opts.orgId && isOverBudget(opts.orgId)) {
    return { ok: false, error: 'budget_exhausted', provider };
  }

  let res: AiResponse;
  if (provider === 'anthropic')       res = await callAnthropic(model, opts);
  else if (provider === 'openai')     res = await callOpenAI(model, opts);
  else if (provider === 'google')     res = await callGoogle(model, opts);
  else if (provider === 'openrouter') res = await callOpenRouter(model, opts);
  else return { ok: false, error: 'unknown_provider', provider };

  // Record cost on successful calls. Token counts come back from each
  // provider's usage block — providers that don't return one (rare) will
  // contribute zero cost, which under-counts but never over-counts.
  if (res.ok && opts.orgId) {
    const cost = estimateCostUsd(res.model, res.inputTokens, res.outputTokens);
    if (cost > 0) recordCost(opts.orgId, cost);
  }

  return res;
}

/** Telemetry helper — exposed so the Architect / dashboard can show
 *  remaining-budget without re-importing the budget module. */
export function getRemainingBudgetUsd(orgId: string | undefined): number {
  return remainingBudget(orgId);
}

// Wall-clock ceiling on every provider call.
//
// Previously NONE of the four fetches below passed a signal. Node's fetch has
// no default request timeout, so a stalled connection hung forever — and that
// is not hypothetical: it wedged the Verifier Agent completely. Its handler
// awaits verify() and only acks on success, so one hung call left the message
// un-acked with the handler pinned. 6,093 messages piled up on
// tj.trends.scored, no error was ever logged, and claim verification silently
// stopped working while the app looked healthy.
//
// A timeout turns that silent hang into a normal rejection: the catch in each
// caller returns { ok: false }, the Verifier's catch logs and declines to ack,
// the bus redelivers, and the Architect DLQs it if it keeps failing. Loud and
// recoverable instead of quiet and terminal.
const DEFAULT_AI_TIMEOUT_MS = 90_000;

function aiTimeoutMs(): number {
  const raw = Number(process.env.TJ_AI_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_AI_TIMEOUT_MS;
}

/** AbortSignal that fires after the configured AI timeout. */
function aiSignal(): AbortSignal {
  return AbortSignal.timeout(aiTimeoutMs());
}

/** Normalizes an abort into an operator-legible error string. */
function aiError(e: unknown): string {
  const err = e as Error;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return `provider_timeout_after_${aiTimeoutMs()}ms`;
  }
  return err?.message ?? 'unknown_error';
}

async function callAnthropic(model: string, opts: AiRunOptions): Promise<AiResponse> {
  const key = pick(opts.credentials, 'ANTHROPIC_API_KEY');
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY missing', provider: 'anthropic' };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: aiSignal(),
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.6,
        system: opts.system,
        messages: opts.messages.map(m => ({ role: m.role === 'system' ? 'user' : m.role, content: m.content })),
      }),
    });
    const json = await res.json() as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } };
    if (!res.ok) return { ok: false, error: json.error?.message ?? `http_${res.status}`, provider: 'anthropic' };
    const text = (json.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('').trim();
    return { ok: true, text, provider: 'anthropic', model, inputTokens: json.usage?.input_tokens, outputTokens: json.usage?.output_tokens };
  } catch (e) { return { ok: false, error: aiError(e), provider: 'anthropic' }; }
}

async function callOpenAI(model: string, opts: AiRunOptions): Promise<AiResponse> {
  const key = pick(opts.credentials, 'OPENAI_API_KEY');
  if (!key) return { ok: false, error: 'OPENAI_API_KEY missing', provider: 'openai' };
  const messages = opts.system ? [{ role: 'system' as const, content: opts.system }, ...opts.messages] : opts.messages;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: aiSignal(),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.6,
        response_format: opts.jsonMode ? { type: 'json_object' } : undefined,
      }),
    });
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } };
    if (!res.ok) return { ok: false, error: json.error?.message ?? `http_${res.status}`, provider: 'openai' };
    const text = json.choices?.[0]?.message?.content?.trim() ?? '';
    return { ok: true, text, provider: 'openai', model, inputTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens };
  } catch (e) { return { ok: false, error: aiError(e), provider: 'openai' }; }
}

async function callGoogle(model: string, opts: AiRunOptions): Promise<AiResponse> {
  const key = pick(opts.credentials, 'GOOGLE_API_KEY');
  if (!key) return { ok: false, error: 'GOOGLE_API_KEY missing', provider: 'google' };
  // Gemini REST: contents = ordered messages; system_instruction is separate.
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`, {
      method: 'POST',
      signal: aiSignal(),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: opts.system ? { parts: [{ text: opts.system }] } : undefined,
        contents: opts.messages.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          maxOutputTokens: opts.maxTokens ?? 1024,
          temperature: opts.temperature ?? 0.6,
          ...(opts.jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    });
    const json = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }; error?: { message?: string } };
    if (!res.ok) return { ok: false, error: json.error?.message ?? `http_${res.status}`, provider: 'google' };
    const text = (json.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('').trim();
    return { ok: true, text, provider: 'google', model, inputTokens: json.usageMetadata?.promptTokenCount, outputTokens: json.usageMetadata?.candidatesTokenCount };
  } catch (e) { return { ok: false, error: aiError(e), provider: 'google' }; }
}

// Stable fallback models we retry against when the user-supplied default
// returns an upstream error (a frequent OpenRouter failure mode).
//
// Order tuned for the high-stakes brand-voice case (draft generation):
//   1. Claude Sonnet 4.5 via OR — best brand-voice fidelity
//   2. Kimi K2 0905 (K2.5)      — Claude-tier reasoning, often cheaper
//   3. Llama 3.3 70B            — most consistently available baseline
//   4. Gemini 2.5 Flash         — fast last-resort
// Every id here must exist in OpenRouter's catalog, or the fallback chain is
// decoration. The first entry was anthropic/claude-sonnet-4-5, which OpenRouter
// has never had (it spells point releases with a dot), so the premium fallback
// burned a round trip on a guaranteed 404 before moving on.
// Checked against /api/v1/models on 2026-08-27.
const OR_FALLBACKS = [
  'anthropic/claude-sonnet-5',
  'moonshotai/kimi-k2-0905',
  'meta-llama/llama-3.3-70b-instruct',
  'google/gemini-2.5-flash',
];

async function callOpenRouter(model: string, opts: AiRunOptions, attempt = 0): Promise<AiResponse> {
  const key = pick(opts.credentials, 'OPENROUTER_API_KEY');
  if (!key) return { ok: false, error: 'OPENROUTER_API_KEY missing', provider: 'openrouter' };
  const messages = opts.system ? [{ role: 'system' as const, content: opts.system }, ...opts.messages] : opts.messages;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: aiSignal(),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
        // Audit 2026-05-29 D8 — refuse to leak "localhost" from prod.
        'http-referer': resolveOpenRouterReferer(),
        'x-title': 'TrendJack',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.6,
        response_format: opts.jsonMode ? { type: 'json_object' } : undefined,
      }),
    });
    const json = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string; code?: number; metadata?: { raw?: string; provider_name?: string } };
    };

    // Treat upstream errors with context. Some responses are 200 with an
    // error field instead of a 4xx — handle both.
    const errMsg = json.error?.message;
    const errCode = json.error?.code;
    const upstreamProvider = json.error?.metadata?.provider_name;
    const upstreamRaw = json.error?.metadata?.raw;
    const text = json.choices?.[0]?.message?.content?.trim() ?? '';

    if (!res.ok || errMsg) {
      const detail = [errMsg ?? `http_${res.status}`, upstreamProvider && `via ${upstreamProvider}`, errCode && `code ${errCode}`, upstreamRaw && upstreamRaw.slice(0, 160)].filter(Boolean).join(' · ');

      // Auto-retry with a known-stable fallback model — but only once per
      // call, and only if the first attempt was on a non-fallback model.
      if (attempt === 0 && !OR_FALLBACKS.includes(model)) {
        for (const fallback of OR_FALLBACKS) {
          if (fallback === model) continue;
          const r = await callOpenRouter(fallback, opts, attempt + 1);
          if (r.ok) return { ...r, model: `${fallback} (fallback from ${model}: ${errMsg ?? 'upstream'})` };
        }
      }
      return { ok: false, error: detail || `openrouter_${res.status}`, provider: 'openrouter' };
    }

    if (!text) {
      return { ok: false, error: 'openrouter returned empty completion', provider: 'openrouter' };
    }
    return { ok: true, text, provider: 'openrouter', model, inputTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens };
  } catch (e) { return { ok: false, error: aiError(e), provider: 'openrouter' }; }
}

export function aiHealth(creds?: OrgCredentials) {
  return {
    anthropic:  !!pick(creds, 'ANTHROPIC_API_KEY'),
    openai:     !!pick(creds, 'OPENAI_API_KEY'),
    google:     !!pick(creds, 'GOOGLE_API_KEY'),
    openrouter: !!pick(creds, 'OPENROUTER_API_KEY'),
  };
}
