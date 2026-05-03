// Unit tests for the word-aware text matchers.
//
// These guard against the regression we fixed earlier this session: the
// substring-based matcher would FAIL to match "redefining" against the stem
// "redefine" because the trailing 'e' wasn't in the longer word — the audit
// caught that and switched to stem-prefix-with-boundary semantics.

import { describe, expect, it } from 'vitest';
import { matchKeyword, matchStem } from '@/src/core/scoring/matchers';

describe('matchKeyword', () => {
  it('matches an exact word at start, middle, and end', () => {
    expect(matchKeyword('pova review',     'pova')).toBe(true);
    expect(matchKeyword('the pova phone',  'pova')).toBe(true);
    expect(matchKeyword('check out pova',  'pova')).toBe(true);
  });

  it('respects word boundaries — does not match inside other words', () => {
    expect(matchKeyword('innovation',         'pova')).toBe(false);
    expect(matchKeyword('spovapocalypse',     'pova')).toBe(false);
    expect(matchKeyword('approval',           'pova')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(matchKeyword('POVA Curve unboxing', 'pova')).toBe(true);
    expect(matchKeyword('pova curve unboxing', 'POVA')).toBe(true);
  });

  it('matches multi-word keywords', () => {
    expect(matchKeyword('the new tecno pova review',  'tecno pova')).toBe(true);
    expect(matchKeyword('tecno mobile launches',      'tecno mobile')).toBe(true);
  });

  it('matches across hyphens and punctuation as boundaries', () => {
    expect(matchKeyword('POVA-Curve unboxing',  'pova')).toBe(true);
    expect(matchKeyword('the.pova.review',      'pova')).toBe(true);
  });

  it('returns false for empty haystack', () => {
    expect(matchKeyword('', 'pova')).toBe(false);
  });
});

describe('matchStem', () => {
  it('matches the stem and any inflection that follows', () => {
    expect(matchStem('this is redefining the market', 'redefin')).toBe(true);
    expect(matchStem('we redefined gaming',           'redefin')).toBe(true);
    expect(matchStem('that redefines what is fast',   'redefin')).toBe(true);
    expect(matchStem('exact redefin',                 'redefin')).toBe(true);
  });

  it('does NOT match if the stem is preceded by another letter', () => {
    expect(matchStem('predefined values', 'defin')).toBe(false);
    expect(matchStem('undefined behavior', 'defin')).toBe(false);
  });

  it('handles the boycott/boycotted/boycotts family', () => {
    expect(matchStem('they boycotted the launch',  'boycott')).toBe(true);
    expect(matchStem('a wave of boycotts',         'boycott')).toBe(true);
    expect(matchStem('demanding a boycott',        'boycott')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchStem('REDEFINING the market',     'redefin')).toBe(true);
    expect(matchStem('that REDEFINES gaming',     'redefin')).toBe(true);
  });
});
