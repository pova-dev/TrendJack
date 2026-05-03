import * as React from 'react';
import type { SourceId } from '@/types';
import { cn } from '@/lib/utils';

const META: Record<SourceId, { label: string; glyph: string; color: string }> = {
  x:             { label: 'X',         glyph: '𝕏',  color: 'text-ink-100'       },
  reddit:        { label: 'Reddit',    glyph: 'r/', color: 'text-signal-amber'  },
  youtube:       { label: 'YouTube',   glyph: '▶',  color: 'text-signal-red'    },
  tiktok:        { label: 'TikTok',    glyph: '♪',  color: 'text-signal-violet' },
  instagram:     { label: 'Instagram', glyph: '◉',  color: 'text-signal-violet' },
  facebook:      { label: 'Facebook',  glyph: 'f',  color: 'text-signal-blue'   },
  google_trends: { label: 'GTrends',   glyph: 'g',  color: 'text-signal-blue'   },
  news:          { label: 'News',      glyph: '⌬',  color: 'text-ink-200'       },
  custom:        { label: 'Custom',    glyph: '◆',  color: 'text-flare-400'     },
};

export function SourceIcon({ source, className }: { source: SourceId; className?: string }) {
  const m = META[source];
  return (
    <span
      title={m.label}
      className={cn(
        'inline-flex items-center justify-center w-4 h-4 rounded-sm bg-ink-800 font-mono text-2xs leading-none',
        m.color,
        className,
      )}
    >
      {m.glyph}
    </span>
  );
}

export function sourceLabel(source: SourceId) { return META[source]?.label ?? source; }
