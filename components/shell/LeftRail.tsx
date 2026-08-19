'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { signoutAction } from '@/lib/auth/actions';
import {
  IconBoards, IconQueue, IconBrand, IconConnectors,
  IconScoring, IconAlerts, IconIntegrations, IconAudit,
  IconSparkle, IconSettings, IconLogout, IconSocial,
} from './icons';

// Primary nav — only the "live work" pages: dashboard, draft queue, and the
// social channel monitor. Everything configurable lives behind Settings.
const ITEMS = [
  { href: '/',         label: 'Boards',      Icon: IconBoards },
  { href: '/queue',    label: 'Draft queue', Icon: IconQueue },
  { href: '/social',   label: 'Social',      Icon: IconSocial },
];

// Secondary nav — single Settings entry that opens the unified hub
// (Brand Profile / AI / Scoring / Connectors / Integrations / Alerts /
// Audit). One icon, all configuration.
const SECONDARY = [
  { href: '/settings', label: 'Settings', Icon: IconSettings },
];

export function LeftRail({ user }: { user: { name: string; email: string } }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = React.useState(false);

  return (
    <nav className="flex flex-col w-[60px] border-r border-ink-700 bg-ink-950 py-3 relative">
      <Link href="/" aria-label="TrendJack home"
        className="flex items-center justify-center w-11 h-11 mx-auto mb-4 bg-flare-500 text-ink-950 rounded-lg font-bold text-sm hover:bg-flare-400 transition-colors">
        TJ
      </Link>

      <ul className="flex flex-col gap-1 flex-1">
        {ITEMS.map(({ href, label, Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <li key={href}>
              <RailItem href={href} label={label} active={active} Icon={Icon} />
            </li>
          );
        })}
      </ul>

      <ul className="flex flex-col gap-1 mt-2 pt-2 border-t border-ink-700">
        {SECONDARY.map(({ href, label, Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <li key={href}>
              <RailItem href={href} label={label} active={active} Icon={Icon} />
            </li>
          );
        })}
      </ul>

      {/* Avatar / sign-out */}
      <button
        onClick={() => setMenuOpen(v => !v)}
        title={user.email}
        className="flex items-center justify-center w-11 h-11 mx-auto mt-3 rounded-lg bg-ink-800 hover:bg-ink-700 text-sm font-bold text-ink-100"
      >
        {(user.name?.[0] ?? user.email[0]).toUpperCase()}
      </button>
      {menuOpen && (
        <div className="absolute left-[60px] bottom-3 z-30 w-60 rounded-md bg-ink-800 border border-ink-700 shadow-pop p-2 ml-1">
          <div className="px-2 py-1.5 mb-1">
            <div className="text-xs font-medium text-ink-100 truncate">{user.name}</div>
            <div className="text-2xs text-ink-300 truncate">{user.email}</div>
          </div>
          <Link href="/integrations" onClick={() => setMenuOpen(false)} className="block px-2 py-1.5 text-xs text-ink-200 hover:bg-ink-700 rounded">Integrations</Link>
          <Link href="/audit" onClick={() => setMenuOpen(false)} className="block px-2 py-1.5 text-xs text-ink-200 hover:bg-ink-700 rounded">Audit log</Link>
          <form action={signoutAction}>
            <button type="submit" className="w-full flex items-center gap-2 text-left px-2 py-1.5 text-xs text-signal-red hover:bg-ink-700 rounded">
              <IconLogout width={14} height={14} /> Sign out
            </button>
          </form>
        </div>
      )}
    </nav>
  );
}

interface RailItemProps {
  href: string;
  label: string;
  active: boolean;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}

function RailItem({ href, label, active, Icon }: RailItemProps) {
  return (
    <Link
      href={href}
      className={cn(
        'group relative flex items-center justify-center w-11 h-11 mx-auto rounded-lg transition-colors',
        active ? 'bg-ink-700 text-flare-400' : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100',
      )}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-flare-500" />}
      <Icon />
      {/* Tooltip */}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-[44px] z-40 whitespace-nowrap rounded-md bg-ink-800 border border-ink-700 px-2 py-1 text-2xs text-ink-100 opacity-0 group-hover:opacity-100 transition-opacity shadow-pop"
      >
        {label}
      </span>
    </Link>
  );
}
