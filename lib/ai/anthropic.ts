import type { BrandProfile, Draft, Trend } from '@/types';

// Phase 1 deterministic generator. Phase 2 swaps to Anthropic SDK with the
// prompt chain in lib/ai/prompts/*. The shape returned is identical so the
// UI doesn't change.
//
// Round 3 cross-category audit caught the previous mock generator
// hard-coding POVA-specific copy ("5000 mAh", "phones that survive",
// "Built for what's next") that shipped silently to any tenant whose AI
// keys hadn't been configured yet — Vault Fintech got smartphone copy.
// The replacement below is intentionally generic and SELF-LABELED as
// a placeholder: every variant carries a "[mock — configure AI to
// generate brand-fit drafts]" hook prefix so operators can never
// confuse it for real LLM output.

const MOCK_DISCLAIMER_HOOK = '[mock placeholder — configure your AI provider for brand-fit drafts]';

export async function generateDraftsMock(trend: Trend, brand: BrandProfile): Promise<Draft[]> {
  const platform = brand.priorityPlatforms[0] ?? 'x';
  const baseTime = new Date().toISOString();

  const variants = makeBrandAgnosticVariants(trend, brand);

  return variants.map((d, i) => toDraft({
    ...d,
    trendId: trend.id,
    brandId: brand.id,
    variant: d.variant,
    platform,
    cringeScore: 0.20 + i * 0.04,
    id: `draft_${trend.id}_mock_${i}`,
    createdAt: baseTime,
    status: 'draft',
  }));
}

interface DraftBase {
  hook: string;
  body: string;
  cta?: string;
  visualBrief?: string;
  whyItWorks?: string;
  whatNotToSay?: string;
  variant: 'safe' | 'bold' | 'meme';
}

function toDraft(p: DraftBase & Omit<Draft, keyof DraftBase>): Draft {
  return p as unknown as Draft;
}

// Brand-agnostic placeholder drafts. We pull what we honestly know from
// the brand profile (name, category, tagline, voice) and produce
// instructional templates that any operator can edit. No invented facts,
// no category-specific vocabulary.
function makeBrandAgnosticVariants(t: Trend, b: BrandProfile): DraftBase[] {
  const ref = t.title.length > 80 ? `${t.title.slice(0, 78)}…` : t.title;
  const tagline = b.tone.tagline?.trim() || '';
  const category = b.category?.trim() || 'your brand';

  return [
    {
      variant: 'safe',
      hook: `${MOCK_DISCLAIMER_HOOK} — Safe angle for ${b.name}`,
      body: `Trend reference: "${ref}". Connect it to the ${category} POV your audience already trusts. Lead with a clear observation, follow with a specific insight, end with a soft pivot to your offer.`,
      cta: tagline,
      visualBrief: `Type-led post in your brand colors. Avoid stock imagery; lean on your typographic system.`,
      whyItWorks: `Mock placeholder — real AI output will adapt hook + body to your brand voice and the trend's specific framing.`,
      whatNotToSay: `Don't claim facts you can't cite. Don't fabricate competitor activity. Don't post until you've reviewed against /brand → Banned phrases.`,
    },
    {
      variant: 'bold',
      hook: `${MOCK_DISCLAIMER_HOOK} — Bold angle for ${b.name}`,
      body: `Trend reference: "${ref}". Take a contrarian read on what the trend assumes — your brand's POV usually disagrees with the consensus reaction. State it sharply.`,
      cta: tagline,
      visualBrief: `One bold visual element (single object, single number, single quote). Negative space dominates.`,
      whyItWorks: `Mock placeholder — real AI output uses your tone.voice + bannedPhrases to find the brand-fit contrarian read.`,
      whatNotToSay: `Don't name competitors. Don't make claims your verifier can't cite.`,
    },
    {
      variant: 'meme',
      hook: `${MOCK_DISCLAIMER_HOOK} — Meme/native angle for ${b.name}`,
      body: `Trend reference: "${ref}". Match the platform's native cadence — short, no sales line. The trend itself is the setup; your one-liner is the punch.`,
      cta: '',
      visualBrief: `Match the format of the trend (text-only, screenshot, or remix). Resist over-designing.`,
      whyItWorks: `Mock placeholder — real AI output is gated by your brand's allowedJokes + forbiddenStyles before shipping.`,
      whatNotToSay: `Don't append a CTA — the joke IS the post.`,
    },
  ];
}

// -----------------------------------------------------------------------------
// Phase 2 entry point — wired to Anthropic SDK with Sonnet 4.6 / Opus 4.7.
// Stubbed here for tooling; Phase 2 fills implementation.
// -----------------------------------------------------------------------------
export async function generateDraftsLive(_trend: Trend, _brand: BrandProfile): Promise<Draft[]> {
  throw new Error('not_implemented_in_phase_1');
}
