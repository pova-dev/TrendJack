'use client';
import * as React from 'react';
import type { DailyBrief, Opportunity, RankRow } from '@/lib/social/analytics';
import type { BriefNarrative, ViralAnalysis } from '@/lib/social/brief';
import { Sparkline } from './Sparkline';
import { compact } from './LiveCounter';
import { PlatformGlyph, platformLabel } from './PlatformGlyph';

// Everything computed renders immediately from server data. The model-written
// parts load separately and never block the standings, because a slow or
// unavailable model must not hold up numbers that are already correct.

interface Props {
  initialBrief: DailyBrief;
  aiAvailable: boolean;
  /** Follower history per account, for the row sparklines. */
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
      setNarrative({
        summary: '', moves: [], provider: 'none', aiGenerated: false,
        error: (e as Error).message,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const hasData = brief.rows.length > 0;

  return (
    <div className="space-y-7">
      <DailyBriefCard
        brief={brief}
        narrative={narrative}
        aiAvailable={aiAvailable}
        loading={loading}
        onGenerate={generate}
        hasData={hasData}
      />

      {brief.opportunities.length > 0 && (
        <Section title="Opportunities" note={`${brief.opportunities.length} detected`}>
          <div className="grid gap-2.5 lg:grid-cols-2">
            {brief.opportunities.map((o, i) => <OpportunityCard key={i} o={o} />)}
          </div>
        </Section>
      )}

      {brief.platforms.map(p => {
        const rows = brief.rows.filter(r => r.platform === p);
        if (!rows.length) return null;
        return (
          <Section key={p} title={`${platformLabel(p)} standings`} note={`${rows.length} channels`}>
            <StandingsTable rows={rows} historyByAccount={historyByAccount} />
          </Section>
        );
      })}

      {viral && <ViralCard viral={viral} />}
    </div>
  );
}

/* ------------------------------------------------------------ daily brief */

function DailyBriefCard({
  brief, narrative, aiAvailable, loading, onGenerate, hasData,
}: {
  brief: DailyBrief; narrative: BriefNarrative | null; aiAvailable: boolean;
  loading: boolean; onGenerate: () => void; hasData: boolean;
}) {
  // Prefer the model's prose, fall back to computed text. Either way the panel
  // says something true rather than sitting empty.
  const body = narrative?.summary || computedSummary(brief);
  const moves = narrative?.moves?.length
    ? narrative.moves
    : brief.opportunities.slice(0, 3).map(o => `${o.headline}. ${o.detail}`);

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-ink-800 bg-ink-850">
        <div className="flex items-center gap-2.5">
          <span className="text-2xs font-mono uppercase tracking-wider text-flare-400">Today&rsquo;s brief</span>
          {narrative && (
            <span
              className={`text-2xs font-mono px-1.5 py-0.5 rounded-sm ${
                narrative.aiGenerated
                  ? 'bg-signal-green/15 text-signal-green'
                  : 'bg-ink-700 text-ink-300'
              }`}
              title={narrative.provider}
            >
              {narrative.aiGenerated ? 'AI written' : 'computed'}
            </span>
          )}
        </div>
        {hasData && aiAvailable && (
          <button
            type="button"
            onClick={onGenerate}
            disabled={loading}
            className="h-7 px-2.5 rounded-md bg-flare-500 text-ink-950 text-2xs font-medium hover:bg-flare-400 disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-850"
          >
            {loading ? 'Analysing…' : narrative ? 'Refresh' : 'Write brief'}
          </button>
        )}
      </div>

      <div className="p-5">
        {loading && !narrative ? (
          <SkeletonLines />
        ) : (
          <>
            <p className="text-[15px] leading-relaxed text-ink-100 max-w-[68ch]">{body}</p>

            {moves.length > 0 && (
              <ol className="mt-4 space-y-2">
                {moves.map((m, i) => (
                  <li key={i} className="flex gap-3 text-sm text-ink-200">
                    <span className="font-mono text-2xs text-flare-400 pt-1 tabular-nums shrink-0">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="max-w-[64ch]">{m}</span>
                  </li>
                ))}
              </ol>
            )}

            {/* An honest note about WHY the prose is computed rather than written. */}
            {narrative?.error && (
              <p className="mt-4 text-2xs text-signal-amber border-t border-ink-800 pt-3">
                {narrative.error}
              </p>
            )}
            {!aiAvailable && hasData && (
              <p className="mt-4 text-2xs text-ink-400 border-t border-ink-800 pt-3">
                Numbers above are computed exactly. Add an AI key in Settings to get the written read on them.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function computedSummary(brief: DailyBrief): string {
  const f = brief.facts;
  const parts: string[] = [];
  if (f.ownFollowersTotal !== null) {
    const d = f.ownFollowersDelta;
    parts.push(
      d === null || d === 0
        ? `${f.ownFollowersTotal.toLocaleString()} followers across your channels.`
        : `${f.ownFollowersTotal.toLocaleString()} followers across your channels, ${d > 0 ? 'up' : 'down'} ${Math.abs(d).toLocaleString()}.`,
    );
  }
  if (f.bestPlatform) parts.push(`Strongest on ${platformLabel(f.bestPlatform.platform)} at rank ${f.bestPlatform.rank} of ${f.bestPlatform.of}.`);
  if (brief.opportunities.length) parts.push(`${brief.opportunities[0].headline}.`);
  if (f.accountsAwaitingData) parts.push(`${f.accountsAwaitingData} channel(s) awaiting a first reading.`);
  return parts.join(' ') || 'No readings yet. Add channels and a provider key to start the first brief.';
}

/* ----------------------------------------------------------- opportunity */

const TONE: Record<string, { border: string; text: string; label: string }> = {
  'overtake-soon':  { border: 'border-l-signal-green', text: 'text-signal-green', label: 'Overtake' },
  'gap-closing':    { border: 'border-l-signal-green', text: 'text-signal-green', label: 'Closing' },
  'growth-lead':    { border: 'border-l-signal-green', text: 'text-signal-green', label: 'Ahead' },
  'engagement-lead':{ border: 'border-l-flare-500',    text: 'text-flare-400',    label: 'Strength' },
  'gap-widening':   { border: 'border-l-signal-amber', text: 'text-signal-amber', label: 'Slipping' },
  'growth-lag':     { border: 'border-l-signal-amber', text: 'text-signal-amber', label: 'Behind' },
  'engagement-lag': { border: 'border-l-signal-red',   text: 'text-signal-red',   label: 'Weak spot' },
  'cadence-lag':    { border: 'border-l-signal-amber', text: 'text-signal-amber', label: 'Cadence' },
};

function OpportunityCard({ o }: { o: Opportunity }) {
  const t = TONE[o.kind] ?? { border: 'border-l-ink-600', text: 'text-ink-300', label: 'Signal' };
  return (
    <div className={`rounded-md border border-ink-700 border-l-2 ${t.border} bg-ink-900 p-3.5`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-2xs font-mono uppercase tracking-wider ${t.text}`}>{t.label}</span>
        <span className="text-2xs font-mono text-ink-500">{platformLabel(o.platform)}</span>
        {o.rival && <span className="text-2xs font-mono text-ink-500">vs {o.rival}</span>}
      </div>
      <div className="text-sm font-medium text-ink-100 mb-1">{o.headline}</div>
      <p className="text-2xs text-ink-300 leading-relaxed">{o.detail}</p>
    </div>
  );
}

/* ------------------------------------------------------------- standings */

function StandingsTable({
  rows, historyByAccount,
}: { rows: RankRow[]; historyByAccount: Record<string, number[]> }) {
  const leader = rows[0]?.followers ?? 1;

  return (
    <div className="rounded-md border border-ink-700 overflow-x-auto">
      <table className="w-full text-sm min-w-[780px]">
        <thead className="bg-ink-800 text-2xs uppercase tracking-wider text-ink-300">
          <tr>
            <th className="text-left px-3 py-2 w-8">#</th>
            <th className="text-left px-3 py-2">Channel</th>
            <th className="text-right px-3 py-2">Followers</th>
            <th className="text-left px-3 py-2 w-[132px]">Share</th>
            <th className="text-right px-3 py-2">Per day</th>
            <th className="text-right px-3 py-2">Engagement</th>
            <th className="text-right px-3 py-2">Gap above</th>
            <th className="text-left px-3 py-2 w-[92px]">Trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr
              key={r.accountId}
              className={`border-t border-ink-800 transition-colors hover:bg-ink-850/60 ${r.isOwn ? 'bg-flare-500/5' : ''}`}
            >
              <td className="px-3 py-2.5 text-2xs font-mono text-ink-400 tabular-nums">{r.rank}</td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <PlatformGlyph platform={r.platform} />
                  <span className={r.isOwn ? 'text-flare-400 font-medium' : 'text-ink-100'}>{r.label}</span>
                  {r.isOwn && <span className="text-2xs font-mono text-flare-400/70">you</span>}
                </div>
              </td>
              <td className="px-3 py-2.5 text-right text-ink-100 tabular-nums">{r.followers.toLocaleString()}</td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-sm bg-ink-800 overflow-hidden">
                    <div
                      className={`h-full rounded-sm ${r.isOwn ? 'bg-flare-500' : 'bg-ink-600'}`}
                      style={{ width: `${Math.max(2, (r.followers / leader) * 100)}%` }}
                    />
                  </div>
                  <span className="text-2xs font-mono text-ink-400 tabular-nums w-9 text-right">
                    {r.sharePct.toFixed(0)}%
                  </span>
                </div>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                <Rate value={r.growth.perDay} />
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-ink-200">
                {r.engagementRatePct === null ? <Dash /> : `${r.engagementRatePct.toFixed(2)}%`}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-ink-300">
                {r.gapToNext === null ? <span className="text-2xs font-mono text-ink-500">leader</span> : r.gapToNext.toLocaleString()}
              </td>
              <td className="px-3 py-2.5">
                <Sparkline points={historyByAccount[r.accountId] ?? []} width={84} height={20} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Null means not enough readings yet. Rendering 0 would be a claim. */
function Rate({ value }: { value: number | null }) {
  if (value === null) return <Dash />;
  const up = value > 0;
  const flat = Math.round(value) === 0;
  return (
    <span className={flat ? 'text-ink-400' : up ? 'text-signal-green' : 'text-signal-red'}>
      {flat ? '0' : `${up ? '+' : ''}${Math.round(value).toLocaleString()}`}
    </span>
  );
}

function Dash() {
  return <span className="text-ink-500" title="Not enough readings yet">—</span>;
}

/* ----------------------------------------------------------------- viral */

function ViralCard({ viral }: { viral: ViralAnalysis }) {
  const hasContent = viral.patterns.length || viral.formats.length || viral.audienceThemes.length;

  return (
    <Section title="What is working" note={`${viral.sampleSize} posts analysed`}>
      <div className="rounded-md border border-ink-700 bg-ink-900 p-5">
        {!hasContent ? (
          <p className="text-sm text-ink-400">
            {viral.error ?? 'No patterns identified from the current sample.'}
          </p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <div>
              <h3 className="text-2xs font-mono uppercase tracking-wider text-flare-400 mb-2.5">Patterns</h3>
              <ul className="space-y-3">
                {viral.patterns.map((p, i) => (
                  <li key={i}>
                    <div className="text-sm font-medium text-ink-100">{p.name}</div>
                    <p className="text-2xs text-ink-300 mt-0.5 leading-relaxed">{p.evidence}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-2xs font-mono uppercase tracking-wider text-flare-400 mb-2.5">Formats to try</h3>
              <ul className="space-y-2">
                {viral.formats.map((f, i) => (
                  <li key={i} className="text-sm text-ink-200 leading-relaxed">{f}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-2xs font-mono uppercase tracking-wider text-flare-400 mb-2.5">Audience is saying</h3>
              <ul className="space-y-2">
                {viral.audienceThemes.map((t, i) => (
                  <li key={i} className="text-sm text-ink-200 leading-relaxed">{t}</li>
                ))}
              </ul>
              {!viral.audienceThemes.length && (
                <p className="text-2xs text-ink-400">No comments loaded yet.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ util */

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
        {note && <span className="text-2xs font-mono text-ink-400">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** Matches the final layout's line rhythm so nothing jumps when text arrives. */
function SkeletonLines() {
  return (
    <div className="space-y-2.5 animate-pulse" aria-hidden="true">
      <div className="h-3.5 rounded bg-ink-800 w-[92%]" />
      <div className="h-3.5 rounded bg-ink-800 w-[86%]" />
      <div className="h-3.5 rounded bg-ink-800 w-[64%]" />
      <div className="pt-3 space-y-2">
        <div className="h-3 rounded bg-ink-800 w-[78%]" />
        <div className="h-3 rounded bg-ink-800 w-[70%]" />
      </div>
    </div>
  );
}
