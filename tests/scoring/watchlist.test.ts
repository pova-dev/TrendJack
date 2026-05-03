// Watchlist tests — verify the derivation from BrandProfile and the
// round-trip back to query lists.

import { describe, expect, it } from 'vitest';
import { watchlistFromBrand, groupByKind, deriveFromWatchlist } from '@/src/core/watchlist';
import { POVA_BRAND } from '../fixtures/pova-brand';

describe('watchlistFromBrand', () => {
  it('produces brand + competitor + theme + banned terms', () => {
    const terms = watchlistFromBrand(POVA_BRAND);
    const kinds = new Set(terms.map(t => t.kind));
    expect(kinds.has('brand')).toBe(true);
    expect(kinds.has('competitor')).toBe(true);
    expect(kinds.has('theme')).toBe(true);
    expect(kinds.has('banned')).toBe(true);
  });

  it('weighting: brand > competitor > theme', () => {
    const terms = watchlistFromBrand(POVA_BRAND);
    const brandW      = terms.filter(t => t.kind === 'brand')[0]?.weight;
    const competitorW = terms.filter(t => t.kind === 'competitor')[0]?.weight;
    const themeW      = terms.filter(t => t.kind === 'theme')[0]?.weight;
    expect(brandW).toBeGreaterThan(competitorW!);
    expect(competitorW!).toBeGreaterThan(themeW!);
  });

  it('term ids are deterministic for stable diff-based UI', () => {
    const a = watchlistFromBrand(POVA_BRAND);
    const b = watchlistFromBrand(POVA_BRAND);
    expect(a.map(t => t.id)).toEqual(b.map(t => t.id));
  });

  it('skips empty / whitespace-only terms', () => {
    const messy = {
      ...POVA_BRAND,
      brandKeywords: ['pova', '', '  ', 'tecno'],
    };
    const terms = watchlistFromBrand(messy).filter(t => t.kind === 'brand');
    expect(terms).toHaveLength(2);
    expect(terms.map(t => t.term).sort()).toEqual(['pova', 'tecno']);
  });
});

describe('deriveFromWatchlist (round-trip back to query lists)', () => {
  it('recovers brandKeywords / competitors / themes from a WatchTerm[]', () => {
    const terms = watchlistFromBrand(POVA_BRAND);
    const lists = deriveFromWatchlist(terms);
    expect(lists.brandKeywords).toContain('pova');
    expect(lists.competitors.map(c => c.toLowerCase())).toContain('xiaomi');
    expect(lists.themes.map(c => c.toLowerCase())).toContain('battery life');
  });
});

describe('groupByKind', () => {
  it('returns each kind as an array sorted by weight DESC', () => {
    const terms = watchlistFromBrand(POVA_BRAND);
    const grouped = groupByKind(terms);
    expect(grouped.brand.length).toBeGreaterThan(0);
    for (const list of Object.values(grouped)) {
      for (let i = 1; i < list.length; i++) {
        expect(list[i].weight).toBeLessThanOrEqual(list[i - 1].weight);
      }
    }
  });
});
