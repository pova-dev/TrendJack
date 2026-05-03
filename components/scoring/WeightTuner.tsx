'use client';
import * as React from 'react';
import type { BrandProfile, ScoringWeights, Trend } from '@/types';
import { Chip } from '@/components/ui/Chip';
import { Button } from '@/components/ui/Button';

interface Props {
  brand: BrandProfile;
  trends: Trend[]; // top-50 from server, used for the live preview
}

const ROWS: Array<{ key: keyof ScoringWeights; label: string; sign: 1 | -1; helper: string }> = [
  { key: 'virality',      label: 'Virality',       sign: 1,  helper: 'Velocity tanh + reach diminishing returns.' },
  { key: 'brandFit',      label: 'Brand fit',      sign: 1,  helper: 'topical · tonal · audience-overlap composite.' },
  { key: 'timing',        label: 'Timing',         sign: 1,  helper: 'Bell curve over age vs estimated peak life.' },
  { key: 'firstMover',    label: 'First mover',    sign: 1,  helper: 'Higher when no brand posts yet.' },
  { key: 'saturation',    label: 'Saturation',     sign: -1, helper: 'Sigmoid-penalized past 0.6.' },
  { key: 'risk',          label: 'Risk',           sign: -1, helper: 'Banned topic + sentiment + tolerance.' },
  { key: 'cringe',        label: 'Cringe',         sign: -1, helper: 'Cliché + voice-collision detector.' },
  { key: 'formatFatigue', label: 'Format fatigue', sign: -1, helper: 'Template/audio overuse in last 24h.' },
  { key: 'effort',        label: 'Effort',         sign: -1, helper: 'Asset · approval · production composite.' },
];

export function WeightTuner({ brand, trends }: Props) {
  const [weights, setWeights] = React.useState<ScoringWeights>(brand.scoringWeights);
  const [saveState, setSaveState] = React.useState<'idle'|'saving'|'saved'|'error'>('idle');
  const debouncer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Local re-rank using the same component formula (without re-running the
  // full engine — we already have per-trend axis scores in `trend.scores`).
  const ranked = React.useMemo(() => {
    return [...trends]
      .map(t => ({ trend: t, projected: project(t, weights) }))
      .sort((a, b) => b.projected - a.projected);
  }, [trends, weights]);

  function update(key: keyof ScoringWeights, value: number) {
    const next = { ...weights, [key]: value };
    setWeights(next);
    setSaveState('saving');
    if (debouncer.current) clearTimeout(debouncer.current);
    debouncer.current = setTimeout(async () => {
      const res = await fetch('/api/brand', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scoringWeights: next }),
      });
      setSaveState(res.ok ? 'saved' : 'error');
      setTimeout(() => setSaveState('idle'), 1200);
    }, 500);
  }

  function reset() {
    update('virality', 0.28);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 rounded-md border border-ink-700 bg-ink-900 divide-y divide-ink-700">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink-100">Scoring weights</h2>
            <p className="text-2xs text-ink-300">Drag a slider — top trends re-rank instantly. Live to every teammate.</p>
          </div>
          <Chip tone={saveState === 'saved' ? 'good' : saveState === 'saving' ? 'warn' : saveState === 'error' ? 'bad' : 'neutral'}>
            {saveState === 'idle' ? 'autosave on' : saveState}
          </Chip>
        </div>
        {ROWS.map(r => {
          const v = weights[r.key] ?? 0;
          return (
            <div key={r.key} className="flex items-center gap-3 px-4 py-2.5">
              <div className="w-32">
                <div className="text-sm text-ink-100 font-medium">{r.label}</div>
                <Chip tone={r.sign === 1 ? 'good' : 'bad'}>{r.sign === 1 ? '+' : '−'}</Chip>
              </div>
              <input
                type="range" min={0} max={r.sign === 1 ? 0.5 : 0.3} step={0.005}
                value={v}
                onChange={e => update(r.key, Number(e.target.value))}
                className="flex-1 accent-flare-500"
              />
              <span className="font-mono text-sm tabular-nums text-ink-100 w-12 text-right">{v.toFixed(3)}</span>
            </div>
          );
        })}
      </div>

      <div className="rounded-md border border-ink-700 bg-ink-900 p-3">
        <h3 className="text-2xs font-semibold uppercase tracking-wider text-ink-300 mb-2">Live top 8 (projected)</h3>
        <ol className="space-y-1.5">
          {ranked.slice(0, 8).map(({ trend, projected }, i) => (
            <li key={trend.id} className="flex items-center gap-2 text-xs">
              <span className="font-mono text-ink-400 w-5 tabular-nums text-right">{i + 1}.</span>
              <span className="font-mono w-9 text-right tabular-nums text-flare-400">{Math.round(projected * 100)}</span>
              <span className="flex-1 truncate text-ink-100">{trend.title}</span>
            </li>
          ))}
          {ranked.length === 0 && <li className="text-2xs text-ink-400">No trends yet.</li>}
        </ol>
        <Button size="sm" variant="ghost" className="mt-3 w-full" onClick={reset}>Bump virality (test rerank)</Button>
      </div>
    </div>
  );
}

function project(t: Trend, w: ScoringWeights): number {
  const s = t.scores;
  const satPenalty = sigmoid01(s.saturation, 0.6, 12);
  return clamp01(
    w.virality      * s.virality      +
    w.brandFit      * s.brandFit      +
    w.timing        * s.timing        +
    w.firstMover    * s.firstMover    -
    w.saturation    * satPenalty      -
    w.risk          * s.risk          -
    w.cringe        * s.cringe        -
    w.formatFatigue * s.formatFatigue -
    w.effort        * s.effort,
  );
}
function clamp01(n: number) { return Math.max(0, Math.min(1, n)); }
function sigmoid01(x: number, mid: number, k: number) { return 1 / (1 + Math.exp(-k * (x - mid))); }
