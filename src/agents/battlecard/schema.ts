// BattleCard JSON shape — what the LLM emits and what the dashboard
// renders. Pinned here as the canonical source of truth so the prompt,
// the parser, and the UI all reference the same type.

export type BattleCardVerdict = 'counter' | 'ignore' | 'out-flank' | 'monitor';

export interface BattleCardAngle {
  /** Short angle name — operator scans this list and picks one. */
  angle: string;
  /** Why this angle works against the competitor's claim — must
   *  reference the trend's lineage / examples / brand voice. */
  rationale: string;
  /** One-line example hook the operator could ship. ≤80 chars so it
   *  reads as a hook, not a full draft. */
  exampleHook: string;
}

export interface BattleCard {
  trendId: string;
  brandId: string;
  /** Top-line strategic call. */
  verdict: BattleCardVerdict;
  /** ≤200 chars rationale for the verdict. The pill the operator will
   *  remember after closing the drawer. */
  verdictReason: string;
  /** Saturation score from the underlying ScoreResult — copied so the
   *  card is self-contained for export/audit. */
  saturationScore: number;
  /** Competitor names that triggered this card, copied from the
   *  triggering signal. */
  competitorClaimants: string[];
  /** 2–4 distinct angle options. Empty when verdict is `ignore`. */
  angleOptions: BattleCardAngle[];
  /** Single positioning sentence — what the brand stands for that the
   *  competitor's claim can't replicate. Null when verdict isn't
   *  `counter` or `out-flank`. */
  counterClaim: string | null;
  /** 2–4 banned moves: hooks/styles/comparisons that would backfire
   *  given the competitor's positioning. */
  doNotDo: string[];
  generatedAt: Date;
  provider: string;
  model: string;
}

/** Strict-ish runtime validator. Returns null when the LLM output
 *  doesn't match the contract — caller falls back to a conservative
 *  monitor-verdict card so the UI never crashes on malformed JSON. */
export function validateBattleCard(raw: unknown, ctx: { trendId: string; brandId: string }): BattleCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const verdict = r.verdict;
  if (verdict !== 'counter' && verdict !== 'ignore' && verdict !== 'out-flank' && verdict !== 'monitor') return null;
  const verdictReason = typeof r.verdictReason === 'string' ? r.verdictReason.slice(0, 200) : '';
  const angleOptions: BattleCardAngle[] = Array.isArray(r.angleOptions)
    ? (r.angleOptions as Record<string, unknown>[])
        .filter(a => typeof a.angle === 'string' && typeof a.rationale === 'string')
        .slice(0, 4)
        .map(a => ({
          angle: String(a.angle).slice(0, 80),
          rationale: String(a.rationale).slice(0, 400),
          exampleHook: typeof a.exampleHook === 'string' ? a.exampleHook.slice(0, 100) : '',
        }))
    : [];
  const counterClaim = typeof r.counterClaim === 'string' ? r.counterClaim.slice(0, 200) : null;
  const doNotDo = Array.isArray(r.doNotDo)
    ? (r.doNotDo as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 6)
    : [];
  const competitorClaimants = Array.isArray(r.competitorClaimants)
    ? (r.competitorClaimants as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  return {
    trendId: ctx.trendId,
    brandId: ctx.brandId,
    verdict,
    verdictReason,
    saturationScore: typeof r.saturationScore === 'number' ? r.saturationScore : 0,
    competitorClaimants,
    angleOptions,
    counterClaim,
    doNotDo,
    generatedAt: new Date(),
    provider: typeof r.provider === 'string' ? r.provider : 'unknown',
    model: typeof r.model === 'string' ? r.model : 'unknown',
  };
}
