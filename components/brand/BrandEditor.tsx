'use client';
import * as React from 'react';
import type { BrandProfile } from '@/types';
import { ChipInput } from './ChipInput';
import { ToneTester } from './ToneTester';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';

interface Props {
  initial: BrandProfile;
}

// Editable brand page. Autosaves on field-blur with a 600ms debounce.
// On save we PUT /api/brand, the server rescores trends, and the SSE bus
// broadcasts to every other tab — they refetch and re-render.
export function BrandEditor({ initial }: Props) {
  const [brand, setBrand] = React.useState<BrandProfile>(initial);
  const [saveState, setSaveState] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const debouncer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refresh local state when the SSE stream tells us someone else edited it.
  React.useEffect(() => {
    const es = new EventSource(`/api/brand/stream`);
    const onChange = async () => {
      const r = await fetch('/api/brand', { cache: 'no-store' });
      if (r.ok) setBrand(await r.json());
    };
    es.addEventListener('brand.profile_changed', onChange);
    return () => es.close();
  }, []);

  function patchAndSave(patch: Partial<BrandProfile>) {
    setBrand(b => ({ ...b, ...patch }));
    setSaveState('saving');
    if (debouncer.current) clearTimeout(debouncer.current);
    debouncer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/brand', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(String(res.status));
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 1000);
      } catch {
        setSaveState('error');
      }
    }, 600);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 max-w-6xl">
      <div className="lg:col-span-2 space-y-4">
        <div className="rounded-md border border-ink-700 bg-ink-900 p-4">
          <Field label="Brand name">
            <input value={brand.name} onChange={e => patchAndSave({ name: e.target.value })} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Category">
              <input value={brand.category} onChange={e => patchAndSave({ category: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Content goal">
              <input value={brand.contentGoal} onChange={e => patchAndSave({ contentGoal: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <Field label="Markets" className="mt-3">
            <ChipInput value={brand.markets} onChange={markets => patchAndSave({ markets })} placeholder="India, SEA…" />
          </Field>
        </div>

        <div className="rounded-md border border-ink-700 bg-ink-900 p-4">
          <h2 className="text-sm font-semibold text-ink-100 mb-2">Voice</h2>
          <Field label="Tagline">
            <input value={brand.tone.tagline} onChange={e => patchAndSave({ tone: { ...brand.tone, tagline: e.target.value } })} className={inputCls} />
          </Field>
          <Field label="Voice description" className="mt-3">
            <textarea value={brand.tone.voice} onChange={e => patchAndSave({ tone: { ...brand.tone, voice: e.target.value } })} rows={2} className={inputCls + ' h-auto py-2'} />
          </Field>
          <Field label="Banned phrases — these never ship" className="mt-3">
            <ChipInput tone="bad" value={brand.tone.bannedPhrases} onChange={v => patchAndSave({ tone: { ...brand.tone, bannedPhrases: v } })} placeholder='e.g. "unleash your potential"' />
          </Field>
          <Field label="Forbidden styles" className="mt-3">
            <ChipInput tone="warn" value={brand.tone.forbiddenStyles} onChange={v => patchAndSave({ tone: { ...brand.tone, forbiddenStyles: v } })} placeholder="lifestyle warmth, motivational cliché…" />
          </Field>
          <Field label="Allowed jokes / on-theme keywords" className="mt-3">
            <ChipInput tone="info" value={brand.tone.allowedJokes} onChange={v => patchAndSave({ tone: { ...brand.tone, allowedJokes: v } })} placeholder="battery, gaming, thermal…" />
          </Field>
        </div>

        <div className="rounded-md border border-flare-500/40 bg-flare-500/[0.03] p-4">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-sm font-semibold text-ink-100">Brand Keywords</h2>
            <Chip tone="flare">drives Brand Matches</Chip>
          </div>
          <p className="text-2xs text-ink-300 mb-3">
            Trends that mention any of these land in <span className="font-mono text-flare-400">Brand Matches</span>.
            Add your brand name, parent company, product lines, and common variants — e.g.
            <span className="font-mono text-ink-200"> pova, pova mobile, pova curve, pova 7, tecno, tecno mobile</span>.
            Keep them specific: short generic terms like <span className="font-mono">phone</span> would over-match.
          </p>
          <ChipInput
            tone="flare"
            value={brand.brandKeywords ?? []}
            onChange={v => patchAndSave({ brandKeywords: v })}
            placeholder="pova, tecno pova, pova curve, pova 7…"
          />
        </div>

        <div className="rounded-md border border-ink-700 bg-ink-900 p-4">
          <h2 className="text-sm font-semibold text-ink-100 mb-2">Google Trends</h2>
          <p className="text-2xs text-ink-300 mb-3">
            Drives the <span className="font-mono text-flare-400">Trending Now</span> column. The first <span className="font-mono">market</span> above
            sets the geo (so India / SEA / US…). Pick the categories you actually care about — too many fans out a lot of fetches.
          </p>
          <Field label="Categories to ingest">
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'top', label: 'Top stories' },
                { id: 't',   label: 'Sports' },
                { id: 'b',   label: 'Business' },
                { id: 'e',   label: 'Entertainment' },
                { id: 'm',   label: 'Sci & Tech' },
                { id: 'h',   label: 'Health' },
              ].map(cat => {
                const active = (brand.gtrendsCategories ?? []).includes(cat.id);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      const cur = new Set(brand.gtrendsCategories ?? []);
                      if (cur.has(cat.id)) cur.delete(cat.id); else cur.add(cat.id);
                      void patchAndSave({ gtrendsCategories: Array.from(cur) });
                    }}
                    className={
                      'rounded-md border px-3 py-1 text-xs transition ' +
                      (active
                        ? 'border-flare-500 bg-flare-500/15 text-flare-200'
                        : 'border-ink-700 bg-ink-800 text-ink-300 hover:text-ink-100')
                    }
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>

        <div className="rounded-md border border-ink-700 bg-ink-900 p-4">
          <h2 className="text-sm font-semibold text-ink-100 mb-2">Topics</h2>
          <Field label="Banned topics — hard kill on trends that mention these">
            <ChipInput tone="bad" value={brand.bannedTopics} onChange={v => patchAndSave({ bannedTopics: v })} placeholder="politics, religion, tragedy…" />
          </Field>
          <Field label="Safe themes — boost trends that match" className="mt-3">
            <ChipInput tone="good" value={brand.safeThemes} onChange={v => patchAndSave({ safeThemes: v })} placeholder="battery, gaming, design…" />
          </Field>
          <Field label="Competitors" className="mt-3">
            <ChipInput tone="neutral" value={brand.competitors} onChange={v => patchAndSave({ competitors: v })} placeholder="Xiaomi, Samsung, Realme…" />
          </Field>
        </div>

        <div className="rounded-md border border-ink-700 bg-ink-900 p-4">
          <h2 className="text-sm font-semibold text-ink-100 mb-2">Audience</h2>
          <Field label="Primary segments">
            <ChipInput value={brand.audience.primary} onChange={v => patchAndSave({ audience: { ...brand.audience, primary: v } })} placeholder="Gen Z, students, gamers…" />
          </Field>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Age range">
              <input value={brand.audience.age} onChange={e => patchAndSave({ audience: { ...brand.audience, age: e.target.value } })} className={inputCls} placeholder="18-28" />
            </Field>
            <Field label="Psychographics">
              <ChipInput value={brand.audience.psychographics} onChange={v => patchAndSave({ audience: { ...brand.audience, psychographics: v } })} placeholder="value-conscious, irony-fluent…" />
            </Field>
          </div>
        </div>

        <div className="rounded-md border border-ink-700 bg-ink-900 p-4">
          <h2 className="text-sm font-semibold text-ink-100 mb-2">Operating posture</h2>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Risk tolerance">
              <select value={brand.riskTolerance} onChange={e => patchAndSave({ riskTolerance: e.target.value as BrandProfile['riskTolerance'] })} className={inputCls}>
                <option value="low">low</option><option value="medium">medium</option><option value="high">high</option>
              </select>
            </Field>
            <Field label="Approval mode">
              <select value={brand.approvalMode} onChange={e => patchAndSave({ approvalMode: e.target.value as BrandProfile['approvalMode'] })} className={inputCls}>
                <option value="strict">strict</option><option value="moderate">moderate</option><option value="fast">fast</option>
              </select>
            </Field>
            <Field label="Crisis mode">
              <button onClick={() => patchAndSave({ crisisMode: !brand.crisisMode })}
                className={`w-full h-9 rounded-md text-xs font-bold uppercase tracking-wider ${brand.crisisMode ? 'bg-signal-red text-white' : 'bg-ink-800 border border-ink-700 text-ink-300'}`}>
                {brand.crisisMode ? 'ON · reactive paused' : 'OFF'}
              </button>
            </Field>
          </div>
          <p className="mt-3 text-2xs text-ink-400">
            Crisis mode floors every trend recommendation to <span className="font-mono text-ink-200">MONITOR</span>. Use during PR incidents.
          </p>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="rounded-md border border-ink-700 bg-ink-900 p-4 sticky top-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-2xs font-semibold uppercase tracking-wider text-ink-300">Save state</h3>
            <Chip tone={
              saveState === 'saved' ? 'good' :
              saveState === 'saving' ? 'warn' :
              saveState === 'error' ? 'bad' : 'neutral'
            }>
              {saveState === 'idle' ? 'autosave on' : saveState}
            </Chip>
          </div>
          <p className="text-2xs text-ink-400">Every change autosaves &amp; rescores trends across your war room.</p>
        </div>

        <ToneTester brand={brand} />

        <div className="rounded-md border border-ink-700 bg-ink-900 p-4">
          <h3 className="text-2xs font-semibold uppercase tracking-wider text-ink-300 mb-2">Quick actions</h3>
          <Button size="sm" variant="outline" className="w-full mb-2" onClick={() => location.assign('/scoring')}>Tune scoring weights</Button>
          <Button size="sm" variant="outline" className="w-full mb-2" onClick={() => location.assign('/connectors')}>Manage connectors</Button>
          <Button size="sm" variant="outline" className="w-full" onClick={() => location.assign('/integrations')}>Webhooks &amp; integrations</Button>
        </div>
      </aside>
    </div>
  );
}

const inputCls = 'block w-full h-9 px-2.5 rounded-md bg-ink-800 border border-ink-700 text-sm text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900 capitalize-none';

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="text-2xs font-mono uppercase tracking-wider text-ink-300">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
