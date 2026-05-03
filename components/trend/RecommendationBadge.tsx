import * as React from 'react';
import type { Recommendation } from '@/types';
import { cn } from '@/lib/utils';

const STYLES: Record<Recommendation, string> = {
  POST_NOW:  'bg-flare-500 text-ink-950',
  PREP_1H:   'bg-signal-amber/20 text-signal-amber border border-signal-amber/40',
  MONITOR:   'bg-ink-700 text-ink-200',
  IGNORE:    'bg-ink-800 text-ink-400 line-through',
  ESCALATE:  'bg-signal-violet/20 text-signal-violet border border-signal-violet/40',
};

const LABEL: Record<Recommendation, string> = {
  POST_NOW:  'POST NOW',
  PREP_1H:   'PREP 1H',
  MONITOR:   'MONITOR',
  IGNORE:    'IGNORE',
  ESCALATE:  'ESCALATE',
};

export function RecommendationBadge({ rec, className }: { rec: Recommendation; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-1.5 py-0.5 text-2xs font-bold uppercase tracking-wider',
        STYLES[rec],
        className,
      )}
    >
      {LABEL[rec]}
    </span>
  );
}
