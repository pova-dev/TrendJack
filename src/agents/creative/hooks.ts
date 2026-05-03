// Hook Library — psychological angles a brand can take on a trend.
//
// Per the audit spec, drafts should be derived from one of N typed Hooks
// rather than freeform. The Filter / Resonance Agent picks the best hook
// for a given trend × brand pair; the operator can override.
//
// Adding a hook: append to HOOK_LIBRARY. The fitsBrand() predicate decides
// whether this hook is offered for a given brand at all.

import type { BrandProfile } from '@/types';
import type { Hook } from './types';

export const HOOK_LIBRARY: readonly Hook[] = [
  {
    id: 'challenger',
    label: 'The Challenger',
    angle: 'Why the brand is doing the opposite of the trend — and winning by it.',
    riskLevel: 'edgy',
    fitsBrand: (b) =>
      // Challenger fits brands with anti-cliché voice. Any voice tagged
      // "anti-cliché", "direct", "confident", or "sharp" qualifies.
      /anti-?clich|direct|confident|sharp/i.test(b.tone.voice),
  },
  {
    id: 'educator',
    label: 'The Educator',
    angle: 'The tech / mechanism / story behind the trend, explained simply.',
    riskLevel: 'safe',
    fitsBrand: () => true, // works for every brand
  },
  {
    id: 'comedian',
    label: 'The Comedian',
    angle: 'Self-aware, anti-marketing wit. Only when cringe is low.',
    riskLevel: 'edgy',
    fitsBrand: (b) =>
      // Brands that explicitly forbid lifestyle warmth or motivational
      // cliché are usually OK with self-aware humor.
      (b.tone.forbiddenStyles ?? []).some(s => /warmth|cliché|cliche/i.test(s)),
  },
  {
    id: 'expert_reaction',
    label: 'The Expert',
    angle: "Here's what we'd actually do — and why.",
    riskLevel: 'safe',
    fitsBrand: () => true,
  },
  {
    id: 'told_you_so',
    label: 'Told You So',
    angle: "The trend proves the brand's thesis from N months ago.",
    riskLevel: 'edgy',
    fitsBrand: () => true,
  },
  {
    id: 'meta_observer',
    label: 'Meta Observer',
    angle: 'Acknowledge that this conversation is happening without taking direct sides.',
    riskLevel: 'safe',
    fitsBrand: () => true,
  },
  {
    id: 'positional',
    label: 'Positional',
    angle: 'Take a defined stance that contrasts with the polarized noise.',
    riskLevel: 'spicy',
    fitsBrand: (b) => b.riskTolerance !== 'low',
  },
] as const;

/** Select the hooks compatible with a brand. Used by the Resonance Agent
 *  + the operator-facing draft variant picker. */
export function hooksForBrand(b: BrandProfile): Hook[] {
  return HOOK_LIBRARY.filter(h => h.fitsBrand(b));
}

export function getHook(id: string): Hook | undefined {
  return HOOK_LIBRARY.find(h => h.id === id);
}
