// Template registry — typed structural skeletons for each channel.
//
// Adding a template: append to TEMPLATES. Each entry declares the channel,
// format, slot list (with constraints), and which hooks it pairs with.
// The Creative Agent picks the (template, hook) cross-product that best
// fits the brand × trend pair.

import type { Template } from './types';

export const TEMPLATES: readonly Template[] = [
  // ─── X (Twitter) ────────────────────────────────────────────────────
  {
    id: 'x-thread-3',
    label: 'X Thread (3 posts)',
    channel: 'x',
    format: 'text',
    slots: [
      {
        id: 'p1_hook',
        kind: 'hook',
        description: 'Scroll-stopper. ≤220 chars. No exclamation.',
        constraints: { maxChars: 220, bannedPhrases: ['!'], minTonalFit: 0.6, toneHint: 'punchy' },
      },
      {
        id: 'p2_evidence',
        kind: 'evidence',
        description: 'Cite ONE verified claim with a quote and source.',
        constraints: { maxChars: 260, requireCitation: true, toneHint: 'direct' },
      },
      {
        id: 'p3_cta',
        kind: 'cta',
        description: 'Ask a question OR plug the brand. ≤180 chars.',
        constraints: { maxChars: 180, toneHint: 'curious' },
      },
    ],
    compatibleHooks: ['challenger', 'educator', 'told_you_so', 'expert_reaction', 'meta_observer'],
  },
  {
    id: 'x-single',
    label: 'X Single Post',
    channel: 'x',
    format: 'text',
    slots: [
      {
        id: 'body',
        kind: 'body',
        description: 'Single tweet. Max 280 chars. No emoji clusters.',
        constraints: { maxChars: 280, minTonalFit: 0.6, toneHint: 'punchy' },
      },
    ],
    compatibleHooks: ['challenger', 'educator', 'comedian', 'told_you_so'],
  },

  // ─── Instagram ──────────────────────────────────────────────────────
  {
    id: 'ig-carousel-5',
    label: 'IG Carousel (5 slides)',
    channel: 'instagram',
    format: 'carousel',
    recommendedSlideCount: 5,
    slots: [
      { id: 'slide1_hook',     kind: 'hook',         description: 'Slide 1 cover line. ≤8 words.', constraints: { maxWords: 8, toneHint: 'punchy' } },
      { id: 'slide2_setup',    kind: 'body',         description: 'Slide 2: name the trend.',     constraints: { maxWords: 25 } },
      { id: 'slide3_evidence', kind: 'evidence',     description: 'Slide 3: cited stat.',         constraints: { maxWords: 30, requireCitation: true } },
      { id: 'slide4_take',     kind: 'body',         description: "Slide 4: brand's take.",       constraints: { maxWords: 30 } },
      { id: 'slide5_cta',      kind: 'cta',          description: 'Slide 5: CTA.',                constraints: { maxWords: 12 } },
      { id: 'caption',         kind: 'caption',      description: 'Post caption ≤200 chars.',     constraints: { maxChars: 200 } },
      { id: 'visual_brief',    kind: 'visual_brief', description: 'Production direction.',       constraints: {} },
    ],
    compatibleHooks: ['educator', 'expert_reaction', 'told_you_so', 'meta_observer'],
  },

  // ─── TikTok / Shorts ────────────────────────────────────────────────
  {
    id: 'tiktok-script-30s',
    label: 'TikTok Script (30s)',
    channel: 'tiktok',
    format: 'short_video',
    recommendedDurationSec: 30,
    slots: [
      { id: 'hook',         kind: 'hook',         description: 'First 3s on-screen text. ≤6 words.', constraints: { maxWords: 6, toneHint: 'punchy' } },
      { id: 'beats',        kind: 'body',         description: '4-6 beat outline (one line each).',  constraints: { maxWords: 80 } },
      { id: 'evidence',     kind: 'evidence',     description: 'On-screen stat with citation.',      constraints: { maxWords: 20, requireCitation: true } },
      { id: 'cta',          kind: 'cta',          description: 'CTA line / on-screen text.',         constraints: { maxWords: 8 } },
      { id: 'audio_brief',  kind: 'audio_brief',  description: 'Music vibe + voiceover tone.',       constraints: {} },
      { id: 'visual_brief', kind: 'visual_brief', description: 'Shot list / B-roll cues.',           constraints: {} },
    ],
    compatibleHooks: ['challenger', 'comedian', 'educator', 'told_you_so'],
  },

  // ─── LinkedIn ───────────────────────────────────────────────────────
  {
    id: 'linkedin-200w',
    label: 'LinkedIn Post (~200 words)',
    channel: 'linkedin',
    format: 'text',
    slots: [
      { id: 'hook',     kind: 'hook',     description: 'Opening line — quote or contrarian framing.', constraints: { maxWords: 25 } },
      { id: 'body',     kind: 'body',     description: 'Argument with brand-relevant context.',       constraints: { maxWords: 150 } },
      { id: 'evidence', kind: 'evidence', description: 'One cited stat or fact.',                     constraints: { requireCitation: true } },
      { id: 'cta',      kind: 'cta',      description: 'Question or invite to comment.',              constraints: { maxWords: 20 } },
    ],
    compatibleHooks: ['educator', 'expert_reaction', 'told_you_so', 'positional'],
  },
] as const;

export function templatesForChannel(channel: Template['channel']): Template[] {
  return TEMPLATES.filter(t => t.channel === channel);
}

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find(t => t.id === id);
}
