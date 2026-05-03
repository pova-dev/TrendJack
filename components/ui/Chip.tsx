import * as React from 'react';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'info' | 'flare';

export function Chip({
  children,
  tone = 'neutral',
  className,
  title,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs font-mono uppercase tracking-wide',
        tone === 'neutral' && 'bg-ink-700 text-ink-200',
        tone === 'good' && 'bg-signal-green/15 text-signal-green',
        tone === 'bad' && 'bg-signal-red/15 text-signal-red',
        tone === 'warn' && 'bg-signal-amber/15 text-signal-amber',
        tone === 'info' && 'bg-signal-blue/15 text-signal-blue',
        tone === 'flare' && 'bg-flare-500/15 text-flare-400',
        className,
      )}
    >
      {children}
    </span>
  );
}
