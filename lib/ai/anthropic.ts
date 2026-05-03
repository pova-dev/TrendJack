import type { BrandProfile, Draft, Trend } from '@/types';

// Phase 1 deterministic generator. Phase 2 swaps to Anthropic SDK with the
// prompt chain in lib/ai/prompts/*. The shape returned is identical so the
// UI doesn't change.

export async function generateDraftsMock(trend: Trend, brand: BrandProfile): Promise<Draft[]> {
  const platform = brand.priorityPlatforms[0] ?? 'x';
  const baseTime = new Date().toISOString();

  const safeAngles = makeSafeAngles(trend, brand);
  const boldAngle = makeBoldAngle(trend, brand);
  const memeAngles = makeMemeAngles(trend, brand);

  const drafts: Draft[] = [
    ...safeAngles.map((d, i) => toDraft({
      ...d,
      trendId: trend.id,
      brandId: brand.id,
      variant: 'safe',
      platform,
      cringeScore: 0.15 + i * 0.03,
      id: `draft_${trend.id}_safe_${i}`,
      createdAt: baseTime,
      status: 'draft',
    })),
    toDraft({
      ...boldAngle,
      trendId: trend.id,
      brandId: brand.id,
      variant: 'bold',
      platform,
      cringeScore: 0.35,
      id: `draft_${trend.id}_bold`,
      createdAt: baseTime,
      status: 'draft',
    }),
    ...memeAngles.map((d, i) => toDraft({
      ...d,
      trendId: trend.id,
      brandId: brand.id,
      variant: 'meme',
      platform,
      cringeScore: 0.25 + i * 0.04,
      id: `draft_${trend.id}_meme_${i}`,
      createdAt: baseTime,
      status: 'draft',
    })),
  ];

  return drafts;
}

interface DraftBase {
  hook: string;
  body: string;
  cta?: string;
  visualBrief?: string;
  whyItWorks?: string;
  whatNotToSay?: string;
}

function toDraft(p: DraftBase & Omit<Draft, keyof DraftBase>): Draft {
  return p as unknown as Draft;
}

function makeSafeAngles(t: Trend, b: BrandProfile): DraftBase[] {
  return [
    {
      hook: `Battery is the spec that actually changes your life.`,
      body: `${shortRefFromTrend(t)} People aren't buying spec sheets. They're buying not-running-out-by-3pm.`,
      cta: `${b.tone.tagline}`,
      visualBrief: `Black background. POVA device, lower-center, ticker on left edge. No people, no lifestyle warmth.`,
      whyItWorks: `Aligns with the rising "battery anxiety" thread, doesn't claim "best ever," reads as a brand POV instead of a feature ad.`,
      whatNotToSay: `Avoid "unleash," "level up," and any battery-as-superpower metaphor.`,
    },
    {
      hook: `5000 mAh is the new minimum.`,
      body: `Anyone shipping less in 2026 is shipping last year. ${shortRefFromTrend(t)}`,
      cta: `Built for what's next.`,
      visualBrief: `Single number "5000" rendered massive in mono, orange ticker.`,
      whyItWorks: `Direct, specific, anti-cliché — fits POVA's verbal identity.`,
      whatNotToSay: `Don't quote competitor mAh numbers; that's a spec war we don't enter.`,
    },
  ];
}

function makeBoldAngle(t: Trend, b: BrandProfile): DraftBase {
  return {
    hook: `If your phone overheats in 18 minutes, you didn't buy a phone. You bought a sandwich press.`,
    body: `${shortRefFromTrend(t)} Performance you can't sustain isn't performance.`,
    cta: `Built for what's next.`,
    visualBrief: `Close-up of POVA back, no people, thermal motif via subtle gradient — never a literal flame.`,
    whyItWorks: `Memorable, brand-voice, lands the thermal POV without naming a competitor.`,
    whatNotToSay: `Do not name Realme/Samsung/etc. Do not include a "we don't overheat" claim — this leads with the joke.`,
  };
}

function makeMemeAngles(t: Trend, b: BrandProfile): DraftBase[] {
  return [
    {
      hook: `pov: your battery is at 84% and it's already 9pm`,
      body: `the difference is the phone, not the charger.`,
      cta: ``,
      visualBrief: `Plain black, single line of mono text, orange POVA mark bottom-right.`,
      whyItWorks: `Native meme cadence, no forced slang, on-format with current X/Reddit thread.`,
      whatNotToSay: `Don't append a sales line. The joke IS the post.`,
    },
    {
      hook: `we don't do flagship killers. we do phones that survive.`,
      body: `${shortRefFromTrend(t)}`,
      cta: ``,
      visualBrief: `Type-only post. White on black. JetBrains Mono.`,
      whyItWorks: `Rejects the cliché instead of using it — exactly the POVA voice.`,
      whatNotToSay: `Don't claim "best." Don't add specs.`,
    },
  ];
}

function shortRefFromTrend(t: Trend): string {
  return t.title.length > 60 ? '' : '';
}

// -----------------------------------------------------------------------------
// Phase 2 entry point — wired to Anthropic SDK with Sonnet 4.6 / Opus 4.7.
// Stubbed here for tooling; Phase 2 fills implementation.
// -----------------------------------------------------------------------------
export async function generateDraftsLive(_trend: Trend, _brand: BrandProfile): Promise<Draft[]> {
  throw new Error('not_implemented_in_phase_1');
}
