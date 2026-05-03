'use client';
import * as React from 'react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { BrandSwitcher } from './BrandSwitcher';
import { RefreshButton } from './RefreshButton';
import { FreshnessPill } from './FreshnessPill';
import { ThemeToggle } from './ThemeToggle';

interface Brand { id: string; name: string; category: string; crisisMode?: boolean }

interface Props {
  brand: Brand;
  brands: Brand[];
  trendCount: number;
  postNowCount: number;
  liveAt?: string;
  onAddColumn?: () => void;
}

export function TopBar({ brand, brands, trendCount, postNowCount, liveAt, onAddColumn }: Props) {
  return (
    <header className="flex items-center gap-3 h-11 px-4 border-b border-ink-700 bg-ink-950">
      <div className="flex items-center gap-2">
        <span className="text-2xs font-mono uppercase tracking-widest text-ink-300">brand</span>
        <BrandSwitcher current={brand} brands={brands} />
      </div>

      <div className="h-5 w-px bg-ink-700 mx-1" />

      <div className="flex items-center gap-3 text-2xs font-mono text-ink-300">
        <span>signals <span className="text-ink-100 tabular-nums">{trendCount}</span></span>
        <span>post-now <span className="text-flare-400 tabular-nums">{postNowCount}</span></span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <FreshnessPill />
        {brand.crisisMode ? (
          <Chip tone="bad">CRISIS MODE — reactive paused</Chip>
        ) : (
          <Chip tone="good">
            <span className="w-1.5 h-1.5 rounded-full bg-signal-green animate-pulse-slow inline-block mr-1" />
            live
          </Chip>
        )}
        {liveAt && <span className="text-2xs font-mono text-ink-400">last tick {tickAge(liveAt)}</span>}
        <span className="text-2xs font-mono text-ink-400 hidden xl:inline">
          <kbd className="px-1 py-0.5 bg-ink-800 rounded text-ink-200">/</kbd> co-pilot · <kbd className="px-1 py-0.5 bg-ink-800 rounded text-ink-200">J</kbd>/<kbd className="px-1 py-0.5 bg-ink-800 rounded text-ink-200">K</kbd>
        </span>
        <RefreshButton />
        <ThemeToggle />
        <Button variant="primary" size="sm" onClick={onAddColumn}>+ Column</Button>
      </div>
    </header>
  );
}

function tickAge(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}
