'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { BrandSwitcher } from './BrandSwitcher';
import { RefreshButton } from './RefreshButton';
import { FreshnessPill } from './FreshnessPill';
import { ThemeToggle } from './ThemeToggle';
import { useHeaderSlot } from './header-slot';
import { useNow } from '@/lib/hooks/use-now';

interface Brand { id: string; name: string; category: string; crisisMode?: boolean }

interface Props {
  brand: Brand;
  brands: Brand[];
  /** Drives which tabs exist. Resolved server-side from the capability
   *  matrix, so a hidden tab is a real gate and not a cosmetic one. */
  canAdmin: boolean;
}

interface Tab { href: string; label: string; match: (p: string) => boolean }

// Primary navigation. Six of the ten areas holding data had no navigation
// pointing at them at all: audit, connectors, integrations, alerts, brand and
// scoring were reachable only by typing the URL. For anyone non-technical that
// data may as well not exist, which is why they are grouped and surfaced here
// rather than left to a four-item icon rail.
const TABS: Tab[] = [
  { href: '/',        label: 'Today',   match: p => p === '/' },
  { href: '/board',   label: 'Board',   match: p => p.startsWith('/board') },
  { href: '/social',  label: 'Social',  match: p => p.startsWith('/social') },
  { href: '/queue',   label: 'Queue',   match: p => p.startsWith('/queue') },
  { href: '/alerts',  label: 'Alerts',  match: p => p.startsWith('/alerts') },
  { href: '/brand',   label: 'Brand',   match: p => p.startsWith('/brand') },
];

// Shown only to roles holding org:admin. Groups the previously orphaned
// operational pages under one destination.
const ADMIN_TAB: Tab = {
  href: '/admin',
  label: 'Admin',
  match: p => p.startsWith('/admin') || p.startsWith('/audit')
    || p.startsWith('/connectors') || p.startsWith('/integrations'),
};

export function AppHeader({ brand, brands, canAdmin }: Props) {
  const pathname = usePathname() ?? '/';
  const slot = useHeaderSlot();
  const [overflowOpen, setOverflowOpen] = React.useState(false);
  const [navOpen, setNavOpen] = React.useState(false);

  const tabs = canAdmin ? [...TABS, ADMIN_TAB] : TABS;
  const active = tabs.find(t => t.match(pathname));

  // Close the mobile nav on navigation, otherwise it stays open over the page
  // the user just asked for.
  React.useEffect(() => { setNavOpen(false); setOverflowOpen(false); }, [pathname]);

  return (
    <header className="border-b border-ink-700 bg-ink-950">
      <div className="flex items-center gap-2 md:gap-3 h-11 px-3 md:px-4 relative">
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <BrandSwitcher current={brand} brands={brands} />
        </div>

        <div className="hidden md:block h-5 w-px bg-ink-700" />

        {/* Navigation never compresses or wraps. It is the one thing in the bar
            that must always be usable, so everything else yields to it. */}
        <nav aria-label="Sections" className="hidden md:flex items-center gap-0.5 shrink-0">
          {tabs.map(t => (
            <TabLink key={t.href} tab={t} active={t === active} />
          ))}
        </nav>

        {/* min-w-0 lets this cluster shrink rather than push the tabs off the
            bar. Without it the status chips overran the Admin tab at 1440px,
            which is the width most laptops actually run. */}
        <div className="ml-auto flex items-center gap-2 min-w-0 justify-end">
          {/* Crisis is the one status that must never be hidden, at any width. */}
          {brand.crisisMode ? (
            <Chip tone="bad">CRISIS</Chip>
          ) : (
            <Chip tone="good" className="hidden 2xl:inline-flex shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-signal-green animate-pulse-slow inline-block mr-1" />
              live
            </Chip>
          )}

          {/* Progressive disclosure by width, ordered by how much each earns
              its space. Counts and freshness are glanceable extras; the
              controls are the reason the bar exists, so they never drop. */}
          <div className="hidden xl:flex items-center gap-2 min-w-0 shrink">
            <Metrics slot={slot} />
          </div>
          <div className="hidden 2xl:flex items-center gap-2 shrink-0">
            <FreshnessPill />
            <LastTick iso={slot.liveAt} />
          </div>
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <RefreshButton />
            <ThemeToggle />
            {slot.onAddColumn && (
              <Button variant="primary" size="sm" onClick={slot.onAddColumn}>+ Column</Button>
            )}
          </div>

          {/* Mobile: one control for sections, one for everything else. */}
          <button
            onClick={() => { setNavOpen(v => !v); setOverflowOpen(false); }}
            className="md:hidden flex items-center gap-1 h-11 px-2 rounded-md hover:bg-ink-800 text-sm text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400"
            aria-expanded={navOpen}
          >
            {active?.label ?? 'Menu'}
            <span className="text-ink-400 text-xs">▾</span>
          </button>
          <button
            onClick={() => { setOverflowOpen(v => !v); setNavOpen(false); }}
            className="md:hidden flex items-center justify-center w-11 h-11 rounded-md hover:bg-ink-800 text-ink-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400"
            aria-expanded={overflowOpen}
            aria-label="More controls"
          >
            ⋯
          </button>
        </div>

        {navOpen && (
          <div className="md:hidden absolute right-2 top-12 z-30 w-52 bg-ink-800 border border-ink-700 rounded-md shadow-pop p-1">
            {tabs.map(t => (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  'block px-3 py-2.5 rounded text-sm',
                  t === active ? 'bg-ink-700 text-ink-100' : 'text-ink-200 hover:bg-ink-700',
                )}
              >
                {t.label}
              </Link>
            ))}
          </div>
        )}

        {overflowOpen && (
          <div className="md:hidden absolute right-2 top-12 z-30 w-56 bg-ink-800 border border-ink-700 rounded-md shadow-pop p-2 space-y-2">
            <div className="px-1"><Metrics slot={slot} stacked /></div>
            <div className="flex items-center gap-2 px-1">
              <FreshnessPill />
              <LastTick iso={slot.liveAt} />
            </div>
            <div className="flex items-center gap-2 pt-1 border-t border-ink-700">
              <RefreshButton />
              <ThemeToggle />
            </div>
            {slot.onAddColumn && (
              <Button variant="primary" size="sm" className="w-full"
                onClick={() => { setOverflowOpen(false); slot.onAddColumn?.(); }}>
                + Column
              </Button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

function TabLink({ tab, active }: { tab: Tab; active: boolean }) {
  return (
    <Link
      href={tab.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative px-3 h-11 flex items-center text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-inset',
        active ? 'text-ink-100 font-medium' : 'text-ink-400 hover:text-ink-200',
      )}
    >
      {tab.label}
      {/* Underline rather than a filled pill: the active row reads at a glance
          without turning the bar into a strip of competing blocks. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-2 right-2 bottom-0 h-px transition-colors',
          active ? 'bg-flare-500' : 'bg-transparent',
        )}
      />
    </Link>
  );
}

/** Counts, omitted entirely where the page has none. A zero would read as a
 *  measured result; absence is the honest rendering of "not applicable". */
function Metrics({ slot, stacked }: { slot: ReturnType<typeof useHeaderSlot>; stacked?: boolean }) {
  if (slot.trendCount == null && slot.postNowCount == null) return null;
  return (
    <div className={cn('flex items-center', stacked ? 'justify-between text-2xs font-mono text-ink-300' : 'gap-5')}>
      {slot.trendCount != null && (
        <span className="flex items-baseline gap-1.5">
          <span className="text-sm font-mono tabular-nums text-ink-100 leading-none">{slot.trendCount}</span>
          <span className="text-2xs text-ink-400">signals</span>
        </span>
      )}
      {slot.postNowCount != null && (
        <span className="flex items-baseline gap-1.5">
          <span className={cn(
            'text-sm font-mono tabular-nums leading-none',
            slot.postNowCount > 0 ? 'text-flare-400' : 'text-ink-400',
          )}>{slot.postNowCount}</span>
          <span className="text-2xs text-ink-400">post now</span>
        </span>
      )}
    </div>
  );
}

/**
 * Age of the last ingest tick.
 *
 * Reads the clock through useNow rather than calling Date.now() in render.
 * The previous header computed the age inline, so the server rendered one
 * string and the client rendered another and React reported a hydration
 * mismatch, which is the "1 error" toast described in CLAUDE.md rule 10.
 */
function LastTick({ iso }: { iso?: string }) {
  const now = useNow();
  if (!iso) return null;
  const label = now == null
    ? '—'
    : (() => {
        const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
        return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
      })();
  return <span className="text-2xs font-mono text-ink-400">last tick {label}</span>;
}
