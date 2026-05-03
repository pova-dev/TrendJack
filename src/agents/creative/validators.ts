// Slot-level validators. Run AT FILL TIME — failures are recorded on
// the FilledSlot and the TypedDraft is marked unshippable if any slot
// with requireCitation lacks a citation.

import type { FilledSlot, TemplateSlot, TypedDraft, Context } from './types';

export interface SlotValidation {
  ok: boolean;
  reason: string;
}

export function validateSlot(
  slot: TemplateSlot,
  filled: FilledSlot,
  ctx: Context,
): SlotValidation[] {
  const out: SlotValidation[] = [];
  const c = slot.constraints;

  // Citation requirement.
  if (c.requireCitation) {
    const hasCitation =
      !!filled.citedClaimId &&
      !!filled.citedSourceUrl &&
      ctx.claims.some(cl => cl.id === filled.citedClaimId);
    out.push({
      ok: hasCitation,
      reason: hasCitation
        ? `cited claim ${filled.citedClaimId}`
        : 'requireCitation but no verified claim referenced',
    });
  }

  // Forbidden-claim check — drafts must not pull from unverifiedClaims.
  for (const forbidden of ctx.forbiddenClaims) {
    if (filled.value.toLowerCase().includes(forbidden.key.toLowerCase())) {
      out.push({ ok: false, reason: `references unverified claim: ${forbidden.key}` });
    }
  }

  // Brand-banned phrases.
  const brandBanned = ctx.brand.tone.bannedPhrases ?? [];
  for (const banned of brandBanned) {
    if (filled.value.toLowerCase().includes(banned.toLowerCase())) {
      out.push({ ok: false, reason: `brand-banned phrase: "${banned}"` });
    }
  }
  // Per-slot banned phrases.
  for (const banned of c.bannedPhrases ?? []) {
    if (filled.value.includes(banned)) {
      out.push({ ok: false, reason: `slot-banned phrase: "${banned}"` });
    }
  }

  // Word / char caps.
  if (c.maxChars && filled.value.length > c.maxChars) {
    out.push({ ok: false, reason: `${filled.value.length} chars > cap ${c.maxChars}` });
  }
  if (c.maxWords) {
    const words = filled.value.trim().split(/\s+/).filter(Boolean).length;
    if (words > c.maxWords) {
      out.push({ ok: false, reason: `${words} words > cap ${c.maxWords}` });
    }
  }

  return out;
}

/** Aggregate slot validations into a TypedDraft's `validation` + `isShippable`. */
export function finalizeDraft(
  draft: Omit<TypedDraft, 'validation' | 'isShippable' | 'totalWordCount' | 'hasUnresolvedCitations'>,
  ctx: Context,
  templateSlots: TemplateSlot[],
): TypedDraft {
  const validation: TypedDraft['validation'] = [];
  let allOk = true;
  let hasUnresolvedCitations = false;

  for (const slot of templateSlots) {
    const filled = draft.slots.find(f => f.slotId === slot.id);
    if (!filled) {
      validation.push({ slotId: slot.id, ok: false, reason: 'missing slot value' });
      allOk = false;
      continue;
    }
    for (const v of validateSlot(slot, filled, ctx)) {
      validation.push({ slotId: slot.id, ...v });
      if (!v.ok) allOk = false;
      if (slot.constraints.requireCitation && !v.ok) hasUnresolvedCitations = true;
    }
  }

  const totalWordCount = draft.slots.reduce(
    (n, f) => n + f.value.trim().split(/\s+/).filter(Boolean).length, 0,
  );

  return {
    ...draft,
    validation,
    isShippable: allOk,
    totalWordCount,
    hasUnresolvedCitations,
  };
}
