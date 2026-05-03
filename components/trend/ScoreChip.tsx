import * as React from 'react';
import { Chip } from '@/components/ui/Chip';

type Axis = 'opp' | 'fit' | 'risk' | 'cringe' | 'sat' | 'vel' | 'time' | 'fm' | 'cvs';

const LABELS: Record<Axis, string> = {
  opp: 'OPP', fit: 'FIT', risk: 'RISK', cringe: 'CRINGE',
  sat: 'SAT', vel: 'VEL', time: 'TIME', fm: 'FM',
  // CVS = (FIT × VEL × FM × Sp) / max(0.05, RISK + CRINGE + SAT_eff)
  // The canonical "should we act" signal — drives Verifier auto-fire +
  // Creative Agent gate. Rendered alongside OPP so operators can compare
  // the additive dashboard ranker (OPP) with the multiplicative trigger
  // (CVS) at a glance.
  cvs: 'CVS',
};

export function ScoreChip({
  axis,
  value,
  invert = false,
  size = 'sm',
}: {
  axis: Axis;
  value: number;        // 0..100 for opp; 0..1 for everything else
  invert?: boolean;     // for risk/cringe/sat — high is bad
  size?: 'sm' | 'xs';
}) {
  const v01 = axis === 'opp' ? value / 100 : value;
  const tone = invert
    ? v01 > 0.66 ? 'bad' : v01 > 0.33 ? 'warn' : 'good'
    : v01 > 0.66 ? 'good' : v01 > 0.33 ? 'warn' : 'bad';
  const display = axis === 'opp' ? Math.round(value) : Math.round(v01 * 100);
  return (
    <Chip tone={tone} className={size === 'xs' ? 'text-[9px] px-1' : ''}>
      {LABELS[axis]} <span className="font-bold tabular-nums">{display}</span>
    </Chip>
  );
}
