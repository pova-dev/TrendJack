// Creative Agent — composes TypedDraft from Template + Hook + Context.
//
// Public API:
//   - HOOK_LIBRARY, hooksForBrand(), getHook()
//   - TEMPLATES, templatesForChannel(), getTemplate()
//   - validateSlot, finalizeDraft
//   - selectVariants(brand, scoreResult) — picks (template, hook) pairs to draft
//
// The agent itself (bus subscriber) is wired in Phase 8 (Architect).
// For now, callers compose drafts via one-shot helpers.

import type { ScoreResult } from '@/src/core/scoring';
import type { BrandProfile } from '@/types';
import { HOOK_LIBRARY, hooksForBrand } from './hooks';
import { TEMPLATES } from './templates';
import type { Hook, Template } from './types';
export type { Channel, Hook, HookId, Template, TemplateSlot, SlotKind, Context, FilledSlot, TypedDraft, SlotConstraint } from './types';
export { HOOK_LIBRARY, hooksForBrand, getHook } from './hooks';
export { TEMPLATES, templatesForChannel, getTemplate } from './templates';
export { validateSlot, finalizeDraft } from './validators';

/**
 * Pick the (template, hook) variants the Creative Agent should generate
 * for this trend × brand pair. Default policy:
 *   - For POST_NOW: 3 variants (high diversity)
 *   - For PREP_1H: 2 variants
 *   - For SAFE_PIVOT: 1 variant — meta_observer or positional only
 *   - Anything else: 0 variants (no auto-generation)
 *
 * Channel preference comes from brand.priorityPlatforms; falls back to X.
 */
export function selectVariants(
  brand: BrandProfile,
  scoreResult: ScoreResult,
): Array<{ template: Template; hook: Hook }> {
  const rec = scoreResult.recommendation;
  const targetCount =
    rec === 'POST_NOW'   ? 3 :
    rec === 'PREP_1H'    ? 2 :
    rec === 'SAFE_PIVOT' ? 1 :
    0;
  if (targetCount === 0) return [];

  const eligibleHooks = hooksForBrand(brand);
  const channels = (brand.priorityPlatforms?.length ? brand.priorityPlatforms : ['x']) as string[];
  const eligibleTemplates = TEMPLATES.filter(t => channels.includes(t.channel));

  const out: Array<{ template: Template; hook: Hook }> = [];
  // SAFE_PIVOT: lock to meta_observer / positional.
  if (rec === 'SAFE_PIVOT') {
    const safeHooks = eligibleHooks.filter(h => h.id === 'meta_observer' || h.id === 'positional');
    const hook = safeHooks[0] ?? HOOK_LIBRARY.find(h => h.id === 'meta_observer')!;
    const template = eligibleTemplates[0];
    if (template) out.push({ template, hook });
    return out;
  }

  // Otherwise: pick distinct (template, hook) pairs across channels first,
  // then varying hooks within the top channel.
  const seen = new Set<string>();
  for (const t of eligibleTemplates) {
    for (const h of eligibleHooks) {
      if (!t.compatibleHooks.includes(h.id)) continue;
      const key = `${t.id}:${h.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ template: t, hook: h });
      if (out.length >= targetCount) return out;
    }
  }
  return out;
}
