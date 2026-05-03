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

// TopBar layout strategy:
//   <md (mobile): Brand switcher + crisis chip + a single overflow ⋯
//                 button that reveals refresh / theme / +column / live
//                 chip / signals counts. Keeps the bar to one row at
//                 even narrow viewports.
//   ≥md (desktop): everything inline, the way it was.
export function TopBar({ brand, brands, trendCount, postNowCount, liveAt, onAddColumn }: Props) {
  const [overflowOpen, setOverflowOpen] = React.useState(false);

  return (
    <header className="flex items-center gap-2 md:gap-3 h-11 px-3 md:px-4 border-b border-ink-700 bg-ink-950 relative">
      <div className="flex items-center gap-2 min-w-0">
        <span className="hidden md:inline text-2xs font-mono uppercase tracking-widest text-ink-300">brand</span>
        <BrandSwitcher current={brand} brands={brands} />
      </div>

      <div className="hidden md:block h-5 w-px bg-ink-700 mx-1" />

      <div className="hidden md:flex items-center gap-3 text-2xs font-mono text-ink-300">
        <span>signals <span className="text-ink-100 tabular-nums">{trendCount}</span></span>
        <span>post-now <span className="text-flare-400 tabular-nums">{postNowCount}</span></span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Always-visible status: crisis is the one piece of info that
            must never be hidden, even on narrow screens. */}
        {brand.crisisMode ? (
          <Chip tone="bad">CRISIS</Chip>
        ) : (
          <Chip tone="good" className="hidden sm:inline-flex">
            <span className="w-1.5 h-1.5 rounded-full bg-signal-green animate-pulse-slow inline-block mr-1" />
            live
          </Chip>
        )}

        {/* Desktop-only inline controls. */}
        <div className="hidden md:flex items-center gap-2">
          <FreshnessPill />
          {liveAt && <span className="text-2xs font-mono text-ink-400">last tick {tickAge(liveAt)}</span>}
          <span className="text-2xs font-mono text-ink-400 hidden xl:inline">
            <kbd className="px-1 py-0.5 bg-ink-800 rounded text-ink-200">/</kbd> co-pilot · <kbd className="px-1 py-0.5 bg-ink-800 rounded text-ink-200">J</kbd>/<kbd className="px-1 py-0.5 bg-ink-800 rounded text-ink-200">K</kbd>
          </span>
          <RefreshButton />
          <ThemeToggle />
          <Button variant="primary" size="sm" onClick={onAddColumn}>+ Column</Button>
        </div>

        {/* Mobile overflow menu: collapses every secondary control into
            one tap-target. Sticky-positioned popover on tap. */}
        <button
          onClick={() => setOverflowOpen(v => !v)}
          className="md:hidden flex items-center justify-center w-11 h-11 rounded-md hover:bg-ink-800 text-ink-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
          title="More controls"
          aria-expanded={overflowOpen}
          aria-label="Open menu"
        >
          ⋯
        </button>
      </div>

      {overflowOpen && (
        <div
          className="md:hidden absolute right-2 top-12 z-30 w-56 bg-ink-800 border border-ink-700 rounded-md shadow-pop p-2 space-y-2"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between text-2xs font-mono text-ink-300 px-1">
            <span>signals <span className="text-ink-100 tabular-nums">{trendCount}</span></span>
            <span>post-now <span className="text-flare-400 tabular-nums">{postNowCount}</span></span>
          </div>
          <div className="flex items-center gap-2 px-1">
            <FreshnessPill />
            {liveAt && <span className="text-2xs font-mono text-ink-400">{tickAge(liveAt)}</span>}
          </div>
          <div className="flex items-center gap-2 pt-1 border-t border-ink-700">
            <RefreshButton />
            <ThemeToggle />
          </div>
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            onClick={() => { setOverflowOpen(false); onAddColumn?.(); }}
          >
            + Column
          </Button>
        </div>
      )}
    </header>
  );
}

function tickAge(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}
