import * as React from 'react';
import { cn } from '@/lib/utils';

export function VelocityIndicator({ velocity, className }: { velocity: number; className?: string }) {
  // Soft thresholds: <100 cool, 100-500 warm, 500-1000 hot, >1000 fire.
  const tier =
    velocity > 1000 ? 'fire' :
    velocity > 500 ? 'hot' :
    velocity > 100 ? 'warm' : 'cool';
  const arrow = tier === 'cool' ? '→' : '▲';
  const display = velocity >= 1000 ? `${(velocity / 1000).toFixed(1)}k` : Math.round(velocity);
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 font-mono text-2xs tabular-nums',
      tier === 'cool'  && 'text-ink-300',
      tier === 'warm'  && 'text-signal-amber',
      tier === 'hot'   && 'text-flare-400',
      tier === 'fire'  && 'text-flare-500 font-semibold',
      className,
    )}>
      <span>{arrow}</span><span>{display}/h</span>
    </span>
  );
}
