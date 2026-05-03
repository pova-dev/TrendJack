'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

type Theme = 'light' | 'dark' | 'system';

// Theme cycle: light → dark → system → light → …
// Source of truth lives in the html.classList ('light'|'dark'); we just
// reflect localStorage('tj-theme') into it. The no-FOUC script in
// app/layout.tsx applies the resolved theme before paint.
export function ThemeToggle() {
  const [theme, setTheme] = React.useState<Theme>('system');
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    const stored = (localStorage.getItem('tj-theme') as Theme | null) ?? 'system';
    setTheme(stored);
  }, []);

  React.useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    const resolved = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : theme;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    if (theme === 'system') localStorage.removeItem('tj-theme');
    else                    localStorage.setItem('tj-theme', theme);
  }, [theme, mounted]);

  // Re-evaluate on system-preference change while in 'system' mode.
  React.useEffect(() => {
    if (!mounted || theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      const root = document.documentElement;
      root.classList.remove('light', 'dark');
      root.classList.add(mq.matches ? 'light' : 'dark');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme, mounted]);

  function next() {
    setTheme(t => t === 'light' ? 'dark' : t === 'dark' ? 'system' : 'light');
  }

  // Render a stable placeholder during SSR / pre-hydration so we don't
  // hydration-mismatch on the icon. Once mounted, swap to real state.
  const label = !mounted ? 'system' : theme;
  const icon = !mounted ? '◐' : theme === 'light' ? '☀' : theme === 'dark' ? '◐' : '✦';

  return (
    <button
      onClick={next}
      title={`Theme: ${label} · click to cycle`}
      aria-label={`Theme: ${label}`}
      className={cn(
        'inline-flex items-center gap-1 h-7 px-2 rounded-md text-2xs font-mono uppercase tracking-wider',
        'border border-ink-700 bg-ink-800/40 text-ink-200',
        'hover:bg-ink-800 hover:text-ink-100 transition-colors',
      )}
    >
      <span className="text-sm leading-none" aria-hidden>{icon}</span>
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}
