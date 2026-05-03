// Battle-Card generator — produces a strategic verdict + angle options
// for a competitor-claimed trend via the premium AI tier.
//
// Cost gating: caller is responsible for the saturation > 0.6 short-
// circuit (see index.ts). This module always calls the LLM when invoked.
//
// Model routing goes through lib/ai/provider.runChat — same plumbing
// as draft-gen and the Verifier. The orgId is forwarded so the call
// counts against the org's daily budget.

import 'server-only';
import { runChat } from '@/lib/ai/provider';
import type { OrgCredentials } from '@/lib/credentials';
import type { BrandProfile } from '@/types';
import type { RawSignal, ScoreResult } from '@/src/core/scoring/types';
import { BATTLE_CARD_SYSTEM_PROMPT, PROMPT_VERSION } from './prompts.v1';
import { validateBattleCard, type BattleCard } from './schema';

export interface BattleCardGenInput {
  signal: RawSignal;
  scoreResult: ScoreResult;
  brand: BrandProfile;
  brandId: string;
  orgId?: string;
  credentials?: OrgCredentials;
}

export interface BattleCardGenOk {
  ok: true;
  card: BattleCard;
  promptVersion: string;
  costUsd: number;
}
export interface BattleCardGenErr { ok: false; error: string }
export type BattleCardGenResult = BattleCardGenOk | BattleCardGenErr;

export async function generateBattleCard(input: BattleCardGenInput): Promise<BattleCardGenResult> {
  const { signal, scoreResult, brand, brandId, orgId, credentials } = input;

  const userPayload = `BRAND PROFILE
${JSON.stringify({
  name: brand.name,
  category: brand.category,
  voice: brand.tone.voice,
  forbiddenStyles: brand.tone.forbiddenStyles,
  bannedTopics: brand.bannedTopics,
  safeThemes: brand.safeThemes,
  competitors: brand.competitors,
  audience: brand.audience,
  riskTolerance: brand.riskTolerance,
}, null, 2)}

TREND
title: ${signal.title}
summary: ${signal.summary}
lineage: ${signal.lineage}
${signal.catalyst ? `catalyst: ${signal.catalyst}\n` : ''}competitorClaimants: ${signal.competitorClaimants.join(', ') || '(none — but check why this triggered)'}
saturation: ${scoreResult.scores.saturation.toFixed(2)}
brandFit: ${scoreResult.scores.brandFit.toFixed(2)}
risk: ${scoreResult.scores.risk.toFixed(2)}
${(signal.examples ?? []).slice(0, 3).map(e => `example (${e.author}): ${e.text}`).join('\n')}

Produce the battle-card now. STRICT JSON only.`;

  const ai = await runChat({
    tier: 'premium',
    system: BATTLE_CARD_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPayload }],
    maxTokens: 1500,
    temperature: 0.4,  // strategic verdict — moderate temp; not factual extraction
    jsonMode: true,
    credentials,
    orgId,
  });

  if (!ai.ok) {
    return { ok: false, error: ai.error };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(ai.text);
  } catch {
    return { ok: false, error: 'non_json_output' };
  }
  // Inject provider/model into the parsed output before validation so
  // they end up on the persisted card.
  if (parsed && typeof parsed === 'object') {
    (parsed as Record<string, unknown>).provider = ai.provider;
    (parsed as Record<string, unknown>).model = ai.model;
  }
  const card = validateBattleCard(parsed, { trendId: signal.externalId ?? '', brandId });
  if (!card) {
    return { ok: false, error: 'invalid_battle_card_shape' };
  }
  // Saturation comes from the score result — we don't trust the LLM
  // to copy it correctly even though the prompt asks.
  card.saturationScore = scoreResult.scores.saturation;
  card.competitorClaimants = signal.competitorClaimants;

  // Cost: the runChat budget tracker already recorded it; we read it
  // back out for the row's cost column. Approximate from token counts.
  const costUsd = estimateCost(ai.model, ai.inputTokens, ai.outputTokens);

  return { ok: true, card, promptVersion: PROMPT_VERSION, costUsd };
}

// Light copy of the rate table from lib/ai/budget.ts — kept local so
// changing the budget rates doesn't have to be a battlecard import.
function estimateCost(model: string, inputTokens?: number, outputTokens?: number): number {
  if (!inputTokens && !outputTokens) return 0;
  const RATES: Record<string, [number, number]> = {
    'claude-sonnet-4-5':                     [3.0,  15.0],
    'gpt-4o':                                [2.5,  10.0],
    'gemini-2.5-pro':                        [1.25, 10.0],
    'anthropic/claude-sonnet-4-5':           [3.0,  15.0],
  };
  const r = RATES[model] ?? [3.0, 15.0]; // conservative
  return ((inputTokens ?? 0) * r[0] + (outputTokens ?? 0) * r[1]) / 1_000_000;
}
