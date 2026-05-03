'use client';
import * as React from 'react';
import type { Trend } from '@/types';
import { Drawer } from '@/components/ui/Drawer';
import { Tabs } from '@/components/ui/Tabs';
import { SourceIcon, sourceLabel } from '@/components/trend/SourceIcon';
import { VelocityIndicator } from '@/components/trend/VelocityIndicator';
import { RecommendationBadge } from '@/components/trend/RecommendationBadge';
import { ScoreChip } from '@/components/trend/ScoreChip';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { formatBig, relTime, timeUntil, pct } from '@/lib/utils';
import { resolveSourceUrl } from '@/lib/source-link';
import { Sparkline } from '@/components/trend/Sparkline';
import { cn } from '@/lib/utils';
import { displayLineage } from '@/lib/lineage-display';

// Static display data for the Hook Library + Templates picker. Mirrors
// what's in src/agents/creative/hooks.ts and templates.ts but inlined
// here so this client component doesn't pull in the agent layer's
// server-only deps.
const HOOK_LIBRARY_DISPLAY = [
  { id: 'challenger',      label: 'Challenger',     risk: 'edgy',  angle: 'Brand does the opposite of the trend, and wins by it.' },
  { id: 'educator',        label: 'Educator',       risk: 'safe',  angle: 'The tech / story behind the trend, explained simply.' },
  { id: 'comedian',        label: 'Comedian',       risk: 'edgy',  angle: 'Self-aware, anti-marketing wit. Cringe must be low.' },
  { id: 'expert_reaction', label: 'Expert',         risk: 'safe',  angle: "Here's what we'd actually do — and why." },
  { id: 'told_you_so',     label: 'Told You So',    risk: 'edgy',  angle: "Trend proves the brand's prior thesis." },
  { id: 'meta_observer',   label: 'Meta Observer',  risk: 'safe',  angle: 'Acknowledge without engaging the controversy.' },
  { id: 'positional',      label: 'Positional',     risk: 'spicy', angle: 'Take a stance contrasting the polarized noise.' },
] as const;

const TEMPLATE_DISPLAY = [
  { id: 'x-thread-3',       label: 'X Thread (3)' },
  { id: 'x-single',         label: 'X Single' },
  { id: 'ig-carousel-5',    label: 'IG Carousel (5)' },
  { id: 'tiktok-script-30s',label: 'TikTok 30s' },
  { id: 'linkedin-200w',    label: 'LinkedIn ~200w' },
] as const;

interface Props {
  trend: Trend | null;
  open: boolean;
  onClose: () => void;
  onAction: (id: string, type: 'save' | 'dismiss' | 'generate' | 'assign' | 'pin') => void;
}

type TabKey = 'overview' | 'scores' | 'drafts' | 'lineage' | 'research' | 'battle';

interface VerifiedClaimRender {
  id: string;
  key: string;
  value: string;
  sourceUrl: string;
  quotedSpan: string;
  confidence: number;
}
interface UnverifiedClaimRender {
  key: string;
  reason: string;
}
interface ResearchPayload {
  cached?: boolean;
  query?: string;
  summary?: string;
  keyFacts?: { label: string; value: string }[];
  sources?: { title: string; url: string; snippet?: string }[];
  provider?: string;
  searchBackend?: string;
  generatedAt?: string;
  aiSummarized?: boolean;
  // Phase-6 Verifier output: every claim has a sourceUrl + quotedSpan +
  // confidence. Drafts can ONLY cite from this list — anything in
  // unverifiedClaims is forbidden.
  verifiedClaims?: VerifiedClaimRender[];
  unverifiedClaims?: UnverifiedClaimRender[];
  verifierProvider?: string;
  verifierModel?: string;
}

export function DetailDrawer({ trend, open, onClose, onAction }: Props) {
  const [tab, setTab] = React.useState<TabKey>('overview');
  const [draftsResult, setDraftsResult] = React.useState<DraftsResult | null>(null);
  const drafts = draftsResult?.drafts ?? null;
  const setDrafts = (d: AIDraft[] | null) => setDraftsResult(d ? { drafts: d } : null);
  const [generating, setGenerating] = React.useState(false);
  const [research, setResearch] = React.useState<ResearchPayload | null>(null);
  const [researching, setResearching] = React.useState(false);

  // History (time-series) — fetched lazily per range
  const [history, setHistory] = React.useState<{ samples: { t: string; velocity: number; reach: number; opportunity: number }[] } | null>(null);
  const [historyRange, setHistoryRange] = React.useState<'24h' | '7d' | '30d'>('7d');

  // Real Google Trends interest-over-time curve (gtrends source only).
  // Replaces the velocity-sample sparkline for gtrends trends — those
  // velocity samples are TrendJack's own readings starting at 0 the
  // moment we first saw the trend, which is misleading for items that
  // peaked hours before we ingested them.
  const [iot, setIot] = React.useState<{ points: { time: number; label: string; value: number }[]; peak: number } | null>(null);
  const [iotErr, setIotErr] = React.useState<string | null>(null);
  const [iotLoading, setIotLoading] = React.useState(false);

  // Battle-Card state — only relevant for trends with competitorClaimed=true.
  // Lazy-loaded when the operator opens the Battle tab.
  const [battleCard, setBattleCard] = React.useState<BattleCardPayload | null>(null);
  const [battleLoading, setBattleLoading] = React.useState(false);
  const [battleErr, setBattleErr] = React.useState<string | null>(null);

  // Deep lineage probe
  const [lineage, setLineage] = React.useState<unknown | null>(null);
  const [probingLineage, setProbingLineage] = React.useState(false);

  React.useEffect(() => {
    setTab('overview'); setDrafts(null); setResearch(null); setHistory(null); setLineage(null);
    setIot(null); setIotErr(null);
    setBattleCard(null); setBattleErr(null);
  }, [trend?.id]);

  // Lazy-load existing battle-card when Battle tab opens.
  React.useEffect(() => {
    if (!trend || tab !== 'battle' || battleCard !== null || battleLoading) return;
    let cancelled = false;
    setBattleLoading(true);
    fetch(`/api/trends/${trend.id}/battle-card`)
      .then(async r => {
        if (cancelled) return;
        if (r.status === 404) return; // no card yet — operator will click Generate
        if (!r.ok) { setBattleErr(`http_${r.status}`); return; }
        const j = await r.json();
        setBattleCard(j);
      })
      .catch(e => { if (!cancelled) setBattleErr((e as Error).message); })
      .finally(() => { if (!cancelled) setBattleLoading(false); });
    return () => { cancelled = true; };
  }, [trend?.id, tab, battleCard, battleLoading]);

  async function handleGenerateBattleCard() {
    if (!trend) return;
    setBattleLoading(true);
    setBattleErr(null);
    try {
      const res = await fetch(`/api/trends/${trend.id}/battle-card`, { method: 'POST' });
      const j = await res.json();
      if (!res.ok) {
        setBattleErr(j?.message || j?.error || `http_${res.status}`);
      } else {
        setBattleCard(j);
      }
    } catch (e) {
      setBattleErr((e as Error).message);
    } finally {
      setBattleLoading(false);
    }
  }

  // Real Google Trends interest-over-time fetch — gtrends trends only.
  // Maps the drawer's range chip to Google's time-range tokens.
  React.useEffect(() => {
    if (!trend || trend.source !== 'google_trends') { setIot(null); return; }
    const range = historyRange === '24h' ? 'now 1-d' : historyRange === '7d' ? 'now 7-d' : 'today 1-m';
    let cancelled = false;
    setIotLoading(true);
    setIotErr(null);
    fetch(`/api/trends/${trend.id}/interest-over-time?range=${encodeURIComponent(range)}`)
      .then(async r => {
        const j = await r.json().catch(() => null);
        if (cancelled) return;
        if (!r.ok) {
          setIotErr(j?.message || j?.error || `http_${r.status}`);
          setIot(null);
        } else if (j?.points) {
          setIot({ points: j.points, peak: j.peak ?? 0 });
        }
      })
      .catch(e => { if (!cancelled) setIotErr((e as Error).message); })
      .finally(() => { if (!cancelled) setIotLoading(false); });
    return () => { cancelled = true; };
  }, [trend?.id, trend?.source, historyRange]);

  // Lazy-load cached lineage when a trend is opened.
  React.useEffect(() => {
    if (!trend) return;
    fetch(`/api/trends/${trend.id}/lineage`).then(r => r.json()).then(j => {
      if (j.cached) setLineage(j);
    }).catch(() => {});
  }, [trend?.id]);

  async function handleLineage() {
    if (!trend) return;
    setProbingLineage(true);
    try {
      const res = await fetch(`/api/trends/${trend.id}/lineage`, { method: 'POST' });
      const json = await res.json();
      if (json && !json.error) setLineage(json);
    } finally { setProbingLineage(false); }
  }

  // Eager-load history when a trend is opened so the sparkline shows up
  // without an extra click. Re-fetches when the range changes.
  React.useEffect(() => {
    if (!trend) return;
    fetch(`/api/trends/${trend.id}/history?range=${historyRange}`)
      .then(r => r.json())
      .then(j => setHistory(j))
      .catch(() => setHistory({ samples: [] }));
  }, [trend?.id, historyRange]);

  // Eagerly load any cached research when a trend is opened so the overview
  // tab can render it inline without the user switching tabs.
  React.useEffect(() => {
    if (!trend) return;
    setResearch(null);
    fetch(`/api/trends/${trend.id}/research`).then(r => r.json()).then(j => {
      if (j.cached) setResearch(j as ResearchPayload);
    }).catch(() => {});
  }, [trend?.id]);

  if (!trend) return <Drawer open={false} onClose={onClose}>{null}</Drawer>;

  const peak = timeUntil(trend.peakWindowEnd);

  async function handleGenerate(replace = false, hookId?: string, templateId?: string) {
    if (!trend) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/trends/${trend.id}/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ replace, hookId, templateId }),
      });
      const json = await res.json();
      setDraftsResult(json);
      setTab('drafts');
    } finally { setGenerating(false); }
  }

  async function handleResearch(backend: string = 'auto') {
    if (!trend) return;
    setResearching(true);
    try {
      const res = await fetch(`/api/trends/${trend.id}/research`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ backend }),
      });
      const json = await res.json();
      setResearch(json as ResearchPayload);
    } finally { setResearching(false); }
  }

  return (
    <Drawer open={open} onClose={onClose} width={560}>
      <div className="flex flex-col h-full">
        <header className="px-5 pt-4 pb-3 border-b border-ink-700">
          <div className="flex items-center gap-2 text-2xs text-ink-300 mb-2">
            <SourceIcon source={trend.source} />
            <span className="font-mono uppercase">{sourceLabel(trend.source)}</span>
            <span className="text-ink-500">·</span>
            <span>{relTime(trend.firstSeenAt)}</span>
            <VelocityIndicator className="ml-auto" velocity={trend.velocity} />
          </div>
          <h1 className="text-base font-semibold text-ink-100 leading-snug">{trend.title}</h1>
          <p className="text-xs text-ink-300/80 mt-1">{trend.summary}</p>
          <div className="flex items-center gap-2 mt-3">
            <RecommendationBadge rec={trend.recommendation} />
            <span className="text-2xs font-mono text-ink-300">⏱ <span className={peak.expired ? 'text-ink-500' : 'text-flare-400'}>{peak.label}</span></span>
            <span className="text-2xs font-mono text-ink-300 ml-auto">
              reach {Number(trend.reach) > 0 ? formatBig(Number(trend.reach)) : '—'}
            </span>
          </div>
          <a href={resolveSourceUrl(trend)} target="_blank" rel="noreferrer noopener"
             className="inline-flex items-center gap-1 mt-2 text-xs text-flare-400 hover:underline">
            {trend.url ? 'Open original on ' : 'Search '}{sourceLabel(trend.source)} ↗
          </a>
        </header>

        <Tabs
          value={tab}
          onChange={v => setTab(v as TabKey)}
          tabs={[
            { value: 'overview', label: 'Overview' },
            { value: 'scores',   label: 'Scores' },
            { value: 'drafts',   label: 'Drafts',   count: drafts?.length },
            { value: 'research', label: 'Research', count: research?.sources?.length },
            ...(trend.competitorClaimed
              ? [{ value: 'battle', label: 'Battle' } as const]
              : []),
            { value: 'lineage',  label: 'Lineage' },
          ]}
          className="px-3"
        />

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs text-ink-200 leading-relaxed">
          {tab === 'overview' && (
            <OverviewTab
              trend={trend}
              research={research}
              researching={researching}
              onResearch={handleResearch}
              history={history}
              historyRange={historyRange}
              setHistoryRange={setHistoryRange}
              iot={iot}
              iotLoading={iotLoading}
              iotErr={iotErr}
            />
          )}
          {tab === 'scores'   && <ScoresTab trend={trend} />}
          {tab === 'drafts'   && <DraftsTab result={draftsResult} generating={generating} onGenerate={handleGenerate} />}
          {tab === 'research' && <ResearchTab data={research} loading={researching} onRun={handleResearch} />}
          {tab === 'battle'   && <BattleTab card={battleCard} loading={battleLoading} err={battleErr} onGenerate={handleGenerateBattleCard} />}
          {tab === 'lineage'  && <LineageTab trend={trend} probe={lineage} loading={probingLineage} onProbe={handleLineage} />}
        </div>

        <footer className="border-t border-ink-700 px-4 py-3 flex items-center gap-2 bg-ink-900">
          {trend.recommendation === 'POST_NOW' ? (
            <Button variant="primary" size="md" onClick={() => handleGenerate(false)} disabled={generating}>
              {generating ? 'Generating…' : 'Generate & ship'}
            </Button>
          ) : trend.recommendation === 'PREP_1H' ? (
            <Button variant="primary" size="md" onClick={() => handleGenerate(false)} disabled={generating}>
              {generating ? 'Generating…' : 'Draft for 1h window'}
            </Button>
          ) : (
            <Button variant="subtle" size="md" onClick={() => handleGenerate(false)} disabled={generating}>
              {generating ? 'Generating…' : 'Generate anyway'}
            </Button>
          )}
          <Button variant="outline" size="md" onClick={() => setTab('research')}>Research</Button>
          <Button variant="ghost" size="md" onClick={() => onAction(trend.id, 'pin')}>{trend.pinned ? 'Unpin' : 'Pin'}</Button>
          <Button variant="ghost" size="md" className="ml-auto text-ink-300 hover:text-signal-red" onClick={() => { onAction(trend.id, 'dismiss'); onClose(); }}>
            Dismiss
          </Button>
        </footer>
      </div>
    </Drawer>
  );
}

// -----------------------------------------------------------------------------

function OverviewTab({ trend, research, researching, onResearch, history, historyRange, setHistoryRange, iot, iotLoading, iotErr }: {
  trend: Trend;
  research: ResearchPayload | null;
  researching: boolean;
  onResearch: (backend?: string) => void;
  history: { samples: { t: string; velocity: number; reach: number; opportunity: number }[] } | null;
  historyRange: '24h' | '7d' | '30d';
  setHistoryRange: (r: '24h' | '7d' | '30d') => void;
  iot: { points: { time: number; label: string; value: number }[]; peak: number } | null;
  iotLoading: boolean;
  iotErr: string | null;
}) {
  const showIot = trend.source === 'google_trends';
  return (
    <>
      <Section title="Why now">
        <p className="text-ink-100">{displayLineage(trend.lineage)}</p>
        {trend.catalyst && <p className="mt-1 text-ink-300">Catalyst: <span className="text-ink-100">{trend.catalyst}</span></p>}
      </Section>

      <Section title={
        <span className="flex items-center justify-between">
          <span>Trend over time</span>
          <span className="flex items-center gap-1">
            {(['24h','7d','30d'] as const).map(r => (
              <button
                key={r}
                onClick={() => setHistoryRange(r)}
                className={`text-2xs font-mono px-1.5 py-0.5 rounded ${historyRange === r ? 'bg-flare-500/20 text-flare-400' : 'text-ink-400 hover:text-ink-200'}`}
              >{r}</button>
            ))}
          </span>
        </span>
      }>
        {showIot ? (
          iot && iot.points.length > 0 ? (
            <>
              <Sparkline
                samples={iot.points.map(p => ({
                  t: new Date(p.time * 1000).toISOString(),
                  velocity: p.value,
                  reach: 0,
                  opportunity: 0,
                }))}
                metric="velocity"
                height={56}
              />
              <p className="text-2xs text-ink-400 mt-1">
                Real Google Trends interest, 0–100 normalised within this window
                (peak {iot.peak}). Source: trends.google.com.
              </p>
            </>
          ) : iotLoading ? (
            <p className="text-2xs text-ink-400 italic">Loading Google Trends curve…</p>
          ) : iotErr === 'rate_limited' ? (
            <p className="text-2xs text-ink-400">
              Google Trends rate-limited this IP. Try again in a few minutes — the
              series caches for 1h once it loads.
            </p>
          ) : iotErr ? (
            <p className="text-2xs text-ink-400">Couldn&apos;t load curve: {iotErr}.</p>
          ) : (
            <p className="text-2xs text-ink-400 italic">No interest data yet.</p>
          )
        ) : (
          <>
            <Sparkline samples={history?.samples ?? []} metric="velocity" height={56} />
            <p className="text-2xs text-ink-400 mt-1">
              Velocity samples over the {historyRange === '24h' ? 'last 24 hours' : historyRange === '7d' ? 'last 7 days' : 'last 30 days'}.
              Each refresh appends a sample, so this builds up automatically.
            </p>
          </>
        )}
      </Section>

      {/* Trajectory — Predictive Virality Phase 2. Renders the forecast in
          operator-readable form: current phase, predicted peak time
          (relative), and confidence. Only when forecastPeak has produced
          a result (≥3 samples). The TrendCard pill is a scan-level
          summary; this is the deeper read. */}
      {trend.cascadePhase && trend.predictedPeakConfidence !== undefined && trend.predictedPeakConfidence > 0 && (
        <Section title="Trajectory">
          <TrajectoryView trend={trend} />
        </Section>
      )}

      <Section title="Recommendation"><p>{trend.recommendationReason}</p></Section>
      {/* Score snapshot intentionally NOT rendered here. The TrendCard
          already shows OPP/FIT/RISK/CRINGE at scan-level; the dedicated
          Scores tab below shows the full 8-axis breakdown with
          rationale. Duplicating them in Overview was a P0 finding from
          the Trinity Swarm Visual Auditor — operators saw the same
          chips twice within 400ms of opening the drawer. */}
      {trend.competitorClaimed && (
        <Section title="Already claimed">
          <div className="flex flex-wrap gap-1">{trend.competitorClaimants.map(c => <Chip key={c} tone="bad">{c}</Chip>)}</div>
          <p className="mt-1 text-ink-300">Doubling-down behind these brands is dilutive. Pivot the angle or skip.</p>
        </Section>
      )}
      <Section title="Hashtags">
        <div className="flex flex-wrap gap-1">{trend.hashtags.map(h => <Chip key={h} tone="info">{h}</Chip>)}</div>
      </Section>
      {trend.examples?.length ? (
        <Section title="Examples">
          {trend.examples.map((e, i) => (
            <blockquote key={i} className="border-l-2 border-ink-600 pl-2 text-ink-200 mb-2">
              <span className="font-mono text-ink-400 text-2xs">{e.author} · {e.platform}</span>
              <p>{e.text}</p>
              {e.url && <a href={e.url} target="_blank" rel="noreferrer noopener" className="text-2xs text-flare-400 hover:underline">view ↗</a>}
            </blockquote>
          ))}
        </Section>
      ) : null}

      {/* Research strip — one-line summary only on Overview. The full
          panel lives on the Research tab. Was previously the entire
          ResearchPanel rendered twice (P0b from the Trinity Swarm
          Visual Auditor). */}
      <ResearchSummaryStrip research={research} loading={researching} />
    </>
  );
}

// ─── Battle-Card types + tab ──────────────────────────────────────────────
interface BattleCardAngleRender { angle: string; rationale: string; exampleHook: string }
interface BattleCardPayload {
  id: string;
  trendId: string;
  verdict: 'counter' | 'ignore' | 'out-flank' | 'monitor';
  verdictReason: string;
  payload: {
    angleOptions: BattleCardAngleRender[];
    counterClaim: string | null;
    doNotDo: string[];
    saturationScore: number;
    competitorClaimants: string[];
    provider?: string;
    model?: string;
  };
  generatedAt: string;
  promptVersion?: string;
}

function BattleTab({ card, loading, err, onGenerate }: {
  card: BattleCardPayload | null;
  loading: boolean;
  err: string | null;
  onGenerate: () => void;
}) {
  if (loading && !card) {
    return <p className="text-2xs text-ink-400 italic">Working on the battle card…</p>;
  }
  if (!card) {
    return (
      <Section title="Battle Card">
        <p className="text-xs text-ink-300">
          A competitor has claimed this trend. Generate a structured Win/Loss
          card — verdict, angle options, counter-claim, do-not-do moves —
          via premium AI.
        </p>
        {err && <p className="text-2xs text-bad-400 mt-1">{err === 'budget_exhausted' ? 'Daily AI budget exhausted for this org.' : `Error: ${err}`}</p>}
        <div className="mt-2">
          <Button size="sm" onClick={onGenerate}>✦ Generate battle card</Button>
        </div>
      </Section>
    );
  }
  const verdictTone =
    card.verdict === 'counter'   ? 'good' :
    card.verdict === 'out-flank' ? 'flare' :
    card.verdict === 'monitor'   ? 'info' :
                                   'warn';
  return (
    <>
      <Section title="Verdict">
        <div className="flex items-center gap-2">
          <Chip tone={verdictTone} className="uppercase tracking-wider">{card.verdict}</Chip>
          <span className="text-2xs text-ink-400 font-mono">
            saturation {Math.round(card.payload.saturationScore * 100)}%
          </span>
        </div>
        <p className="mt-2 text-ink-100">{card.verdictReason}</p>
        {card.payload.competitorClaimants.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {card.payload.competitorClaimants.map(c => (
              <Chip key={c} tone="bad">{c}</Chip>
            ))}
          </div>
        )}
      </Section>

      {card.payload.counterClaim && (
        <Section title="Counter-claim">
          <blockquote className="border-l-2 border-flare-500 pl-2 text-ink-100 italic">
            {card.payload.counterClaim}
          </blockquote>
        </Section>
      )}

      {card.payload.angleOptions.length > 0 && (
        <Section title={`Angle options (${card.payload.angleOptions.length})`}>
          <div className="space-y-2">
            {card.payload.angleOptions.map((a, i) => (
              <div key={i} className="rounded-md border border-ink-700 bg-ink-900 p-2">
                <p className="text-ink-100 font-semibold">{a.angle}</p>
                <p className="text-2xs text-ink-300 mt-0.5">{a.rationale}</p>
                {a.exampleHook && (
                  <p className="text-2xs text-flare-400/80 mt-1 italic">→ {a.exampleHook}</p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {card.payload.doNotDo.length > 0 && (
        <Section title="Do not do">
          <ul className="space-y-0.5 text-ink-200">
            {card.payload.doNotDo.map((d, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-bad-400 flex-shrink-0">✗</span>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Card metadata">
        <p className="text-2xs text-ink-400">
          Generated {new Date(card.generatedAt).toLocaleString()}
          {card.payload.provider && ` · ${card.payload.provider}/${card.payload.model}`}
          {card.promptVersion && ` · prompt ${card.promptVersion}`}
        </p>
        <div className="mt-1.5">
          <Button size="sm" variant="outline" onClick={onGenerate}>↻ Regenerate</Button>
        </div>
      </Section>
    </>
  );
}

// ─── Trajectory view (Predictive Virality Phase 2) ────────────────────────
function TrajectoryView({ trend }: { trend: Trend }) {
  // Hydration-safe `now` per CLAUDE.md rule #10. Predicted peak
  // time relative to wall-clock — must not run during SSR.
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const phase = trend.cascadePhase!;
  const conf = trend.predictedPeakConfidence ?? 0;
  const phaseLabel =
    phase === 'fast-growing-initial' ? 'Growing' :
    phase === 'peaking'              ? 'Peaking' :
    phase === 'decaying'             ? 'Decaying' :
                                       phase;
  const phaseTone =
    phase === 'fast-growing-initial' ? 'good' :
    phase === 'peaking'              ? 'flare' :
    phase === 'decaying'             ? 'warn' :
                                       'neutral';
  const advice =
    phase === 'fast-growing-initial' ? 'Action window is open. Earlier is better.' :
    phase === 'peaking'              ? 'Approaching peak — post within the next few hours or hold.' :
    phase === 'decaying'             ? 'Past the peak. New takes underperform — pivot or skip.' :
                                       'Insufficient samples for a reliable read.';

  // Predicted peak countdown
  let peakCopy: string = '—';
  if (now != null && trend.predictedPeakAt) {
    const dtH = (new Date(trend.predictedPeakAt).getTime() - now) / 3_600_000;
    if (dtH > 1)         peakCopy = `predicted peak in ${dtH.toFixed(1)}h`;
    else if (dtH > 0)    peakCopy = `predicted peak in ${Math.round(dtH * 60)}m`;
    else if (dtH > -2)   peakCopy = `predicted peak just now (${Math.abs(Math.round(dtH * 60))}m ago)`;
    else                 peakCopy = `predicted peak ${Math.abs(dtH).toFixed(1)}h ago`;
  }

  return (
    <>
      <div className="flex items-center gap-2 mb-1.5">
        <Chip tone={phaseTone} className="uppercase tracking-wider">{phaseLabel}</Chip>
        <span className="text-2xs font-mono text-ink-300">{Math.round(conf * 100)}% conf</span>
        <span className="text-2xs text-ink-400">·</span>
        <span className="text-2xs text-ink-300">{peakCopy}</span>
      </div>
      <p className="text-2xs text-ink-300/80 italic">{advice}</p>
      {conf < 0.4 && (
        <p className="text-2xs text-ink-400 mt-1">
          Low confidence — based on a small sample. Re-check after the next ingest tick.
        </p>
      )}
    </>
  );
}

function ResearchSummaryStrip({ research, loading }: {
  research: ResearchPayload | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <Section title="Web research">
        <p className="text-2xs text-ink-400 italic">Researching…</p>
      </Section>
    );
  }
  if (!research) {
    return (
      <Section title="Web research">
        <p className="text-2xs text-ink-400">
          No research yet — open the <span className="font-mono text-ink-200">Research</span> tab to run a probe.
        </p>
      </Section>
    );
  }
  const verified = research.verifiedClaims?.length ?? 0;
  const unverified = research.unverifiedClaims?.length ?? 0;
  const sourceCount = research.sources?.length ?? 0;
  let topHost: string | null = null;
  try {
    if (research.sources?.[0]?.url) topHost = new URL(research.sources[0].url).hostname.replace(/^www\./, '');
  } catch { /* ignore */ }
  return (
    <Section title="Web research">
      <p className="text-xs text-ink-200">
        {verified > 0 ? <><span className="text-good-400 font-mono">{verified}</span> verified claim{verified === 1 ? '' : 's'}</> : <span className="text-ink-400">no verified claims</span>}
        {unverified > 0 && <> · <span className="text-ink-400 font-mono">{unverified} unverified</span></>}
        {sourceCount > 0 && <> · <span className="text-ink-300">{sourceCount} source{sourceCount === 1 ? '' : 's'}{topHost ? ` (top: ${topHost})` : ''}</span></>}
      </p>
      <p className="mt-1 text-2xs text-ink-400">
        Open the <span className="font-mono text-ink-200">Research</span> tab for full citations + per-claim quoted spans.
      </p>
    </Section>
  );
}

function ScoresTab({ trend }: { trend: Trend }) {
  return (
    <div className="space-y-3">
      {trend.rationale.map((r, i) => (
        <div key={i} className="rounded-md border border-ink-700 bg-ink-800/50 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-mono text-2xs uppercase tracking-wider text-ink-300">{r.axis}</span>
            <span className="font-mono text-xs tabular-nums text-ink-100">{pct(r.value)}</span>
          </div>
          <div className="h-1 bg-ink-700 rounded">
            <div className="h-full bg-flare-500 rounded" style={{ width: pct(r.value) }} />
          </div>
          <ul className="mt-2 space-y-0.5 text-2xs text-ink-300">
            {r.reasons.map((rr, j) => <li key={j}>· {rr}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** AI-produced draft. Field shapes vary slightly across model outputs so
 *  every render-time access is wrapped in String()/Number() for safety. */
interface AIDraft {
  variant?: string;
  platform?: string;
  hook?: string;
  body?: string;
  cta?: string;
  visualBrief?: string;
  whyItWorks?: string;
  whatNotToSay?: string;
  cringeScore?: number;
}

interface DraftsResult {
  drafts: AIDraft[];
  mode?: 'live' | 'mock';
  provider?: string;
  model?: string;
  tier?: string;
  hadResearch?: boolean;
  aiError?: string;
  skip?: { reason: string; suggestion: string };
  variantsChosen?: string[];
  variantsSkipped?: { variant: string; reason: string }[];
}

function DraftsTab({ result, generating, onGenerate }: {
  result: DraftsResult | null;
  generating: boolean;
  onGenerate: (replace?: boolean, hookId?: string, templateId?: string) => void;
}) {
  // Operator's hook + template selection. null = auto-pick (let AI decide).
  const [selectedHook, setSelectedHook] = React.useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = React.useState<string | null>(null);

  if (!result) {
    return (
      <div className="space-y-4 py-2">
        <div className="text-ink-300 text-xs">
          Drafts compose from a <span className="text-ink-100">Template</span> (channel structure)
          + <span className="text-ink-100">Hook</span> (psychological angle) + <span className="text-ink-100">Context</span> (verified
          claims + brand voice). Click a Hook or Template to lock the angle, or let the AI auto-pick.
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-2xs font-mono uppercase tracking-wider text-ink-300">Hook Library</h4>
            {selectedHook && (
              <button
                onClick={() => setSelectedHook(null)}
                className="text-2xs text-ink-400 hover:text-ink-100 underline"
              >
                clear · auto-pick
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {HOOK_LIBRARY_DISPLAY.map(h => {
              const active = selectedHook === h.id;
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setSelectedHook(active ? null : h.id)}
                  className={cn(
                    'text-left rounded-md border p-2 transition-colors',
                    active
                      ? 'border-flare-500 bg-flare-500/10'
                      : 'border-ink-700 bg-ink-800/40 hover:border-ink-600 hover:bg-ink-800/60',
                  )}
                  title={`Click to ${active ? 'unlock' : 'lock'} this hook for the next generation`}
                >
                  <div className="flex items-baseline gap-1.5">
                    <span className={cn('text-xs font-semibold', active ? 'text-flare-400' : 'text-ink-100')}>{h.label}</span>
                    <Chip tone={h.risk === 'spicy' ? 'bad' : h.risk === 'edgy' ? 'warn' : 'good'}>
                      {h.risk}
                    </Chip>
                    {active && <span className="ml-auto text-flare-400 text-2xs">✓</span>}
                  </div>
                  <p className="text-2xs text-ink-300 mt-0.5 leading-snug">{h.angle}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-2xs font-mono uppercase tracking-wider text-ink-300">Templates</h4>
            {selectedTemplate && (
              <button
                onClick={() => setSelectedTemplate(null)}
                className="text-2xs text-ink-400 hover:text-ink-100 underline"
              >
                clear
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_DISPLAY.map(t => {
              const active = selectedTemplate === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTemplate(active ? null : t.id)}
                  className={cn(
                    'text-2xs px-2 py-1 rounded-md border transition-colors',
                    active
                      ? 'border-flare-500 bg-flare-500/10 text-flare-400'
                      : 'border-ink-700 bg-ink-800/40 text-ink-200 hover:border-ink-600',
                  )}
                  title={t.label}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-2 border-t border-ink-700">
          <Button
            variant="primary"
            onClick={() => onGenerate(false, selectedHook ?? undefined, selectedTemplate ?? undefined)}
            disabled={generating}
            className="w-full"
          >
            {generating
              ? 'Generating…'
              : selectedHook || selectedTemplate
                ? `✦ Generate ${[selectedHook, selectedTemplate].filter(Boolean).join(' · ')}`
                : '✦ Generate drafts (auto-pick)'}
          </Button>
          <p className="text-2xs text-ink-400 mt-1.5 text-center">
            {selectedHook || selectedTemplate
              ? 'All drafts will hit the locked selection above.'
              : 'AI picks 1–3 (template, hook) variants based on the trend & your brand voice.'}
          </p>
        </div>
      </div>
    );
  }

  const drafts: AIDraft[] = result.drafts;

  return (
    <div className="space-y-3">
      {/* Provenance + regenerate */}
      <div className="flex items-center gap-2 flex-wrap">
        {result.mode === 'live' ? (
          <>
            <Chip tone="good">live · AI</Chip>
            {result.provider && <Chip tone="flare">{result.provider}{result.model ? `:${result.model}` : ''}</Chip>}
            {result.tier && <Chip tone="info">{result.tier}</Chip>}
            {result.hadResearch && <Chip tone="info">+ research</Chip>}
          </>
        ) : (
          <>
            <Chip tone="warn">mock · deterministic fallback</Chip>
            <span className="text-2xs text-ink-300">add an AI key for contextual drafts</span>
          </>
        )}
        <Button size="xs" variant="ghost" className="ml-auto" disabled={generating} onClick={() => onGenerate(true)}>
          {generating ? '…' : '↻ Regenerate'}
        </Button>
      </div>

      {/* AI errored — show the reason rather than silently mocking */}
      {result.aiError && (
        <div className="rounded-md border border-signal-red/40 bg-signal-red/10 px-3 py-2 text-2xs text-ink-100">
          <span className="font-mono text-signal-red">AI error:</span> {result.aiError}
          <span className="block text-ink-300 mt-1">Showing the deterministic fallback. Fix the provider key or model id and try Regenerate.</span>
        </div>
      )}

      {/* AI declined — show the skip + suggestion */}
      {result.skip && (
        <div className="rounded-md border border-signal-amber/40 bg-signal-amber/10 px-3 py-2.5 text-xs text-ink-100">
          <div className="flex items-center gap-2 mb-1">
            <Chip tone="warn">SKIP</Chip>
            <span className="font-semibold">AI declined to draft this trend</span>
          </div>
          <p className="text-ink-200">{result.skip.reason}</p>
          <p className="text-2xs text-ink-300 mt-1">→ {result.skip.suggestion}</p>
        </div>
      )}

      {/* Variant choice transparency — reveal that AI ruled some out */}
      {!!result.variantsSkipped?.length && (
        <details className="rounded-md border border-ink-700 bg-ink-800/30 p-2 text-2xs">
          <summary className="cursor-pointer text-ink-300">
            {result.variantsSkipped.length} variant(s) deliberately skipped
            {result.variantsChosen && ` · chose ${result.variantsChosen.join(', ')}`}
          </summary>
          <ul className="mt-1 space-y-0.5 text-ink-200">
            {result.variantsSkipped.map((v, i) => (
              <li key={i}><Chip tone="neutral">{v.variant}</Chip> <span className="text-ink-300">{v.reason}</span></li>
            ))}
          </ul>
        </details>
      )}

      {/* Drafts */}
      {drafts.length === 0 && !result.skip && (
        <div className="rounded-md border border-ink-700 bg-ink-800/30 p-3 text-2xs text-ink-300 text-center">
          No drafts produced. {result.aiError ? 'Fix the error above and try again.' : 'Try regenerate.'}
        </div>
      )}
      {drafts.map((d, i) => (
        <article key={i} className="rounded-md border border-ink-700 bg-ink-800/50 p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Chip tone={
              d.variant === 'bold' ? 'flare' :
              d.variant === 'meme' ? 'info' :
              d.variant === 'reel' || d.variant === 'carousel' ? 'info' :
              'good'
            }>{String(d.variant)}</Chip>
            <Chip tone="neutral">{String(d.platform)}</Chip>
            <span className="ml-auto text-2xs text-ink-300">cringe {Math.round((Number(d.cringeScore) || 0) * 100)}</span>
          </div>
          <p className="font-semibold text-ink-100">{String(d.hook)}</p>
          <p className="text-ink-200 mt-1">{String(d.body)}</p>
          {d.cta && <p className="text-flare-400 mt-1 font-mono text-2xs uppercase">{String(d.cta)}</p>}
          {d.visualBrief && <p className="text-2xs text-ink-300 mt-1.5">📐 {String(d.visualBrief)}</p>}
          {d.whyItWorks && <p className="text-2xs text-ink-300 mt-1.5 italic">why it works: {String(d.whyItWorks)}</p>}
          {d.whatNotToSay && (
            <p className="text-2xs text-signal-red/80 mt-1.5">
              <span className="font-mono uppercase mr-1">avoid:</span>{String(d.whatNotToSay)}
            </p>
          )}
          <div className="flex gap-1 mt-2">
            <Button size="xs">Edit</Button>
            <Button size="xs" variant="ghost">Send to Slack</Button>
            <Button size="xs" variant="ghost">Send to Telegram</Button>
            <Button size="xs" variant="outline" className="ml-auto">Submit for approval</Button>
          </div>
        </article>
      ))}
    </div>
  );
}

function ResearchTab({ data, loading, onRun }: { data: ResearchPayload | null; loading: boolean; onRun: (backend?: string) => void }) {
  return <ResearchPanel research={data} loading={loading} onRun={onRun} compact={false} />;
}

const BACKENDS: { value: string; label: string; helper: string; tone: 'good' | 'info' | 'flare' }[] = [
  { value: 'auto',       label: 'Auto (free → paid → AI)', helper: 'Free first; only escalates if free returns nothing.', tone: 'good'  },
  { value: 'free',       label: 'Free only (Searx + DDG)',  helper: 'No paid keys used even if configured.',              tone: 'good'  },
  { value: 'searx',      label: 'Searx (free)',             helper: 'Open-source meta-search.',                           tone: 'info'  },
  { value: 'duckduckgo', label: 'DuckDuckGo (free)',        helper: 'HTML scrape fallback.',                              tone: 'info'  },
  { value: 'tavily',     label: 'Tavily (paid)',            helper: 'Requires TAVILY_API_KEY. 1k/mo free tier.',          tone: 'info'  },
  { value: 'brave',      label: 'Brave (paid)',             helper: 'Requires BRAVE_API_KEY. 2k/mo free tier.',           tone: 'info'  },
  { value: 'sonar',      label: 'Perplexity Sonar (AI)',    helper: 'Requires OPENROUTER_API_KEY. Web-search built-in.',  tone: 'flare' },
];

function ResearchPanel({ research, loading, onRun, compact }: {
  research: ResearchPayload | null;
  loading: boolean;
  onRun: (backend?: string) => void;
  compact: boolean;
}) {
  const [backend, setBackend] = React.useState<string>('auto');

  if (!research) {
    return (
      <div className="rounded-md border border-dashed border-ink-700 bg-ink-800/30 p-3 space-y-2">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-ink-100 text-xs">Pull articles, prices, specs, dates &amp; key players from the web.</p>
            <p className="text-2xs text-ink-400">Pick a backend or leave on Auto (free first, AI last).</p>
          </div>
          <Button variant="primary" size="sm" onClick={() => onRun(backend)} disabled={loading}>{loading ? 'Researching…' : '🔍 Research'}</Button>
        </div>
        <select value={backend} onChange={e => setBackend(e.target.value)}
          className="w-full h-8 px-2 rounded-md bg-ink-900 border border-ink-700 text-2xs text-ink-100 font-mono">
          {BACKENDS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
        <p className="text-[10px] text-ink-500 italic">{BACKENDS.find(b => b.value === backend)?.helper}</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-ink-700 bg-ink-800/40 p-3 space-y-3">
      <div className="flex items-center gap-2 text-2xs flex-wrap">
        <Chip tone="info">{research.searchBackend ?? 'web'}</Chip>
        {research.provider && <Chip tone="flare">{research.provider}</Chip>}
        {research.aiSummarized === false && <Chip tone="warn">no AI summary</Chip>}
        <span className="ml-auto flex items-center gap-1.5">
          <select value={backend} onChange={e => setBackend(e.target.value)}
            className="h-6 px-1.5 rounded bg-ink-900 border border-ink-700 text-2xs text-ink-100 font-mono"
            title={BACKENDS.find(b => b.value === backend)?.helper}>
            {BACKENDS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
          <Button size="xs" variant="ghost" onClick={() => onRun(backend)} disabled={loading}>{loading ? '…' : '↻ Re-run'}</Button>
        </span>
      </div>
      <p className="text-ink-100 text-xs leading-relaxed">{research.summary}</p>

      {/* Verified claims — each has a citation. Drafts can ONLY cite
          from this list. Confidence-coded: ≥0.7 green, 0.4-0.7 amber,
          <0.4 demoted to unverifiedClaims. */}
      {!!research.verifiedClaims?.length && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-2xs uppercase tracking-wider text-ink-300">Verified Claims</span>
            <Chip tone="good">{research.verifiedClaims.length}</Chip>
            {research.verifierProvider && (
              <span className="text-2xs font-mono text-ink-400">via {research.verifierProvider}</span>
            )}
          </div>
          <ul className="space-y-1.5">
            {research.verifiedClaims.map(c => {
              const conf = Math.round(c.confidence * 100);
              const tone = c.confidence >= 0.7 ? 'good' : c.confidence >= 0.4 ? 'warn' : 'bad';
              let host = c.sourceUrl;
              try { host = new URL(c.sourceUrl).hostname; } catch { /* keep raw */ }
              return (
                <li key={c.id} className="rounded-md bg-ink-900 border border-ink-700 px-2.5 py-1.5">
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className="text-2xs uppercase font-mono tracking-wider text-ink-300 flex-shrink-0">{c.key}</span>
                    <span className="text-ink-100 text-xs flex-1">{c.value}</span>
                    <Chip tone={tone}>{conf}%</Chip>
                  </div>
                  <p className="text-2xs text-ink-300 italic mt-1">"{c.quotedSpan}"</p>
                  <a
                    href={c.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-2xs text-flare-400 hover:underline font-mono"
                  >
                    ↗ {host}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Unverified claims — facts the model couldn't cite. Drafts MUST
          NOT use these. Surfaced for transparency so the operator
          knows what's missing. */}
      {!!research.unverifiedClaims?.length && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-2xs uppercase tracking-wider text-ink-400">Unverified · drafts can't use</span>
            <Chip tone="warn">{research.unverifiedClaims.length}</Chip>
          </div>
          <ul className="space-y-1">
            {research.unverifiedClaims.map((c, i) => (
              <li key={i} className="text-2xs text-ink-400 px-2.5 py-1 rounded bg-ink-800/40 border border-ink-700/40">
                <span className="font-mono uppercase tracking-wider mr-2">{c.key}</span>
                <span className="italic">{c.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!!research.keyFacts?.length && (
        <dl className="grid grid-cols-1 gap-1">
          {research.keyFacts.map((f, i) => (
            <div key={i} className="flex items-baseline gap-2 rounded-md bg-ink-900 border border-ink-700 px-2.5 py-1.5">
              <dt className="text-2xs uppercase font-mono tracking-wider text-ink-300 w-32 flex-shrink-0">{f.label}</dt>
              <dd className="text-ink-100 text-xs">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {!!research.sources?.length && (
        <div>
          <div className="text-2xs uppercase tracking-wider text-ink-300 mb-1">Sources ({research.sources.length})</div>
          <ol className="space-y-1.5">
            {research.sources.slice(0, compact ? 4 : research.sources.length).map((s, i) => (
              <li key={i} className="text-2xs">
                <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-flare-400 hover:underline truncate block">
                  {i + 1}. {s.title}
                </a>
                {!compact && s.snippet && <p className="text-ink-300 mt-0.5">{s.snippet}</p>}
                <span className="text-ink-500 font-mono">{(() => { try { return new URL(s.url).hostname; } catch { return s.url; } })()}</span>
              </li>
            ))}
            {compact && research.sources.length > 4 && (
              <li className="text-2xs text-ink-400">+{research.sources.length - 4} more in the Research tab</li>
            )}
          </ol>
        </div>
      )}
    </div>
  );
}

interface LineageProbe {
  origin?: { earliestKnownAt?: string; earliestKnownAuthor?: string; earliestKnownUrl?: string; catalyst?: string };
  spread?: Array<{ actor: string; handle?: string; role: string; at?: string; note?: string; url?: string }>;
  inflectionPoints?: Array<{ at?: string; description: string }>;
  geo?: { primaryMarkets?: string[]; emergingMarkets?: string[]; absent?: string[] };
  audience?: string[];
  recurrence?: { isRecurring?: boolean; pastInstances?: Array<{ approxWhen?: string; outcome?: string }> };
  timeline?: Array<{ at?: string; what: string }>;
  citations?: Array<{ title: string; url: string }>;
  confidence?: number;
  provider?: string;
  generatedAt?: string;
}

function LineageTab({ trend, probe, loading, onProbe }: { trend: Trend; probe: unknown; loading: boolean; onProbe: () => void }) {
  const p = probe as LineageProbe | null;

  return (
    <div className="space-y-4">
      <Section title="Surface lineage (from connector)">
        <p className="text-ink-100">{displayLineage(trend.lineage)}</p>
        {trend.catalyst && <p className="mt-1 text-ink-300">Catalyst: <span className="text-ink-100">{trend.catalyst}</span></p>}
        <div className="mt-2 flex items-center gap-2 text-2xs">
          <Chip>{trend.source}</Chip>
          <span className="font-mono text-ink-400">{trend.sourceRef}</span>
        </div>
      </Section>

      {!p ? (
        <Section title="Background check">
          <div className="rounded-md border border-dashed border-ink-700 bg-ink-800/30 p-3 flex items-center gap-3">
            <div className="flex-1">
              <p className="text-ink-100 text-xs">Run a deep lineage probe — origin, spread vector, inflection points, geo/audience, recurrence.</p>
              <p className="text-2xs text-ink-400">Uses Perplexity Sonar via OpenRouter when available; otherwise free search + your AI provider.</p>
            </div>
            <Button variant="primary" size="sm" onClick={onProbe} disabled={loading}>{loading ? 'Probing…' : '🔎 Background check'}</Button>
          </div>
        </Section>
      ) : (
        <>
          <Section title={
            <span className="flex items-center justify-between">
              <span>Background check</span>
              <span className="flex items-center gap-2">
                {typeof p.confidence === 'number' && (
                  <Chip tone={p.confidence > 0.7 ? 'good' : p.confidence > 0.4 ? 'warn' : 'bad'}>
                    confidence {Math.round((p.confidence ?? 0) * 100)}%
                  </Chip>
                )}
                {p.provider && <Chip tone="flare">{p.provider}</Chip>}
                <Button size="xs" variant="ghost" onClick={onProbe} disabled={loading}>{loading ? '…' : '↻'}</Button>
              </span>
            </span>
          }>
            {p.origin && (
              <div className="rounded-md border border-ink-700 bg-ink-800/40 p-2.5 mb-2 space-y-1">
                <div className="text-2xs uppercase tracking-wider text-ink-300">Origin</div>
                <div className="text-ink-100">{p.origin.catalyst ?? '—'}</div>
                <div className="text-2xs font-mono text-ink-400">
                  {p.origin.earliestKnownAuthor ?? '—'}
                  {p.origin.earliestKnownAt ? ` · ${p.origin.earliestKnownAt}` : ''}
                </div>
                {p.origin.earliestKnownUrl && (
                  <a href={p.origin.earliestKnownUrl} target="_blank" rel="noreferrer noopener" className="text-2xs text-flare-400 hover:underline">{p.origin.earliestKnownUrl}</a>
                )}
              </div>
            )}
          </Section>

          {!!p.timeline?.length && (
            <Section title="Timeline">
              <ol className="relative border-l border-ink-700 ml-2 space-y-2">
                {p.timeline.map((t, i) => (
                  <li key={i} className="ml-3">
                    <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-flare-500/40 border border-flare-500" />
                    {t.at && <span className="text-2xs font-mono text-ink-400">{t.at}</span>}
                    <p className="text-ink-100">{t.what}</p>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {!!p.spread?.length && (
            <Section title="Spread vector">
              <ul className="space-y-1.5">
                {p.spread.map((s, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Chip tone={
                      s.role === 'origin'      ? 'flare' :
                      s.role === 'critic'      ? 'bad'   :
                      s.role === 'mainstream'  ? 'info'  :
                                                 'good'
                    }>{s.role}</Chip>
                    <div className="flex-1">
                      <div className="text-ink-100">
                        {s.actor}{s.handle ? ` · ${s.handle}` : ''}
                        {s.at && <span className="ml-2 text-2xs font-mono text-ink-400">{s.at}</span>}
                      </div>
                      {s.note && <p className="text-2xs text-ink-300">{s.note}</p>}
                      {s.url && <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-2xs text-flare-400 hover:underline">link ↗</a>}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {!!p.inflectionPoints?.length && (
            <Section title="Inflection points">
              <ul className="space-y-1">
                {p.inflectionPoints.map((ip, i) => (
                  <li key={i} className="flex items-start gap-2">
                    {ip.at && <span className="text-2xs font-mono text-ink-400 w-32 flex-shrink-0">{ip.at}</span>}
                    <span className="text-ink-100">{ip.description}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {p.geo && (
            <Section title="Geography">
              <div className="space-y-1 text-xs">
                {!!p.geo.primaryMarkets?.length && <div>Primary: {p.geo.primaryMarkets.map(m => <Chip key={m} tone="good" className="mr-1">{m}</Chip>)}</div>}
                {!!p.geo.emergingMarkets?.length && <div>Emerging: {p.geo.emergingMarkets.map(m => <Chip key={m} tone="info" className="mr-1">{m}</Chip>)}</div>}
                {!!p.geo.absent?.length && <div>Quiet in: {p.geo.absent.map(m => <Chip key={m} tone="neutral" className="mr-1">{m}</Chip>)}</div>}
              </div>
            </Section>
          )}

          {!!p.audience?.length && (
            <Section title="Audience segments">
              <div className="flex flex-wrap gap-1">
                {p.audience.map(a => <Chip key={a} tone="info">{a}</Chip>)}
              </div>
            </Section>
          )}

          {p.recurrence && (
            <Section title="Recurrence">
              <p className="text-ink-100">
                {p.recurrence.isRecurring ? 'This pattern has surfaced before.' : 'No prior instances found.'}
              </p>
              {!!p.recurrence.pastInstances?.length && (
                <ul className="space-y-1 mt-1">
                  {p.recurrence.pastInstances.map((pi, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <span className="text-2xs font-mono text-ink-400 w-24 flex-shrink-0">{pi.approxWhen}</span>
                      <span className="text-ink-200">{pi.outcome ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {!!p.citations?.length && (
            <Section title={`Citations (${p.citations.length})`}>
              <ol className="space-y-1">
                {p.citations.slice(0, 8).map((c, i) => (
                  <li key={i}>
                    <a href={c.url} target="_blank" rel="noreferrer noopener" className="text-flare-400 hover:underline text-xs truncate block">{i + 1}. {c.title}</a>
                  </li>
                ))}
              </ol>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-2xs font-semibold uppercase tracking-wider text-ink-300 mb-1">{title}</h3>
      <div className="text-ink-200">{children}</div>
    </section>
  );
}
