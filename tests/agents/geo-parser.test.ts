import { describe, expect, it } from 'vitest';
import { parseCitation } from '@/src/agents/geo/parser';

const POVA_KW = ['pova', 'tecno pova', 'pova curve', 'tecno'];
const COMPETITORS = ['Xiaomi', 'Samsung', 'Realme', 'OnePlus'];

describe('parseCitation', () => {
  it('detects brand citation as position 1 when named first', () => {
    const r = parseCitation(
      'For India, the standout pick is the Tecno POVA Curve 2. Strong battery and value.',
      POVA_KW, COMPETITORS,
    );
    expect(r.cited).toBe(true);
    expect(r.position).toBe(1);
    expect(r.competitorsMentioned).toEqual([]);
    expect(r.snippet.toLowerCase()).toContain('tecno');
  });

  it('detects position 3 when named after Xiaomi and Samsung', () => {
    const r = parseCitation(
      'The top phones in India: Xiaomi Redmi Note 14 Pro, Samsung Galaxy A55, then Tecno POVA Curve.',
      POVA_KW, COMPETITORS,
    );
    expect(r.cited).toBe(true);
    expect(r.position).toBe(3);
    expect(new Set(r.competitorsMentioned)).toEqual(new Set(['xiaomi', 'samsung']));
  });

  it('returns cited=false when brand absent', () => {
    const r = parseCitation(
      'The most popular phones are made by Xiaomi, Samsung, and Realme.',
      POVA_KW, COMPETITORS,
    );
    expect(r.cited).toBe(false);
    expect(r.position).toBeNull();
    expect(r.snippet).toBe('');
    expect(new Set(r.competitorsMentioned)).toEqual(new Set(['xiaomi', 'samsung', 'realme']));
  });

  it('word-boundary matched — no false positive on substring', () => {
    // 'pova' must not match 'innovation' or 'photovoltaics'
    const r = parseCitation(
      'The category has seen real innovation in photovoltaics and chip design.',
      ['pova'], COMPETITORS,
    );
    expect(r.cited).toBe(false);
  });

  it('case-insensitive match', () => {
    const r = parseCitation('TECNO POVA is a strong choice.', POVA_KW, COMPETITORS);
    expect(r.cited).toBe(true);
  });

  it('handles empty inputs gracefully', () => {
    expect(parseCitation('', POVA_KW, COMPETITORS).cited).toBe(false);
    expect(parseCitation('text here', [], []).cited).toBe(false);
  });

  it('dedupes competitor mentions', () => {
    const r = parseCitation(
      'Xiaomi has the lead. Xiaomi and Samsung both ship in India. The Tecno POVA also competes.',
      POVA_KW, COMPETITORS,
    );
    expect(r.cited).toBe(true);
    expect(new Set(r.competitorsMentioned)).toEqual(new Set(['xiaomi', 'samsung']));
  });
});
