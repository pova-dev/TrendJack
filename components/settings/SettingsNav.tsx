'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  helper: string;
  glyph: string;
}

const ITEMS: NavItem[] = [
  { href: '/settings/brand',        label: 'Brand Profile',  helper: 'Voice, keywords, topics, audience',          glyph: '◆' },
  { href: '/settings/ai',           label: 'AI Providers',    helper: 'Anthropic / OpenAI / Gemini / OpenRouter',   glyph: '✦' },
  { href: '/settings/scoring',      label: 'Scoring',         helper: 'Weights + projected top-N preview',          glyph: '∿' },
  { href: '/settings/connectors',   label: 'Connectors',      helper: 'X, Reddit, YouTube, News, RSSHub, …',        glyph: '⌬' },
  { href: '/settings/integrations', label: 'Integrations',    helper: 'Telegram, webhooks, Slack',                  glyph: '⇆' },
  { href: '/settings/alerts',       label: 'Alerts',          helper: 'Threshold rules + history',                  glyph: '◉' },
  { href: '/settings/audit',        label: 'Audit log',       helper: 'Org-wide action history',                    glyph: '☰' },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <aside className="w-60 flex-shrink-0 border-r border-ink-700 bg-ink-950 overflow-y-auto py-4">
      <div className="px-4 mb-3">
        <h1 className="text-2xs font-semibold uppercase tracking-widest text-ink-300">Settings</h1>
      </div>
      <ul className="space-y-0.5 px-2">
        {ITEMS.map(it => {
          const active = pathname === it.href || pathname.startsWith(it.href + '/');
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                className={cn(
                  'flex items-start gap-2.5 px-3 py-2 rounded-md transition-colors',
                  active
                    ? 'bg-ink-800 text-ink-100'
                    : 'text-ink-300 hover:bg-ink-800/60 hover:text-ink-100',
                )}
              >
                <span className={cn(
                  'font-mono text-sm leading-none mt-0.5',
                  active ? 'text-flare-400' : 'text-ink-400',
                )}>
                  {it.glyph}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-medium leading-snug">{it.label}</span>
                  <span className="block text-2xs text-ink-400 leading-tight">{it.helper}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
