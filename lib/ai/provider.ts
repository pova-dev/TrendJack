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
//   cheap     →  google/gemini-2.0-flash-001          (~$0.10 / $0.40 per M)
//   balanced  →  moonshotai/kimi-k2                   (~$0.55 / $2.20 per M)
//   premium   →  anthropic/claude-sonnet-4-5          (~$3 / $15 per M)
//
// Direct keys (Anthropic / OpenAI / Gemini) take precedence for their tier
// when present, since native APIs have lower latency and prompt-caching
// support that OpenRouter relays sometimes lose.
//
// Per-tier overrides:
//   TJ_PROVIDER_BALANCED=openai  TJ_MODEL_BALANCED=gpt-4o-mini

import { pickCred, type OrgCredentials } from '@/lib/credentials';

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

function pickRouting(tier: AiTier, creds?: OrgCredentials): Routing {
  const hasAnthropic  = !!pick(creds, 'ANTHROPIC_API_KEY');
  const hasOpenAI     = !!pick(creds, 'OPENAI_API_KEY');
  const hasGoogle     = !!pick(creds, 'GOOGLE_API_KEY');
  const hasOpenRouter = !!pick(creds, 'OPENROUTER_API_KEY');
  const forceOpenRouter = pick(creds, 'TJ_FORCE_OPENROUTER') === '1';

  // Per-tier overrides (highest precedence)
  const envProvider = pick(creds, `TJ_PROVIDER_${tier.toUpperCase()}`) as AiProvider | undefined;
  const envModel    = pick(creds, `TJ_MODEL_${tier.toUpperCase()}`);
  if (envProvider && envModel) return { provider: envProvider, model: envModel };

  if (tier === 'premium') {
    if (hasAnthropic && !forceOpenRouter) return { provider: 'anthropic',  model: 'claude-sonnet-4-5' };
    if (hasOpenRouter)                    return { provider: 'openrouter', model: 'anthropic/claude-sonnet-4-5' };
    if (hasOpenAI)                        return { provider: 'openai',     model: 'gpt-4o' };
    if (hasGoogle)                        return { provider: 'google',     model: 'gemini-2.5-pro' };
    if (hasAnthropic)                     return { provider: 'anthropic',  model: 'claude-sonnet-4-5' };
  }

  if (tier === 'balanced') {
    // Llama 3.3 70B has the most stable OpenRouter availability today.
    // Users can pin Kimi-K2, DeepSeek, etc. via TJ_MODEL_BALANCED.
    if (hasOpenRouter) return { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct' };
    if (hasAnthropic)  return { provider: 'anthropic',  model: 'claude-sonnet-4-5' };
    if (hasOpenAI)     return { provider: 'openai',     model: 'gpt-4o-mini' };
    if (hasGoogle)     return { provider: 'google',     model: 'gemini-2.5-flash' };
  }

  if (tier === 'cheap') {
    if (hasOpenRouter) return { provider: 'openrouter', model: 'google/gemini-2.0-flash-001' };
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

  if (provider === 'anthropic')  return callAnthropic(model, opts);
  if (provider === 'openai')     return callOpenAI(model, opts);
  if (provider === 'google')     return callGoogle(model, opts);
  if (provider === 'openrouter') return callOpenRouter(model, opts);
  return { ok: false, error: 'unknown_provider', provider };
}

async function callAnthropic(model: string, opts: AiRunOptions): Promise<AiResponse> {
  const key = pick(opts.credentials, 'ANTHROPIC_API_KEY');
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY missing', provider: 'anthropic' };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
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
  } catch (e) { return { ok: false, error: (e as Error).message, provider: 'anthropic' }; }
}

async function callOpenAI(model: string, opts: AiRunOptions): Promise<AiResponse> {
  const key = pick(opts.credentials, 'OPENAI_API_KEY');
  if (!key) return { ok: false, error: 'OPENAI_API_KEY missing', provider: 'openai' };
  const messages = opts.system ? [{ role: 'system' as const, content: opts.system }, ...opts.messages] : opts.messages;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
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
  } catch (e) { return { ok: false, error: (e as Error).message, provider: 'openai' }; }
}

async function callGoogle(model: string, opts: AiRunOptions): Promise<AiResponse> {
  const key = pick(opts.credentials, 'GOOGLE_API_KEY');
  if (!key) return { ok: false, error: 'GOOGLE_API_KEY missing', provider: 'google' };
  // Gemini REST: contents = ordered messages; system_instruction is separate.
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`, {
      method: 'POST',
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
  } catch (e) { return { ok: false, error: (e as Error).message, provider: 'google' }; }
}

// Stable fallback models we retry against when the user-supplied default
// returns an upstream error (a frequent OpenRouter failure mode).
//
// Order tuned for the high-stakes brand-voice case (draft generation):
//   1. Claude Sonnet 4.5 via OR — best brand-voice fidelity
//   2. Kimi K2 0905 (K2.5)      — Claude-tier reasoning, often cheaper
//   3. Llama 3.3 70B            — most consistently available baseline
//   4. Gemini 2.5 Flash         — fast last-resort
const OR_FALLBACKS = [
  'anthropic/claude-sonnet-4-5',
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
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
        'http-referer': process.env.OPENROUTER_REFERER ?? 'http://localhost:3000',
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
  } catch (e) { return { ok: false, error: (e as Error).message, provider: 'openrouter' }; }
}

export function aiHealth(creds?: OrgCredentials) {
  return {
    anthropic:  !!pick(creds, 'ANTHROPIC_API_KEY'),
    openai:     !!pick(creds, 'OPENAI_API_KEY'),
    google:     !!pick(creds, 'GOOGLE_API_KEY'),
    openrouter: !!pick(creds, 'OPENROUTER_API_KEY'),
  };
}
