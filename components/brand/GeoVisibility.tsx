'use client';
import * as React from 'react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';

// AI Visibility panel — Feature A surface. Shows the brand's
// citation rate across LLM models, the competitor leaderboard
// (who's getting cited instead of us), and a sample drill-down.
//
// Lives on the /brand page rather than the dashboard board because
// it's a brand-level (not trend-level) measurement that operators
// review weekly, not per-tick.

interface ModelPanel {
  model: string;
  runs: number;
  cited: number;
  citationRate: number;
  avgPosition: number | null;
}
interface Competitor { name: string; mentions: number }
interface RecentSample {
  id: string;
  model: string;
  promptClass: string;
  promptText: string;
  cited: boolean;
  position: number | null;
  snippet: string | null;
  competitorsMentioned: string[];
  runAt: string;
  runFailed: boolean;
  failureReason: string | null;
}
interface Snapshot {
  windowDays: number;
  sampleCount: number;
  runFailedCount: number;
  byModel: ModelPanel[];
  competitors: Competitor[];
  timeline: Array<{ day: string; runs: number; cited: number; citationRate: number }>;
  recent: RecentSample[];
}

export function GeoVisibility() {
  const [snap, setSnap] = React.useState<Snapshot | null>(null);
  const [running, setRunning] = React.useState(false);
  const [windowDays, setWindowDays] = React.useState(7);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch(`/api/geo/snapshot?windowDays=${windowDays}`)
      .then(r => r.json())
      .then(j => { if (j && !j.error) setSnap(j); else setErr(j?.error ?? 'snapshot_failed'); })
      .catch(e => setErr((e as Error).message));
  }, [windowDays]);

  async function runNow() {
    setRunning(true);
    setErr(null);
    try {
      const r = await fetch('/api/geo/run', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) setErr(j?.error ?? `http_${r.status}`);
      // Refetch snapshot after run completes.
      const s = await fetch(`/api/geo/snapshot?windowDays=${windowDays}`).then(x => x.json());
      if (s && !s.error) setSnap(s);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-md border border-ink-700 bg-ink-900 p-4 relative">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-ink-100">AI Visibility (GEO)</h2>
        <div className="flex items-center gap-2">
          <select
            value={windowDays}
            onChange={e => setWindowDays(parseInt(e.target.value, 10))}
            className="text-2xs h-7 px-2 rounded bg-ink-800 border border-ink-700 text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
          >
            <option value={1}>last 24h</option>
            <option value={7}>last 7d</option>
            <option value={30}>last 30d</option>
          </select>
          {/* Desktop: top-right CTA. Mobile: hidden here, the sticky bottom-of-card duplicate below picks it up. */}
          <span className="hidden sm:block">
            <Button size="sm" onClick={runNow} disabled={running}>
              {running ? '… running' : '✦ Run probe'}
            </Button>
          </span>
        </div>
      </div>
      <p className="text-2xs text-ink-300 mb-3">
        Measures whether AI assistants (Claude / GPT / Gemini) name your brand
        when buyers ask about your category. Polls templated prompts × every
        configured model and parses each response for citations + competitor
        mentions. Costs are budget-gated per org via lib/ai/budget.
      </p>

      {err && <p className="text-2xs text-bad-400 mb-2">⚠ {err}</p>}

      {!snap ? (
        <p className="text-2xs text-ink-400 italic">Loading snapshot…</p>
      ) : snap.sampleCount === 0 ? (
        <p className="text-2xs text-ink-400">
          No samples yet. Click <span className="font-mono text-ink-200">Run probe</span> to generate the first batch.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Section title="By model">
              {snap.byModel.length === 0 ? (
                <p className="text-2xs text-ink-400">no model data</p>
              ) : (
                <table className="w-full text-2xs">
                  <thead className="text-ink-400">
                    <tr><th className="text-left">model</th><th>cited</th><th>rate</th><th>pos</th></tr>
                  </thead>
                  <tbody>
                    {snap.byModel.map(m => (
                      <tr key={m.model} className="text-ink-200">
                        <td className="font-mono truncate" title={m.model}>{m.model.slice(0, 18)}</td>
                        <td className="text-center">{m.cited}/{m.runs}</td>
                        <td className="text-center font-mono">
                          <span className={m.citationRate >= 0.5 ? 'text-good-400' : m.citationRate >= 0.2 ? 'text-flare-400' : 'text-bad-400'}>
                            {Math.round(m.citationRate * 100)}%
                          </span>
                        </td>
                        <td className="text-center">{m.avgPosition?.toFixed(1) ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            <Section title="Competitor share-of-AI-voice">
              {snap.competitors.length === 0 ? (
                <p className="text-2xs text-ink-400">no competitors mentioned in samples</p>
              ) : (
                <ul className="space-y-1 text-2xs">
                  {snap.competitors.slice(0, 8).map(c => (
                    <li key={c.name} className="flex items-center justify-between">
                      <span className="capitalize text-ink-200">{c.name}</span>
                      <Chip tone="bad" className="text-2xs">{c.mentions}</Chip>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <Section title={`Recent samples (${snap.recent.length})`}>
            {/* Lift the inner-scroll cap. The 50vh ceiling adapts to the
                viewport instead of fixed 288px — fewer nested-scroll
                trap moments per Round-2 Visual Auditor §A.3. */}
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {snap.recent.map(r => (
                <div key={r.id} className="rounded border border-ink-700 bg-ink-800/40 p-2 text-2xs">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Chip tone={r.runFailed ? 'bad' : r.cited ? 'good' : 'neutral'}>
                      {r.runFailed ? 'failed' : r.cited ? `cited #${r.position ?? '?'}` : 'no mention'}
                    </Chip>
                    <span className="font-mono text-ink-400">{r.model}</span>
                    <span className="text-ink-500">·</span>
                    <span className="text-ink-400">{r.promptClass}</span>
                    <span className="ml-auto text-ink-500">{new Date(r.runAt).toLocaleTimeString()}</span>
                  </div>
                  <p className="text-ink-300 italic line-clamp-2">{r.promptText}</p>
                  {r.snippet && (
                    <p className="mt-1 text-ink-200 border-l-2 border-good-500 pl-2">{r.snippet}</p>
                  )}
                  {r.failureReason && <p className="mt-1 text-bad-400">{r.failureReason}</p>}
                </div>
              ))}
            </div>
          </Section>

          <p className="mt-2 text-2xs text-ink-500">
            window: {snap.windowDays}d · samples: {snap.sampleCount} · failed: {snap.runFailedCount}
          </p>
        </>
      )}

      {/* Mobile sticky CTA — duplicate of the desktop "Run probe" button
          that lives in the header. On a phone the panel is taller than
          the viewport and the only CTA is at the top; this puts it in
          the thumb arc per Round-2 Visual Auditor §B. */}
      <div className="sm:hidden sticky bottom-2 mt-3 flex justify-end">
        <Button size="sm" onClick={runNow} disabled={running} className="shadow-pop">
          {running ? '… running' : '✦ Run probe'}
        </Button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-2xs font-mono uppercase tracking-wider text-ink-300 mb-1.5">{title}</h3>
      {children}
    </div>
  );
}
