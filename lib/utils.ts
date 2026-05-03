import clsx, { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBig(n: number | bigint): string {
  const v = typeof n === 'bigint' ? Number(n) : n;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
}

export function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function timeUntil(iso?: string): { label: string; expired: boolean } {
  if (!iso) return { label: '—', expired: false };
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { label: 'past peak', expired: true };
  const m = Math.floor(ms / 60000);
  if (m < 60) return { label: `${m}m left`, expired: false };
  const h = Math.floor(m / 60);
  return { label: `${h}h ${m % 60}m left`, expired: false };
}

export function pct(n: number) { return `${Math.round(n * 100)}%`; }
