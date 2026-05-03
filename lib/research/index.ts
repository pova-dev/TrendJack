// Web research adapter. Given a trend, return:
//   - 1-paragraph neutral summary
//   - structured key facts (price, specs, dates, players, geography)
//   - source citations
//
// Backend priority is free-first; we only escalate to paid options when
// free fails:
//   1. searx              — open-source meta-search, multi-instance, free
//   2. duckduckgo         — fragile HTML scraper, free
//   3. tavily             — paid (free tier 1k/mo)
//   4. brave              — paid (free tier 2k/mo)
//   5. perplexity-online  — Perplexity Sonar via OpenRouter (best quality,
//                           costs OR credits). Used only if all free + paid
//                           search backends return empty.
//
// Whichever backend produces sources, we hand them to the AI provider for
// summarization (cost-aware tier — defaults to Kimi-K2 / Gemini Flash).
// If no AI provider is configured we still return raw sources, so the user
// gets a "no AI yet" state with clickable links instead of blank screen.

import type { Trend } from '@/types';
import { runChat } from '@/lib/ai/provider';
import { pickCred, type OrgCredentials } from '@/lib/credentials';

export interface ResearchSource {
  title: string;
  url: string;
  snippet?: string;
}

export type SearchBackend = 'perplexity-online' | 'tavily' | 'brave' | 'searx' | 'duckduckgo' | 'none';

export interface ResearchResult {
  query: string;
  summary: string;
  keyFacts: { label: string; value: string }[];
  sources: ResearchSource[];
  generatedAt: string;
  provider: string;
  searchBackend: SearchBackend;
  /** True when the model itself produced the summary; false when we only have raw search */
  aiSummarized: boolean;
}

export async function researchTrend(trend: Trend, credentials?: OrgCredentials): Promise<ResearchResult> {
  const query = buildQuery(trend);
  const hint = (pickCred(credentials, 'TJ_RESEARCH_BACKEND') || 'auto').toLowerCase();

  // Explicit Sonar request — go straight to the AI-powered web search.
  if (hint === 'sonar' || hint === 'perplexity' || hint === 'paid-ai') {
    if (pickCred(credentials, 'OPENROUTER_API_KEY')) {
      try {
        const out = await perplexitySonarResearch(query, trend, credentials);
        if (out) return out;
      } catch { /* fall through */ }
    }
  }

  // Explicit free-only request: skip paid keys entirely even if present.
  if (hint === 'free' || hint === 'searx' || hint === 'duckduckgo') {
    const { sources, backend } = await searchFree(query, hint as 'free' | 'searx' | 'duckduckgo');
    return await summarizeIfPossible(query, trend, sources, backend, credentials);
  }

  // Explicit paid-search request: only Tavily / Brave; no Sonar.
  if (hint === 'tavily' || hint === 'brave' || hint === 'paid-search') {
    const { sources, backend } = await searchPaid(query, credentials, hint as 'tavily' | 'brave' | 'paid-search');
    return await summarizeIfPossible(query, trend, sources, backend, credentials);
  }

  // Default 'auto': free first, then paid search, then Sonar last-resort.
  const { sources, backend } = await searchWeb(query, credentials);
  if (sources.length > 0) {
    return await summarizeIfPossible(query, trend, sources, backend, credentials);
  }
  if (pickCred(credentials, 'OPENROUTER_API_KEY')) {
    try {
      const out = await perplexitySonarResearch(query, trend, credentials);
      if (out) return out;
    } catch { /* fall through */ }
  }
  return await summarizeIfPossible(query, trend, [], 'none', credentials);
}

async function searchFree(query: string, mode: 'free' | 'searx' | 'duckduckgo') {
  if (mode === 'duckduckgo') {
    try { const hits = await duckduckgoSearch(query); if (hits.length > 0) return { sources: hits, backend: 'duckduckgo' as const }; } catch {}
    return { sources: [], backend: 'none' as const };
  }
  if (mode === 'searx') {
    try { const hits = await searxSearch(query); if (hits.length > 0) return { sources: hits, backend: 'searx' as const }; } catch {}
    return { sources: [], backend: 'none' as const };
  }
  // 'free' = both, in order
  try { const hits = await searxSearch(query); if (hits.length > 0) return { sources: hits, backend: 'searx' as const }; } catch {}
  try { const hits = await duckduckgoSearch(query); if (hits.length > 0) return { sources: hits, backend: 'duckduckgo' as const }; } catch {}
  return { sources: [], backend: 'none' as const };
}

async function searchPaid(query: string, creds: OrgCredentials | undefined, mode: 'tavily' | 'brave' | 'paid-search') {
  const tavily = pickCred(creds, 'TAVILY_API_KEY');
  const brave  = pickCred(creds, 'BRAVE_API_KEY');
  if ((mode === 'tavily' || mode === 'paid-search') && tavily) {
    try { const hits = await tavilySearch(query, tavily); if (hits.length > 0) return { sources: hits, backend: 'tavily' as const }; } catch {}
  }
  if ((mode === 'brave' || mode === 'paid-search') && brave) {
    try { const hits = await braveSearch(query, brave); if (hits.length > 0) return { sources: hits, backend: 'brave' as const }; } catch {}
  }
  return { sources: [], backend: 'none' as const };
}

// -----------------------------------------------------------------------------
// Perplexity Sonar via OpenRouter (recommended path)
// -----------------------------------------------------------------------------

async function perplexitySonarResearch(query: string, trend: Trend, credentials?: OrgCredentials): Promise<ResearchResult | null> {
  const key = pickCred(credentials, 'OPENROUTER_API_KEY')!;
  const model = pickCred(credentials, 'TJ_MODEL_RESEARCH') || 'perplexity/sonar';

  const sysPrompt = `
You are TrendJack's research analyst. Search the web for the trend and emit
STRICT JSON only:

{
  "summary": string,                         // 2-3 sentences, neutral, fact-based
  "keyFacts": [{"label": string, "value": string}, ...up to 6]
}

Rules:
- "summary" must be grounded in the search results you used.
- "keyFacts" should prefer numbers, dates, names — not vibes.
- Output ONLY the JSON object. No prose, no code fences.
`.trim();

  const userPrompt = `TREND
title: ${trend.title}
lineage: ${trend.lineage}
hashtags: ${trend.hashtags.join(' ')}

QUERY: ${query}`;

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
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 800,
      temperature: 0.4,
    }),
  });
  const json = await res.json() as {
    choices?: Array<{ message?: { content?: string; annotations?: Array<{ type: string; url_citation?: { url: string; title?: string; content?: string } }> } }>;
    citations?: string[];
    error?: { message?: string };
  };
  if (!res.ok) return null;

  const text = json.choices?.[0]?.message?.content?.trim() ?? '';
  let summary = '';
  let keyFacts: ResearchResult['keyFacts'] = [];
  try {
    const parsed = JSON.parse(stripJsonWrapper(text)) as { summary?: string; keyFacts?: typeof keyFacts };
    summary = parsed.summary ?? '';
    keyFacts = (parsed.keyFacts ?? []).slice(0, 6);
  } catch {
    summary = text.slice(0, 600);
  }

  // Sources come from two places depending on the model:
  //   - top-level `citations: string[]`  (most current Sonar models)
  //   - per-message `annotations[]`      (newer responses)
  const sources: ResearchSource[] = [];
  const seen = new Set<string>();
  for (const a of (json.choices?.[0]?.message?.annotations ?? [])) {
    if (a.type === 'url_citation' && a.url_citation?.url && !seen.has(a.url_citation.url)) {
      seen.add(a.url_citation.url);
      sources.push({ title: a.url_citation.title ?? a.url_citation.url, url: a.url_citation.url, snippet: a.url_citation.content?.slice(0, 280) });
    }
  }
  for (const url of json.citations ?? []) {
    if (!seen.has(url)) {
      seen.add(url);
      sources.push({ title: titleFromUrl(url), url });
    }
  }

  return {
    query, summary: summary || `Research via Perplexity Sonar.`,
    keyFacts, sources,
    generatedAt: new Date().toISOString(),
    provider: `openrouter:${model}`,
    searchBackend: 'perplexity-online',
    aiSummarized: !!summary,
  };
}

// -----------------------------------------------------------------------------
// Two-step path: search backend → optional AI summary
// -----------------------------------------------------------------------------

async function summarizeIfPossible(query: string, trend: Trend, sources: ResearchSource[], backend: SearchBackend, credentials?: OrgCredentials): Promise<ResearchResult> {
  const sysPrompt = `
You are TrendJack's research analyst. Given a trend and a list of web search
results about it, return STRICT JSON only:

{
  "summary": string,                         // 2-3 sentences, neutral, no marketing language
  "keyFacts": [{"label": string, "value": string}, ...up to 6]
}

Rules:
- Summary must reference at least one source; never invent facts.
- keyFacts prefer numbers, dates, names — not "this matters".
- Skip JSON wrappers / commentary. Output ONLY the JSON object.
`.trim();

  const userPayload = `TREND
title: ${trend.title}
summary: ${trend.summary}
lineage: ${trend.lineage}
hashtags: ${trend.hashtags.join(' ')}

SEARCH RESULTS (${sources.length})
${sources.map((s, i) => `${i + 1}. ${s.title}\n   ${s.url}\n   ${s.snippet ?? ''}`).join('\n\n')}`;

  let summary = '';
  let keyFacts: ResearchResult['keyFacts'] = [];
  let provider = 'none';
  let aiSummarized = false;

  if (sources.length > 0) {
    const ai = await runChat({
      tier: 'balanced',
      system: sysPrompt,
      messages: [{ role: 'user', content: userPayload }],
      maxTokens: 700, temperature: 0.4, jsonMode: true,
      credentials,
    });
    if (ai.ok) {
      provider = `${ai.provider}:${ai.model}`;
      try {
        const parsed = JSON.parse(stripJsonWrapper(ai.text)) as { summary?: string; keyFacts?: typeof keyFacts };
        summary = parsed.summary ?? '';
        keyFacts = (parsed.keyFacts ?? []).slice(0, 6);
        aiSummarized = !!summary;
      } catch { summary = ai.text.slice(0, 600); aiSummarized = !!summary; }
    }
  }

  if (!summary) {
    summary = sources.length > 0
      ? `Found ${sources.length} sources for "${query}" via ${backend}. Add an AI provider key in Settings → AI to get a summary + structured key facts.`
      : `No web sources found for "${query}". Try refining the trend title.`;
  }

  return {
    query, summary, keyFacts, sources,
    generatedAt: new Date().toISOString(),
    provider,
    searchBackend: backend,
    aiSummarized,
  };
}

// -----------------------------------------------------------------------------
// Search backends
// -----------------------------------------------------------------------------

async function searchWeb(query: string, creds?: OrgCredentials): Promise<{ sources: ResearchSource[]; backend: SearchBackend }> {
  // Free path #1: SearXNG public instances
  try {
    const hits = await searxSearch(query);
    if (hits.length > 0) return { sources: hits, backend: 'searx' };
  } catch { /* fall through */ }

  // Free path #2: DuckDuckGo HTML
  try {
    const hits = await duckduckgoSearch(query);
    if (hits.length > 0) return { sources: hits, backend: 'duckduckgo' };
  } catch { /* fall through */ }

  // Paid (with generous free tiers) — Tavily then Brave.
  const tavily = pickCred(creds, 'TAVILY_API_KEY');
  if (tavily) {
    try {
      const hits = await tavilySearch(query, tavily);
      if (hits.length > 0) return { sources: hits, backend: 'tavily' };
    } catch { /* fall through */ }
  }
  const brave = pickCred(creds, 'BRAVE_API_KEY');
  if (brave) {
    try {
      const hits = await braveSearch(query, brave);
      if (hits.length > 0) return { sources: hits, backend: 'brave' };
    } catch { /* fall through */ }
  }

  return { sources: [], backend: 'none' };
}

async function tavilySearch(query: string, key: string): Promise<ResearchSource[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: key, query, max_results: 6, include_answer: false }),
  });
  if (!res.ok) throw new Error(`tavily_${res.status}`);
  const json = await res.json() as { results: Array<{ title: string; url: string; content: string }> };
  return json.results.map(r => ({ title: r.title, url: r.url, snippet: r.content?.slice(0, 280) }));
}

async function braveSearch(query: string, key: string): Promise<ResearchSource[]> {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6`, {
    headers: { 'x-subscription-token': key, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`brave_${res.status}`);
  const json = await res.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
  return (json.web?.results ?? []).map(r => ({ title: r.title, url: r.url, snippet: r.description?.slice(0, 280) }));
}

// SearXNG — open-source meta-search. Public instances rotate frequently;
// we try a list and stop on the first that returns json with results.
const SEARX_INSTANCES = [
  'https://searx.be',
  'https://search.privacyguides.net',
  'https://searx.tiekoetter.com',
  'https://priv.au',
  'https://searx.work',
];

async function searxSearch(query: string): Promise<ResearchSource[]> {
  for (const base of SEARX_INSTANCES) {
    try {
      const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&safesearch=0&language=en`;
      const res = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (TrendJack)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const json = await res.json() as { results?: Array<{ title: string; url: string; content?: string }> };
      if (!json.results?.length) continue;
      return json.results.slice(0, 6).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.content?.slice(0, 280),
      }));
    } catch { /* next instance */ }
  }
  return [];
}

// DuckDuckGo — last resort. We try the lite endpoint first (more stable),
// then the html endpoint. Multiple selector strategies for resilience.
async function duckduckgoSearch(query: string): Promise<ResearchSource[]> {
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

  // Try the main HTML endpoint (html.duckduckgo.com is more stable than the
  // root duckduckgo.com/html/).
  for (const url of [
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
  ]) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': ua, accept: 'text/html' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const html = await res.text();
      const out = parseDdgHtml(html);
      if (out.length > 0) return out;
    } catch { /* try next */ }
  }
  return [];
}

function parseDdgHtml(html: string): ResearchSource[] {
  const out: ResearchSource[] = [];

  // Strategy 1: classic .result__a / .result__snippet
  const re1 = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(html)) && out.length < 6) {
    out.push({ title: cleanInline(m[2]), url: unwrapDdgRedirect(m[1]), snippet: cleanInline(m[3]).slice(0, 280) });
  }
  if (out.length > 0) return out;

  // Strategy 2: `<a class="result-link" ...><h2>title</h2></a>` with <p class="result-snippet">
  const re2 = /<a[^>]+class="result-link"[^>]+href="([^"]+)"[\s\S]*?>([\s\S]*?)<\/a>[\s\S]*?<p[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/p>/g;
  while ((m = re2.exec(html)) && out.length < 6) {
    out.push({ title: cleanInline(m[2]), url: unwrapDdgRedirect(m[1]), snippet: cleanInline(m[3]).slice(0, 280) });
  }
  if (out.length > 0) return out;

  // Strategy 3: anything with `web-result` heading
  const re3 = /<h2[^>]+class="result__title"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  while ((m = re3.exec(html)) && out.length < 6) {
    out.push({ title: cleanInline(m[2]), url: unwrapDdgRedirect(m[1]) });
  }
  return out;
}

function unwrapDdgRedirect(href: string): string {
  if (href.startsWith('//')) href = 'https:' + href;
  const wrapped = href.match(/uddg=([^&]+)/);
  if (wrapped) return decodeURIComponent(wrapped[1]);
  return href;
}

function cleanInline(s: string): string {
  return s.replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/\s+/g, ' ').trim();
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function buildQuery(t: Trend): string {
  const base = t.title.replace(/^#?/, '').replace(/[“”]/g, '"');
  return base.length < 80 ? base : base.slice(0, 80);
}

function titleFromUrl(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

function stripJsonWrapper(s: string): string {
  const fenced = s.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenced) return fenced[1].trim();
  const idx = s.indexOf('{');
  if (idx > 0) return s.slice(idx);
  return s.trim();
}
