'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

interface TabsProps {
  value: string;
  onChange: (v: string) => void;
  tabs: { value: string; label: string; count?: number }[];
  className?: string;
}

export function Tabs({ value, onChange, tabs, className }: TabsProps) {
  return (
    <div className={cn('flex border-b border-ink-700', className)}>
      {tabs.map(t => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'px-3 py-2 text-xs font-medium transition-colors relative',
            value === t.value
              ? 'text-ink-100'
              : 'text-ink-300 hover:text-ink-100',
          )}
        >
          {t.label}
          {typeof t.count === 'number' && (
            <span className="ml-1 text-ink-400">({t.count})</span>
          )}
          {value === t.value && (
            <span className="absolute bottom-0 left-0 right-0 h-px bg-flare-500" />
          )}
        </button>
      ))}
    </div>
  );
}
