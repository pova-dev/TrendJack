import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { getBrand } from '@/lib/store';
import { computeCringe, CLICHE_STEMS, AD_SPEAK_STEMS, HYPE_STEMS, FORCED_SLANG_TRIGGERS } from '@/src/core/scoring/cringe';
import { computeTonalFit } from '@/src/core/scoring/tonal-fit';
import { detectForbiddenStyles } from '@/src/core/scoring/forbidden-styles';
import { matchStem } from '@/src/core/scoring/matchers';
import type { ScoreRationale } from '@/src/core/scoring/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/brand/voice-lint
//   body: { text }
//
// Treats the supplied text as a hypothetical draft and runs the SAME
// scoring pipeline that filters incoming trends against — but in
// reverse. Returns:
//   - cringe score (0..1)
//   - tonalFit score (0..1)
//   - per-vocabulary hits (banned phrases, ad-speak, clichés, hype,
//     forced slang, forbidden styles) with the offending substrings
//     so the UI can highlight them
//
// Operator pastes copy → sees what would fail before they ship.

interface LintBody { text?: string }

interface VocabHit {
  category: 'banned-phrase' | 'cliché' | 'ad-speak' | 'hype' | 'forced-slang' | 'forbidden-style';
  match: string;
  weight: 'high' | 'medium' | 'low';
}

export async function POST(req: NextRequest) {
  const auth = await getCurrentContext();
  if (!auth?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const data = (await req.json().catch(() => null)) as LintBody | null;
  const text = (data?.text ?? '').slice(0, 4000);
  if (!text.trim()) return NextResponse.json({ error: 'empty_text' }, { status: 400 });

  const brand = await getBrand(auth.brand.id);
  if (!brand) return NextResponse.json({ error: 'brand_missing' }, { status: 400 });

  // Synthesize a RawSignal-shaped object so we can call the scoring
  // primitives without changing their signature. Title carries the
  // text; everything else is neutral / zero.
  const fakeSignal = {
    source: 'custom' as const,
    title: text,
    summary: '',
    hashtags: [],
    lineage: '',
    firstSeenAt: new Date(),
    velocity: 0,
    reach: 0,
    sentiment: 0,
    competitorClaimants: [],
    formatFatigue: 0,
  };

  const cringeRationale: ScoreRationale[] = [];
  const tonalRationale: ScoreRationale[] = [];
  const cringe = computeCringe(fakeSignal, brand, cringeRationale);
  const tonalFit = computeTonalFit(fakeSignal, brand, tonalRationale);

  // Per-vocabulary hits with original-case match positions so the UI
  // can highlight them precisely.
  const blob = text.toLowerCase();
  const hits: VocabHit[] = [];

  for (const phrase of brand.tone.bannedPhrases) {
    const pl = phrase.toLowerCase();
    if (blob.includes(pl)) hits.push({ category: 'banned-phrase', match: phrase, weight: 'high' });
  }
  for (const stem of CLICHE_STEMS) {
    if (matchStem(blob, stem)) hits.push({ category: 'cliché', match: stem, weight: 'medium' });
  }
  for (const stem of AD_SPEAK_STEMS) {
    if (matchStem(blob, stem)) hits.push({ category: 'ad-speak', match: stem, weight: 'medium' });
  }
  for (const stem of HYPE_STEMS) {
    if (matchStem(blob, stem)) hits.push({ category: 'hype', match: stem, weight: 'low' });
  }
  for (const stem of FORCED_SLANG_TRIGGERS) {
    if (blob.includes(stem)) hits.push({ category: 'forced-slang', match: stem, weight: 'high' });
  }
  const forbidden = detectForbiddenStyles(blob, brand.tone.forbiddenStyles ?? []);
  for (const f of forbidden) {
    hits.push({ category: 'forbidden-style', match: f, weight: 'high' });
  }

  // Verdict: same logic decide.ts uses for incoming trends. > 0.7 = hard
  // kill territory; > 0.4 = rewrite required; < 0.2 = clean.
  const verdict =
    cringe > 0.7 ? 'fail' :
    cringe > 0.4 ? 'rewrite' :
    cringe > 0.2 ? 'caution' :
                   'clean';

  return NextResponse.json({
    text,
    cringe,
    tonalFit,
    verdict,
    hits,
    summary: {
      bannedPhrases: hits.filter(h => h.category === 'banned-phrase').length,
      cliche: hits.filter(h => h.category === 'cliché').length,
      adSpeak: hits.filter(h => h.category === 'ad-speak').length,
      hype: hits.filter(h => h.category === 'hype').length,
      forcedSlang: hits.filter(h => h.category === 'forced-slang').length,
      forbiddenStyle: hits.filter(h => h.category === 'forbidden-style').length,
    },
  });
}
