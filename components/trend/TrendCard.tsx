'use client';
import * as React from 'react';
import type { Trend } from '@/types';
import { cn, relTime, timeUntil } from '@/lib/utils';
import { SourceIcon, sourceLabel } from './SourceIcon';
import { VelocityIndicator } from './VelocityIndicator';
import { RecommendationBadge } from './RecommendationBadge';
import { ScoreChip } from './ScoreChip';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { resolveSourceUrl } from '@/lib/source-link';
import { displayLineage } from '@/lib/lineage-display';

interface Props {
  trend: Trend;
  active?: boolean;
  onOpen: (id: string) => void;
  onAction: (id: string, type: 'save' | 'dismiss' | 'generate' | 'assign' | 'pin') => void;
  /** When this trend represents a cluster of similar signals, the count
   *  of merged-in trends. Renders a "+N similar" chip on the card. */
  clusterCount?: number;
  /** Show LEGACY chip when the trend is older than 7d. Used only by
   *  Brand Matches in 15/30-day windows so historical entries are
   *  visually marked as audit material. */
  showLegacyChip?: boolean;
}

export const TrendCard = React.memo(function TrendCard({ trend, active, onOpen, onAction, clusterCount, showLegacyChip }: Props) {
  // ─────────────────────────────────────────────────────────────────────
  // Hydration-safe time tracking.
  //
  // Every wall-clock-derived value (relTime, timeUntil, isDecaying,
  // NEW/UPDATED chips) drifts between SSR and client hydration: the
  // server renders at t=0 and the browser hydrates ~1s later, producing
  // mismatches like "16h 58m left" → "16h 57m left" that React 18 throws
  // a hydration error for.
  //
  // Fix: gate every time-dependent value behind a `now` state initialized
  // to `null`. Server renders all such values as static placeholders
  // ('—'); after `useEffect` runs on the client we set `now` to the real
  // timestamp and the card re-renders with live values. Server and
  // initial-client renders match exactly.
  //
  // The placeholder phase only lasts a single paint frame, so the user
  // never visually sees the dash in practice.
  // ─────────────────────────────────────────────────────────────────────
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
    // Refresh every minute so the countdown stays roughly accurate without
    // re-rendering on every keystroke. Operators don't need second-level
    // precision on a 16-hour countdown.
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const peak = now != null ? timeUntil(trend.peakWindowEnd) : '—';
  const isHero = trend.recommendation === 'POST_NOW';

  // Decay state — only computed once we're past initial hydration.
  const peakMs  = trend.peakWindowEnd ? new Date(trend.peakWindowEnd).getTime() : 0;
  const startMs = new Date(trend.firstSeenAt).getTime();
  const lifeRatio = (now != null && peakMs > startMs)
    ? (now - startMs) / (peakMs - startMs)
    : 0;
  const isDecaying = lifeRatio > 0.7;
  const delta = trend.velocityDelta;
  const showDelta = typeof delta === 'number' && Math.abs(delta) > 0.15;

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onOpen(trend.id)}
      onKeyDown={e => {
        if (e.key === 'Enter') onOpen(trend.id);
        if (e.key === 'o') { e.preventDefault(); window.open(resolveSourceUrl(trend), '_blank'); }
      }}
      className={cn(
        'group relative cursor-pointer border-l-2 px-3 py-2 transition-colors',
        'hover:bg-ink-800/60 focus-visible:bg-ink-800/60 focus:outline-none',
        active ? 'bg-ink-800' : 'bg-ink-900',
        isHero ? 'border-flare-500' : 'border-transparent',
        trend.pinned && 'bg-flare-500/[0.04]',
        // Three visual tiers:
        //   1. Decaying (past 70% of peak life): heavy fade + grayscale.
        //      Independent of recommendation, so Decay Watch always reads
        //      as decayed regardless of why we're showing the trend.
        //   2. Plain IGNORE (off-brand, low-fit, etc.): mid fade. Visible
        //      enough for peripheral awareness, dim enough to clearly
        //      signal "don't act on this".
        //   3. Toxic IGNORE (cringe trap / banned topic / competitor
        //      doubled): heaviest fade — same as decaying.
        isDecaying && 'opacity-50 grayscale',
        !isDecaying && trend.recommendation === 'IGNORE' && (
          trend.scores.cringe > 0.7 ||
          trend.scores.topicalFit === 0 ||
          trend.competitorClaimants.length >= 2
            ? 'opacity-50 grayscale'
            : 'opacity-80'  // gentle peripheral dim, not "dead"
        ),
      )}
    >
      {trend.pinned && (
        <span className="absolute right-1 top-1 text-flare-400 text-2xs font-mono">📌</span>
      )}

      {/* LEGACY chip: trends > 7 days old in a 15/30-day window get a
          small "this is historical" marker so the operator can quickly
          tell the difference between today's signals and audit material. */}
      {showLegacyChip && (() => {
        const ageDays = (Date.now() - new Date(trend.firstSeenAt).getTime()) / (24 * 3_600_000);
        if (ageDays <= 7) return null;
        return (
          <span className="absolute right-1 top-1 text-2xs font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-ink-700/60 text-ink-400 border border-ink-600/40">
            legacy {Math.round(ageDays)}d
          </span>
        );
      })()}

      {/* Cluster badge: rendered when this card represents N similar
          signals merged together. Shown inline next to title; click on
          the parent card opens the drawer where individual members can
          be inspected. */}
      {typeof clusterCount === 'number' && clusterCount > 0 && (
        <span
          className="absolute left-1 top-1 text-2xs font-mono px-1.5 py-0.5 rounded bg-flare-500/15 text-flare-400 border border-flare-500/30"
          title={`+${clusterCount} similar signals merged`}
        >
          +{clusterCount}
        </span>
      )}

      {/* row 1 — meta. Defensive layout: left cluster shrinks, right
          cluster never shrinks. Whitespace-nowrap on the left so the
          source label + time stay on one line; right cluster has the
          velocity + delta + peak countdown. */}
      <header className="flex items-center gap-1.5 text-2xs text-ink-200 mb-1 min-w-0">
        <span className="flex items-center gap-1.5 min-w-0 shrink overflow-hidden whitespace-nowrap">
          <SourceIcon source={trend.source} />
          <span className="font-mono uppercase tracking-wide">{sourceLabel(trend.source)}</span>
          <span className="text-ink-500">·</span>
          <span>{now != null ? relTime(trend.firstSeenAt) : '—'}</span>
          {now != null && (() => {
            const created = new Date(trend.createdAt).getTime();
            const updated = new Date(trend.updatedAt).getTime();
            const tenMinAgo = now - 10 * 60 * 1000;
            if (created > tenMinAgo) return <Chip tone="flare" className="!px-1 !py-0 animate-pulse-slow">NEW</Chip>;
            if (updated > tenMinAgo) return <Chip tone="info"  className="!px-1 !py-0">↻ UPDATED</Chip>;
            return null;
          })()}
        </span>
        <span className="ml-auto flex items-center gap-2 shrink-0 whitespace-nowrap">
          <VelocityIndicator velocity={trend.velocity} />
          {showDelta && (
            <Chip tone={delta! > 0 ? 'good' : 'warn'} className="!px-1 !py-0">
              {delta! > 0 ? '▲' : '▼'} {Math.abs(Math.round(delta! * 100))}%
            </Chip>
          )}
          <span className={cn('font-mono', typeof peak === 'object' && peak.expired ? 'text-ink-500' : 'text-ink-300')}>
            ⏱ {typeof peak === 'object' ? peak.label : peak}
          </span>
        </span>
      </header>

      {/* row 2 — title (always-visible inline link to original).
          Falls back to a per-source search URL when trend.url is missing,
          so the ↗ icon is never absent. */}
      <h3 className="text-sm font-semibold text-ink-100 leading-snug line-clamp-1 mb-0.5 flex items-center gap-1.5">
        <span className="truncate">{trend.title}</span>
        <a
          href={resolveSourceUrl(trend)}
          target="_blank"
          rel="noreferrer noopener"
          onClick={e => e.stopPropagation()}
          className="flex-shrink-0 text-flare-400 hover:text-flare-300 text-2xs font-mono tabular-nums"
          title={trend.url ? `Open on ${sourceLabel(trend.source)} ↗` : `Search ${sourceLabel(trend.source)} ↗ (no canonical URL)`}
        >↗</a>
        {/* Verdict badge sits at the end of the title row — pairs the
            recommendation directly with what it labels, removes the
            row-4 ml-auto gap that felt cluttered. */}
        <span className="ml-auto flex-shrink-0">
          <RecommendationBadge
            rec={trend.recommendation}
            learnedDirection={
              typeof trend.calibrationBoost === 'number' && Math.abs(trend.calibrationBoost - 1) > 0.05
                ? trend.calibrationBoost > 1 ? 'up' : 'down'
                : undefined
            }
          />
        </span>
      </h3>

      {/* row 3 — lineage + Why-Now caption when available. The "why now"
          string is computed by the Resonance Agent (analyzeResonance);
          when not present, we fall back to the recommendationReason
          which already carries the brand-fit / risk explanation. Click
          opens the drawer with the Lineage tab pre-focused. */}
      <p className="text-xs text-ink-300/70 line-clamp-1 mb-0.5 flex items-center gap-1.5">
        <span className="truncate">{displayLineage(trend.lineage)}</span>
        {/* Predictive Virality phase pill — only renders when forecastPeak
            has produced a result. Confidence-aware copy: "growing 60%",
            "peaking 80%", "decaying 40%". `now` gating preserved through
            the parent `now` state — the pill itself is static. */}
        {trend.cascadePhase && trend.predictedPeakConfidence !== undefined && trend.predictedPeakConfidence > 0 && (
          <Chip
            tone={
              trend.cascadePhase === 'fast-growing-initial' ? 'good' :
              trend.cascadePhase === 'peaking'              ? 'flare' :
              trend.cascadePhase === 'decaying'             ? 'warn' :
                                                              'neutral'
            }
            className="!px-1 !py-0 ml-auto flex-shrink-0"
            title={`Predictive Virality (${Math.round(trend.predictedPeakConfidence * 100)}% confidence) — ${trend.cascadePhase.replace(/-/g, ' ')}`}
          >
            {trend.cascadePhase === 'fast-growing-initial' ? 'growing' :
             trend.cascadePhase === 'peaking'              ? 'peaking' :
             trend.cascadePhase === 'decaying'             ? 'decay'   :
                                                             trend.cascadePhase}
            {' '}
            <span className="font-mono tabular-nums">{Math.round(trend.predictedPeakConfidence * 100)}%</span>
          </Chip>
        )}
      </p>
      <p
        className="text-2xs text-flare-400/80 line-clamp-1 mb-1.5 italic"
        title={trend.recommendationReason}
      >
        ⤷ {trend.recommendationReason}
      </p>

      {/* row 4 — score chips. Recommendation badge moved to the title
          row (above) so the row-4 layout is just metrics, evenly spaced.
          CVS only renders when meaningful (>0.04) to avoid clutter on
          legacy rows that haven't been re-scored. */}
      <div className="flex items-center gap-1 mb-1.5">
        <ScoreChip axis="opp" value={trend.scores.opportunity} />
        {typeof trend.scores.jackingScore === 'number' && trend.scores.jackingScore > 0.04 && (
          <ScoreChip axis="cvs" value={trend.scores.jackingScore} />
        )}
        <ScoreChip axis="fit" value={trend.scores.brandFit} />
        <ScoreChip axis="risk" value={trend.scores.risk} invert />
        <ScoreChip axis="cringe" value={trend.scores.cringe} invert />
      </div>

      {/* row 5 — flags */}
      {(trend.competitorClaimed || trend.formatFatigue > 0.7 || trend.scores.firstMover >= 0.6) && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {trend.competitorClaimed && (
            <Chip tone="bad" title={`Claimed by ${trend.competitorClaimants.join(', ')}`}>
              CLAIMED · {trend.competitorClaimants[0]}
            </Chip>
          )}
          {trend.formatFatigue > 0.7 && <Chip tone="warn">FORMAT FATIGUE</Chip>}
          {trend.scores.firstMover >= 0.6 && !trend.competitorClaimed && (
            <Chip tone="flare">FIRST-MOVER</Chip>
          )}
        </div>
      )}

      {/* row 6 — actions.
       *  Mobile: always visible at full opacity, full-size buttons (Button
       *    component sizes mobile to h-11 = HIG 44pt floor).
       *  Desktop: low-opacity by default, full opacity on group-hover OR
       *    when any action button has keyboard focus (group-focus-within).
       *    Per Visual Auditor §D: keyboard users can now tab into the
       *    actions and they reveal — previously focus-within never fired
       *    because the article's tabIndex landed focus on the wrapper,
       *    not inside the action row. tabIndex=-1 on the article (below)
       *    + keyboard arrow handlers in Board.tsx still work because the
       *    Board manages selection at its level, not via per-card focus. */}
      <div className={cn(
        'flex items-center gap-1 motion-safe:transition-opacity',
        'sm:opacity-60 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100',
      )}>
        <Button size="sm" className="sm:!h-6 sm:!px-2 sm:!text-2xs" variant="primary" onClick={e => { e.stopPropagation(); onAction(trend.id, 'generate'); }}>Generate</Button>
        <Button size="sm" className="sm:!h-6 sm:!px-2 sm:!text-2xs" variant="ghost"   onClick={e => { e.stopPropagation(); onAction(trend.id, 'save'); }}>Save</Button>
        <Button size="sm" className="sm:!h-6 sm:!px-2 sm:!text-2xs" variant="ghost"   onClick={e => { e.stopPropagation(); onAction(trend.id, 'pin'); }}>{trend.pinned ? 'Unpin' : 'Pin'}</Button>
        <a
          href={resolveSourceUrl(trend)}
          target="_blank"
          rel="noreferrer noopener"
          onClick={e => e.stopPropagation()}
          className="inline-flex items-center gap-1 h-11 sm:h-6 px-3 sm:px-2 rounded-md text-sm sm:text-2xs font-medium text-ink-200 hover:bg-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
          aria-label={trend.url ? `Open ${trend.title} on ${sourceLabel(trend.source)}` : `Search ${sourceLabel(trend.source)} for ${trend.title}`}
          title={trend.url ? 'Open original (O)' : `Search ${sourceLabel(trend.source)} for this (O)`}
        >
          {trend.url ? 'Open ↗' : 'Search ↗'}
        </a>
        <Button size="xs" variant="ghost" className="ml-auto text-ink-400 hover:text-signal-red"
          aria-label={`Dismiss ${trend.title}`}
          onClick={e => { e.stopPropagation(); onAction(trend.id, 'dismiss'); }}>Dismiss</Button>
      </div>
    </article>
  );
});
