'use client';
import * as React from 'react';
import type { DailyBrief, Opportunity, RankRow } from '@/lib/social/analytics';
import type { BriefNarrative, ViralAnalysis } from '@/lib/social/brief';
import { Sparkline } from './Sparkline';
import { PlatformGlyph, platformLabel } from './PlatformGlyph';

// Design notes, because the first version failed on exactly these three:
//
// Hierarchy. Everything sat between 11px and 15px, so nothing led and the eye
// had nowhere to land. There is now a single focal point (the headline stats),
// then prose, then detail, on a real scale.
//
// Restraint with monospace. Uppercase mono on every label reads as a log file.
// It is now reserved for small eyebrow labels and for figures, where it earns
// its place by aligning columns.
//
// Contrast. Secondary copy was ink-400, genuinely hard to read on the light
// theme. Body is ink-100/ink-200 now; ink-400 is for true asides only.
//
// Computed values still render server-side and the model prose still loads
// separately, so nothing here waits on a model.

interface Props {
  initialBrief: DailyBrief;
  aiAvailable: boolean;
  historyByAccount: Record<string, number[]>;
}

export function IntelligencePanel({ initialBrief, aiAvailable, historyByAccount }: Props) {
  const [brief, setBrief] = React.useState(initialBrief);
  const [narrative, setNarrative] = React.useState<BriefNarrative | null>(null);
  const [viral, setViral] = React.useState<ViralAnalysis | null>(null);
  const [loading, setLoading] = React.useState(false);

  const generate = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/social/intelligence', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ windowDays: 7, want: ['narrative', 'viral'] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { brief: DailyBrief; narrative: BriefNarrative; viral: ViralAnalysis };
      setBrief(json.brief);
      setNarrative(json.narrative);
      setViral(json.viral);
    } catch (e) {
      setNarrative({ summary: '', moves: [], provider: 'none', aiGenerated: false, error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="space-y-10 sm:space-y-14">
      <HeadlineStats brief={brief} />

      <Brief
        brief={brief}
        narrative={narrative}
        aiAvailable={aiAvailable}
        loading={loading}
        onGenerate={generate}
      />

      {brief.opportunities.length > 0 && (
        <Block title="What to act on">
          <div className="grid gap-3 md:grid-cols-3">
            {brief.opportunities.slice(0, 3).map((o, i) => <OpportunityCard key={i} o={o} />)}
          </div>
        </Block>
      )}

      {brief.platforms.map(p => {
        const rows = brief.rows.filter(r => r.platform === p);
        if (!rows.length) return null;
        const mine = rows.find(r => r.isOwn);
        return (
          <Block
            key={p}
            title={platformLabel(p)}
            aside={mine ? `You rank ${mine.rank} of ${rows.length}` : `${rows.length} channels`}
          >
            <Standings rows={rows} historyByAccount={historyByAccount} />
          </Block>
        );
      })}

      {viral && <ViralBlock viral={viral} />}
    </div>
  );
}

/* -------------------------------------------------------------- headline */

/** The focal point. One number the eye lands on, then supporting figures. */
function HeadlineStats({ brief }: { brief: DailyBrief }) {
  const f = brief.facts;
  const own = brief.rows.filter(r => r.isOwn);

  return (
    <div className="grid grid-cols-2 gap-px bg-ink-700 rounded-xl overflow-hidden border border-ink-700 lg:grid-cols-4">
      <Stat
        value={f.ownFollowersTotal === null ? '—' : f.ownFollowersTotal.toLocaleString('en-US')}
        label="Total followers"
        sub={
          f.ownFollowersDelta === null
            ? 'awaiting readings'
            : `${f.ownFollowersDelta >= 0 ? '+' : '−'}${Math.abs(f.ownFollowersDelta).toLocaleString('en-US')} this week`
        }
        tone={f.ownFollowersDelta === null ? 'muted' : f.ownFollowersDelta >= 0 ? 'up' : 'down'}
      />
      {own.slice(0, 2).map(r => (
        <Stat
          key={r.accountId}
          value={`#${r.rank}`}
          label={`${platformLabel(r.platform)} rank`}
          sub={r.gapToNext === null ? 'leading the field' : `${r.gapToNext.toLocaleString('en-US')} behind #${r.rank - 1}`}
          tone={r.gapToNext === null ? 'up' : 'muted'}
        />
      ))}
      <Stat
        value={String(brief.opportunities.length)}
        label="Signals to act on"
        sub={f.accountsTracked === 1 ? '1 channel tracked' : `${f.accountsTracked} channels tracked`}
        tone="accent"
      />
    </div>
  );
}

function Stat({ value, label, sub, tone }: {
  value: string; label: string; sub: string;
  tone: 'up' | 'down' | 'muted' | 'accent';
}) {
  const valueTone = tone === 'accent' ? 'text-flare-400' : 'text-ink-100';
  const subTone =
    tone === 'up' ? 'text-signal-green'
    : tone === 'down' ? 'text-signal-red'
    : 'text-ink-300';

  return (
    <div className="bg-ink-900 px-4 py-4 sm:px-5 sm:py-5">
      <div className={`text-[22px] sm:text-[28px] lg:text-[32px] font-semibold tabular-nums leading-none tracking-tight ${valueTone}`}>
        {value}
      </div>
      <div className="mt-2.5 text-[13px] sm:text-sm font-medium text-ink-200">{label}</div>
      <div className={`mt-1 text-xs sm:text-[13px] ${subTone}`}>{sub}</div>
    </div>
  );
}

/* ----------------------------------------------------------------- brief */

function Brief({
  brief, narrative, aiAvailable, loading, onGenerate,
}: {
  brief: DailyBrief; narrative: BriefNarrative | null;
  aiAvailable: boolean; loading: boolean; onGenerate: () => void;
}) {
  const body = narrative?.summary || computedSummary(brief);
  const moves = narrative?.moves?.length
    ? narrative.moves
    : brief.opportunities.slice(0, 3).map(o => `${o.headline}. ${o.detail}`);
  const hasData = brief.rows.length > 0;

  return (
    <section>
      <Head
        title="Today's brief"
        aside={narrative ? (narrative.aiGenerated ? 'written by AI' : 'computed') : undefined}
        action={hasData && aiAvailable ? (
          <button
            type="button"
            onClick={onGenerate}
            disabled={loading}
            className="h-9 px-4 rounded-lg bg-flare-500 text-ink-950 text-[13px] font-medium hover:bg-flare-400 active:scale-[.98] disabled:opacity-40 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
          >
            {loading ? 'Analysing…' : narrative ? 'Refresh' : 'Write brief'}
          </button>
        ) : undefined}
      />

      {loading && !narrative ? <Skeleton /> : (
        <>
          {/* 17px at a 62ch measure. A 15px paragraph running the full page
              width was the single biggest readability problem before. */}
          <p className="text-[17px] leading-[1.65] text-ink-100 max-w-[62ch]">{body}</p>

          {moves.length > 0 && (
            <ul className="mt-6 space-y-4 max-w-[68ch]">
              {moves.map((m, i) => (
                <li key={i} className="flex gap-4">
                  <span className="mt-[9px] w-1.5 h-1.5 rounded-full bg-flare-500 shrink-0" />
                  <span className="text-[15px] leading-relaxed text-ink-200">{m}</span>
                </li>
              ))}
            </ul>
          )}

          {narrative?.error && <p className="mt-6 text-[13px] text-signal-amber">{narrative.error}</p>}
          {!aiAvailable && hasData && (
            <p className="mt-6 text-[13px] text-ink-400">
              Every figure above is computed exactly. Add an AI key in Settings for the written read.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function computedSummary(brief: DailyBrief): string {
  const f = brief.facts;
  const parts: string[] = [];
  if (f.ownFollowersTotal !== null) {
    const d = f.ownFollowersDelta;
    parts.push(
      d === null || d === 0
        ? `You have ${f.ownFollowersTotal.toLocaleString('en-US')} followers across your channels.`
        : `You have ${f.ownFollowersTotal.toLocaleString('en-US')} followers across your channels, ${d > 0 ? 'up' : 'down'} ${Math.abs(d).toLocaleString('en-US')} this week.`,
    );
  }
  if (f.bestPlatform) parts.push(`You are strongest on ${platformLabel(f.bestPlatform.platform)}, ranked ${f.bestPlatform.rank} of ${f.bestPlatform.of}.`);
  if (brief.opportunities.length) parts.push(`${brief.opportunities[0].headline}.`);
  if (f.accountsAwaitingData) parts.push(`${f.accountsAwaitingData} channel(s) are still awaiting a first reading.`);
  return parts.join(' ') || 'No readings yet. Add channels and a provider key to start the first brief.';
}

/* ----------------------------------------------------------- opportunity */

const TONE: Record<string, { accent: string; label: string }> = {
  'overtake-soon':   { accent: 'text-signal-green', label: 'Overtake in sight' },
  'gap-closing':     { accent: 'text-signal-green', label: 'Closing the gap' },
  'growth-lead':     { accent: 'text-signal-green', label: 'Outgrowing them' },
  'engagement-lead': { accent: 'text-flare-400',    label: 'Your strength' },
  'gap-widening':    { accent: 'text-signal-amber', label: 'Losing ground' },
  'growth-lag':      { accent: 'text-signal-amber', label: 'Falling behind' },
  'engagement-lag':  { accent: 'text-signal-red',   label: 'Weak spot' },
  'cadence-lag':     { accent: 'text-signal-amber', label: 'Posting gap' },
};

function OpportunityCard({ o }: { o: Opportunity }) {
  const t = TONE[o.kind] ?? { accent: 'text-ink-300', label: 'Signal' };
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 p-5 hover:border-ink-600 transition-colors">
      <div className={`text-[11px] font-mono uppercase tracking-[0.12em] ${t.accent} mb-3`}>{t.label}</div>
      <div className="text-[15px] font-medium text-ink-100 leading-snug mb-2">{o.headline}</div>
      <p className="text-[13px] leading-relaxed text-ink-300">{o.detail}</p>
    </div>
  );
}

/* ------------------------------------------------------------- standings */

function Standings({
  rows, historyByAccount,
}: { rows: RankRow[]; historyByAccount: Record<string, number[]> }) {
  return (
    <>
      <div className="lg:hidden space-y-2">
        {rows.map(r => <StandingsCard key={r.accountId} r={r} history={historyByAccount[r.accountId] ?? []} />)}
      </div>

      <div className="hidden lg:block rounded-xl border border-ink-700 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-ink-700">
              <th className="px-5 py-3 text-left text-[11px] font-mono uppercase tracking-[0.1em] text-ink-400">Channel</th>
              <th className="px-5 py-3 text-right text-[11px] font-mono uppercase tracking-[0.1em] text-ink-400">Followers</th>
              <th className="px-5 py-3 text-right text-[11px] font-mono uppercase tracking-[0.1em] text-ink-400">Share</th>
              <th className="px-5 py-3 text-right text-[11px] font-mono uppercase tracking-[0.1em] text-ink-400">Per day</th>
              <th className="px-5 py-3 text-right text-[11px] font-mono uppercase tracking-[0.1em] text-ink-400">Engagement</th>
              <th className="px-5 py-3 text-right text-[11px] font-mono uppercase tracking-[0.1em] text-ink-400">Gap above</th>
              <th className="px-5 py-3 text-left text-[11px] font-mono uppercase tracking-[0.1em] text-ink-400 w-[120px]">Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr
                key={r.accountId}
                className={`border-b border-ink-800 last:border-0 transition-colors ${r.isOwn ? 'bg-flare-500/[0.06]' : 'hover:bg-ink-850/50'}`}
              >
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] font-mono text-ink-400 tabular-nums w-3">{r.rank}</span>
                    <PlatformGlyph platform={r.platform} />
                    <span className={`text-[15px] ${r.isOwn ? 'text-flare-400 font-medium' : 'text-ink-100'}`}>{r.label}</span>
                  </div>
                </td>
                <td className="px-5 py-4 text-right text-[15px] text-ink-100 tabular-nums">
                  {r.followers.toLocaleString('en-US')}
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center justify-end gap-2.5">
                    <div className="w-14 h-1 rounded-full bg-ink-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-[width] duration-500 ${r.isOwn ? 'bg-flare-500' : 'bg-ink-500'}`}
                        style={{ width: `${Math.max(3, r.sharePct)}%` }}
                      />
                    </div>
                    <span className="text-[13px] text-ink-300 tabular-nums w-8 text-right">{r.sharePct.toFixed(0)}%</span>
                  </div>
                </td>
                <td className="px-5 py-4 text-right text-[15px] tabular-nums"><Rate value={r.growth.perDay} /></td>
                <td className="px-5 py-4 text-right text-[15px] text-ink-200 tabular-nums">
                  {r.engagementRatePct === null ? <Dash /> : `${r.engagementRatePct.toFixed(2)}%`}
                </td>
                <td className="px-5 py-4 text-right text-[15px] text-ink-300 tabular-nums">
                  {r.gapToNext === null ? <span className="text-[13px] text-ink-500">leader</span> : r.gapToNext.toLocaleString('en-US')}
                </td>
                <td className="px-5 py-4">
                  <Sparkline points={historyByAccount[r.accountId] ?? []} width={100} height={26} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.some(r => r.growth.perDay === null || r.engagementRatePct === null) && (
        <p className="mt-3 text-[13px] text-ink-400">
          <span aria-hidden="true">—</span> means not enough readings yet, not zero.
        </p>
      )}
    </>
  );
}

function StandingsCard({ r, history }: { r: RankRow; history: number[] }) {
  return (
    <div className={`rounded-xl border p-4 ${r.isOwn ? 'bg-flare-500/[0.06] border-flare-500/30' : 'bg-ink-900 border-ink-700'}`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[13px] font-mono text-ink-400 tabular-nums shrink-0">{r.rank}</span>
          <PlatformGlyph platform={r.platform} />
          <span className={`text-[15px] truncate ${r.isOwn ? 'text-flare-400 font-medium' : 'text-ink-100'}`}>{r.label}</span>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-semibold text-ink-100 tabular-nums leading-none">
            {r.followers.toLocaleString('en-US')}
          </div>
          <div className="text-[13px] text-ink-300 mt-1.5">{r.sharePct.toFixed(0)}% share</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <MiniStat label="Per day"><Rate value={r.growth.perDay} /></MiniStat>
        <MiniStat label="Engagement">
          {r.engagementRatePct === null ? <Dash /> : <span className="text-ink-100">{r.engagementRatePct.toFixed(2)}%</span>}
        </MiniStat>
        <MiniStat label="Gap above">
          {r.gapToNext === null
            ? <span className="text-[13px] text-ink-500">leader</span>
            : <span className="text-ink-100">{r.gapToNext.toLocaleString('en-US')}</span>}
        </MiniStat>
      </div>

      <Sparkline points={history} width={300} height={28} className="w-full" />
    </div>
  );
}

function MiniStat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-mono uppercase tracking-[0.1em] text-ink-400 mb-1.5">{label}</div>
      <div className="text-[15px] tabular-nums">{children}</div>
    </div>
  );
}

function Rate({ value }: { value: number | null }) {
  if (value === null) return <Dash />;
  const flat = Math.round(value) === 0;
  return (
    <span className={flat ? 'text-ink-400' : value > 0 ? 'text-signal-green' : 'text-signal-red'}>
      {flat ? '0' : `${value > 0 ? '+' : ''}${Math.round(value).toLocaleString('en-US')}`}
    </span>
  );
}

function Dash() {
  return <span className="text-ink-500" aria-label="Not enough readings yet">—</span>;
}

/* ----------------------------------------------------------------- viral */

function ViralBlock({ viral }: { viral: ViralAnalysis }) {
  const has = viral.patterns.length || viral.formats.length || viral.audienceThemes.length;
  return (
    <Block title="What is working" aside={`${viral.sampleSize} posts analysed`}>
      {!has ? (
        <p className="text-[15px] text-ink-300">{viral.error ?? 'No patterns identified from the current sample.'}</p>
      ) : (
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          <Column title="Patterns">
            {viral.patterns.map((p, i) => (
              <li key={i} className="mb-5 last:mb-0">
                <div className="text-[15px] font-medium text-ink-100 mb-1">{p.name}</div>
                <p className="text-[13px] leading-relaxed text-ink-300">{p.evidence}</p>
              </li>
            ))}
          </Column>
          <Column title="Formats to try">
            {viral.formats.map((f, i) => (
              <li key={i} className="mb-3 last:mb-0 text-[15px] leading-relaxed text-ink-200">{f}</li>
            ))}
          </Column>
          <Column title="Audience is saying">
            {viral.audienceThemes.length
              ? viral.audienceThemes.map((t, i) => (
                  <li key={i} className="mb-3 last:mb-0 text-[15px] leading-relaxed text-ink-200">{t}</li>
                ))
              : <li className="text-[13px] text-ink-400">No comments loaded yet.</li>}
          </Column>
        </div>
      )}
    </Block>
  );
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] font-mono uppercase tracking-[0.12em] text-flare-400 mb-4">{title}</h3>
      <ul>{children}</ul>
    </div>
  );
}

/* ------------------------------------------------------------------ util */

/** One heading rhythm everywhere. Consistency here is most of what separates
 *  "designed" from "assembled". */
function Head({ title, aside, action }: { title: string; aside?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 mb-5">
      <div className="flex items-baseline gap-3 min-w-0">
        <h2 className="text-lg font-semibold text-ink-100 tracking-tight">{title}</h2>
        {aside && <span className="text-[13px] text-ink-400 truncate">{aside}</span>}
      </div>
      {action}
    </div>
  );
}

function Block({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section>
      <Head title={title} aside={aside} />
      {children}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3 animate-pulse" aria-hidden="true">
      <div className="h-4 rounded bg-ink-800 w-[90%]" />
      <div className="h-4 rounded bg-ink-800 w-[82%]" />
      <div className="h-4 rounded bg-ink-800 w-[55%]" />
      <div className="pt-4 space-y-3">
        <div className="h-3.5 rounded bg-ink-800 w-[74%]" />
        <div className="h-3.5 rounded bg-ink-800 w-[66%]" />
      </div>
    </div>
  );
}
