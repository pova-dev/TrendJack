import * as React from 'react';
import type { Recommendation } from '@/types';
import { cn } from '@/lib/utils';

const STYLES: Record<Recommendation, string> = {
  POST_NOW:   'bg-flare-500 text-ink-950',
  PREP_1H:    'bg-signal-amber/20 text-signal-amber border border-signal-amber/40',
  MONITOR:    'bg-ink-700 text-ink-200',
  IGNORE:     'bg-ink-800 text-ink-400 line-through',
  ESCALATE:   'bg-signal-violet/20 text-signal-violet border border-signal-violet/40',
  SAFE_PIVOT: 'bg-signal-cyan/20 text-signal-cyan border border-signal-cyan/40',
};

const LABEL: Record<Recommendation, string> = {
  POST_NOW:   'POST NOW',
  PREP_1H:    'PREP 1H',
  MONITOR:    'MONITOR',
  IGNORE:     'IGNORE',
  ESCALATE:   'ESCALATE',
  SAFE_PIVOT: 'SAFE PIVOT',
};

export function RecommendationBadge({ rec, className, learnedDirection }: {
  rec: Recommendation;
  className?: string;
  /** Optional indicator that calibration nudged this trend's ranking
   *  in the operator's direction. 'up' = boosted (operator usually
   *  saves this kind of trend); 'down' = dragged. Renders a tiny ↑/↓
   *  glyph next to the badge. Feature D Phase 3. */
  learnedDirection?: 'up' | 'down';
}) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span
        className={cn(
          'inline-flex items-center rounded-sm px-1.5 py-0.5 text-2xs font-bold uppercase tracking-wider',
          STYLES[rec],
          className,
        )}
      >
        {LABEL[rec]}
      </span>
      {learnedDirection && (
        <span
          className={cn(
            'text-2xs font-bold',
            learnedDirection === 'up' ? 'text-good-400' : 'text-bad-400',
          )}
          title={
            learnedDirection === 'up'
              ? 'Calibration learned: you usually save this kind of trend → ranking boosted'
              : 'Calibration learned: you usually dismiss this kind of trend → ranking dragged'
          }
        >
          {learnedDirection === 'up' ? '↑' : '↓'}
        </span>
      )}
    </span>
  );
}
