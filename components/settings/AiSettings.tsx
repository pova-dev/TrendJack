'use client';
import * as React from 'react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';

interface CredItem { id: string; scope: string; key: string; mask: string; updatedAt: string }

interface ProviderSpec {
  id: 'openrouter' | 'anthropic' | 'openai' | 'google';
  label: string;
  tagline: string;
  badges: Array<'recommended' | 'premium' | 'value' | 'web-search'>;
  envKey: string;
  signupUrl: string;
  pricing: string;
  defaultModel: string;
  blurb: string;
}

const PROVIDERS: ProviderSpec[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    tagline: 'One key, every model — including Perplexity Sonar (web-search built in)',
    badges: ['recommended', 'premium', 'web-search'],
    envKey: 'OPENROUTER_API_KEY',
    signupUrl: 'https://openrouter.ai/keys',
    pricing: 'Pay-as-you-go · ~$0.10–$15 per 1M tokens depending on model',
    defaultModel: 'moonshotai/kimi-k2 · anthropic/claude-sonnet-4-5 · google/gemini-2.5-pro · perplexity/sonar',
    blurb: 'One key unlocks Claude, GPT-4o, Gemini, Kimi, Llama, DeepSeek + Perplexity Sonar (web-search built in). Best for cost control across models without juggling separate billings.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    tagline: 'Direct Claude API · best for brand-voice arbitration',
    badges: ['premium'],
    envKey: 'ANTHROPIC_API_KEY',
    signupUrl: 'https://console.anthropic.com/settings/keys',
    pricing: 'Sonnet ~$3 / $15 per 1M tokens · Haiku ~$0.80 / $4',
    defaultModel: 'claude-sonnet-4-5 (premium) · claude-haiku-4-5 (cheap)',
    blurb: 'Best brand-voice fidelity for cringe arbitration and crisis copy. Lower latency than OpenRouter relays + native prompt caching.',
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT-4o)',
    tagline: 'Direct OpenAI API · strong on structured output + tool-use',
    badges: ['premium'],
    envKey: 'OPENAI_API_KEY',
    signupUrl: 'https://platform.openai.com/api-keys',
    pricing: 'GPT-4o ~$2.50 / $10 per 1M tokens · GPT-4o-mini ~$0.15 / $0.60',
    defaultModel: 'gpt-4o (premium) · gpt-4o-mini (cheap/balanced)',
    blurb: 'Premium-tier reasoning + the most reliable JSON-mode in the industry. Best when your team already has OpenAI billing.',
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    tagline: 'Direct Gemini API · 1M-token context + free quota',
    badges: ['premium', 'value'],
    envKey: 'GOOGLE_API_KEY',
    signupUrl: 'https://aistudio.google.com/app/apikey',
    pricing: 'Gemini 2.5 Pro ~$1.25 / $5 per 1M · 2.5 Flash ~$0.10 / $0.40',
    defaultModel: 'gemini-2.5-pro (premium) · gemini-2.5-flash (balanced) · gemini-2.0-flash (cheap)',
    blurb: 'Premium-grade Pro at half the cost of Claude/GPT-4o + generous free quota. 1M-token context lets you stuff entire brand archives.',
  },
];

export function AiSettings({ initial }: { initial: CredItem[] }) {
  const [creds, setCreds] = React.useState<CredItem[]>(initial);
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [savedKey, setSavedKey] = React.useState<string | null>(null);

  function isSet(envKey: string) { return creds.some(c => c.key === envKey); }
  function maskFor(envKey: string) { return creds.find(c => c.key === envKey)?.mask; }

  async function save(envKey: string) {
    const value = draft[envKey] ?? '';
    setBusy(true);
    try {
      const res = await fetch('/api/credentials', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entries: [{ key: envKey, value }] }),
      });
      const json = await res.json() as CredItem[];
      setCreds(json);
      setDraft(d => ({ ...d, [envKey]: '' }));
      setSavedKey(envKey);
      setTimeout(() => setSavedKey(null), 1800);
    } finally { setBusy(false); }
  }

  async function remove(envKey: string) {
    if (!isSet(envKey)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/credentials?key=${envKey}`, { method: 'DELETE' });
      if (res.ok) {
        const list = await fetch('/api/credentials').then(r => r.json()) as CredItem[];
        setCreds(list);
      }
    } finally { setBusy(false); }
  }

  const anyConfigured = creds.some(c => c.scope === 'ai' && c.key.endsWith('_API_KEY'));

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-ink-700 bg-ink-900 p-4">
        <div className="flex items-center gap-3">
          <Chip tone={anyConfigured ? 'good' : 'bad'}>
            {anyConfigured ? '● AI enabled' : '○ AI disabled'}
          </Chip>
          <p className="text-sm text-ink-200">
            {anyConfigured
              ? 'Your AI features are live: research summaries, co-pilot, draft generation.'
              : 'Add at least one provider key to unlock AI features (research, co-pilot, draft generation).'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {PROVIDERS.map(p => {
          const set = isSet(p.envKey);
          return (
            <section key={p.id} className="rounded-md border border-ink-700 bg-ink-900 p-4 space-y-3">
              <header className="flex items-start gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-ink-100">{p.label}</h3>
                    {p.badges.includes('recommended') && <Chip tone="flare">recommended</Chip>}
                    {p.badges.includes('premium')      && <Chip tone="good">premium</Chip>}
                    {p.badges.includes('web-search')   && <Chip tone="info">web-search</Chip>}
                    {p.badges.includes('value')        && <Chip tone="info">value</Chip>}
                    {set && <Chip tone="good">configured</Chip>}
                  </div>
                  <p className="text-xs text-ink-300 mt-0.5">{p.tagline}</p>
                </div>
                <a href={p.signupUrl} target="_blank" rel="noreferrer noopener"
                   className="text-2xs text-flare-400 hover:underline">Get key ↗</a>
              </header>

              <p className="text-2xs text-ink-300 leading-relaxed">{p.blurb}</p>

              <div className="text-2xs space-y-0.5 font-mono text-ink-400">
                <div>Models: <span className="text-ink-200">{p.defaultModel}</span></div>
                <div>Pricing: <span className="text-ink-200">{p.pricing}</span></div>
              </div>

              <div>
                <label className="block">
                  <span className="text-2xs uppercase tracking-wider text-ink-300 mb-1 block">{p.envKey}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      placeholder={set ? maskFor(p.envKey) : 'Paste your key'}
                      value={draft[p.envKey] ?? ''}
                      onChange={e => setDraft(d => ({ ...d, [p.envKey]: e.target.value }))}
                      className="flex-1 h-9 px-2.5 rounded-md bg-ink-800 border border-ink-700 text-sm text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900 font-mono"
                    />
                    <Button variant="primary" size="sm" disabled={busy || !draft[p.envKey]} onClick={() => save(p.envKey)}>
                      {savedKey === p.envKey ? 'Saved ✓' : 'Save'}
                    </Button>
                    {set && (
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => remove(p.envKey)}
                              className="text-signal-red">Remove</Button>
                    )}
                  </div>
                  <p className="text-2xs text-ink-500 mt-1">Stored encrypted (AES-256-GCM) per org. Never sent to the browser unmasked.</p>
                </label>
              </div>
            </section>
          );
        })}
      </div>

      <details className="rounded-md border border-ink-700 bg-ink-900 p-4">
        <summary className="text-sm font-semibold text-ink-100 cursor-pointer">Advanced — model overrides</summary>
        <p className="text-2xs text-ink-300 mt-2 mb-3">
          Pin specific models per tier. Useful if you want Kimi-K2 for everything,
          or a specific Claude version for premium.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(['CHEAP','BALANCED','PREMIUM'] as const).map(tier => (
            <div key={tier} className="space-y-1.5">
              <span className="text-2xs font-mono uppercase tracking-wider text-ink-300">{tier} TIER</span>
              <input
                placeholder="provider (anthropic|openai|google|openrouter)"
                value={draft[`TJ_PROVIDER_${tier}`] ?? ''}
                onChange={e => setDraft(d => ({ ...d, [`TJ_PROVIDER_${tier}`]: e.target.value }))}
                className="w-full h-8 px-2 rounded-md bg-ink-800 border border-ink-700 text-2xs font-mono text-ink-100"
              />
              <input
                placeholder="model id (e.g. moonshotai/kimi-k2)"
                value={draft[`TJ_MODEL_${tier}`] ?? ''}
                onChange={e => setDraft(d => ({ ...d, [`TJ_MODEL_${tier}`]: e.target.value }))}
                className="w-full h-8 px-2 rounded-md bg-ink-800 border border-ink-700 text-2xs font-mono text-ink-100"
              />
              <div className="flex gap-1">
                <Button size="xs" variant="primary" disabled={busy}
                        onClick={() => {
                          save(`TJ_PROVIDER_${tier}`);
                          save(`TJ_MODEL_${tier}`);
                        }}>Save</Button>
                {(isSet(`TJ_PROVIDER_${tier}`) || isSet(`TJ_MODEL_${tier}`)) && (
                  <Button size="xs" variant="ghost" className="text-signal-red"
                          onClick={() => { remove(`TJ_PROVIDER_${tier}`); remove(`TJ_MODEL_${tier}`); }}>Reset</Button>
                )}
                {isSet(`TJ_PROVIDER_${tier}`) && (
                  <span className="text-2xs font-mono text-ink-400 self-center">
                    set: {maskFor(`TJ_PROVIDER_${tier}`)} · {maskFor(`TJ_MODEL_${tier}`) ?? '—'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
