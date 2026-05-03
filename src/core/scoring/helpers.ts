// Pure scalar helpers. No I/O, no globals, no surprises.
// Kept in their own module so test files can import them without pulling
// in any of the heavy scoring vocab.

import type { Scores, ScoreRationale } from '@/types';

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function formatBig(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

export function sigmoid01(x: number, midpoint: number, k: number): number {
  return 1 / (1 + Math.exp(-k * (x - midpoint)));
}

export function pushRationale(
  arr: ScoreRationale[],
  axis: keyof Scores,
  value: number,
  reasons: string[],
): void {
  arr.push({ axis, value: round(value), reasons });
}
