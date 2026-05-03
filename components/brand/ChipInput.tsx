'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'info' | 'flare';
  max?: number;
}

const TONE: Record<NonNullable<Props['tone']>, string> = {
  neutral: 'bg-ink-700 text-ink-200',
  good:    'bg-signal-green/15 text-signal-green',
  bad:     'bg-signal-red/15 text-signal-red',
  warn:    'bg-signal-amber/15 text-signal-amber',
  info:    'bg-signal-blue/15 text-signal-blue',
  flare:   'bg-flare-500/15 text-flare-400',
};

export function ChipInput({ value, onChange, placeholder, tone = 'neutral', max }: Props) {
  const [draft, setDraft] = React.useState('');

  function commit() {
    const v = draft.trim();
    if (!v) return;
    if (max && value.length >= max) return;
    if (value.includes(v)) { setDraft(''); return; }
    onChange([...value, v]);
    setDraft('');
  }

  return (
    <div className="rounded-md border border-ink-700 bg-ink-800 px-2 py-1.5 flex flex-wrap gap-1 focus-within:ring-1 focus-within:ring-flare-500">
      {value.map(v => (
        <span key={v} className={cn('inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs font-mono uppercase', TONE[tone])}>
          {v}
          <button type="button" onClick={() => onChange(value.filter(x => x !== v))} className="opacity-70 hover:opacity-100">×</button>
        </span>
      ))}
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
          else if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={value.length ? '' : placeholder}
        className="flex-1 min-w-[80px] bg-transparent text-xs text-ink-100 focus:outline-none placeholder:text-ink-500"
      />
    </div>
  );
}
