// Multi-model media router (Higgsfield-style).
//
// Composer says WHAT (typed MediaJob); router decides HOW (which model,
// which provider, which fallback). Mirrors the existing AI provider
// router (lib/ai/provider.ts) but for image / video / audio / avatar
// outputs. Cost / quality / speed tradeoffs are picked per-job.
//
// Today this is interface + stub. Production wiring in Phase 8+ adds
// adapters for: Veo, Sora, Kling, Runway, Luma, Lyria, Suno, Udio,
// ElevenLabs, Flux Pro, SDXL, DALL-E 3, Midjourney, HeyGen, Synthesia.

export type MediaKind = 'image' | 'video' | 'audio' | 'avatar';
export type Quality = 'draft' | 'social' | 'broadcast';

export interface MediaJob {
  kind: MediaKind;
  /** Operator-supplied prompt + style direction. */
  prompt: string;
  /** Aspect ratio preference — '9:16' for shorts, '1:1' for IG, '16:9' for YT. */
  aspectRatio?: '1:1' | '9:16' | '16:9' | '4:5';
  /** Duration cap in seconds (video / audio). */
  durationSec?: number;
  /** Quality tier — drives model selection. */
  quality?: Quality;
  /** Optional brand examples for style matching. */
  brandExamples?: string[];
  /** Cost cap for this job in USD. Router refuses if estimated cost exceeds. */
  budgetUsd?: number;
}

export interface MediaResult {
  ok: boolean;
  url?: string;
  /** Provider that fulfilled the job. */
  provider?: string;
  model?: string;
  costUsd?: number;
  /** Failure reason when ok=false. */
  reason?: string;
}

export interface MediaAdapter {
  /** Stable identifier for this adapter (e.g. 'veo-3', 'kling-1.6'). */
  id: string;
  kind: MediaKind;
  quality: Quality;
  /** Approximate cost per job. Router uses for budget gating. */
  estCostUsd: number;
  /** Whether this adapter is available right now (env vars present, etc.). */
  available: () => boolean;
  /** Run the job. */
  generate: (job: MediaJob) => Promise<MediaResult>;
}

const ADAPTERS: MediaAdapter[] = [];

export function registerAdapter(a: MediaAdapter): void {
  // Idempotent — replace if same id.
  const idx = ADAPTERS.findIndex(x => x.id === a.id);
  if (idx >= 0) ADAPTERS[idx] = a;
  else ADAPTERS.push(a);
}

export function listAdapters(): MediaAdapter[] {
  return [...ADAPTERS];
}

/**
 * Route a job to the best adapter available. Order:
 *   1. Filter to adapters matching kind + quality + available()
 *   2. Drop adapters whose estCostUsd exceeds job budget
 *   3. Sort by quality (broadcast > social > draft) then by est cost ASC
 *   4. Try in order; fall back on failure
 *
 * Returns the FIRST successful MediaResult or the LAST failure if all fail.
 */
export async function routeMediaJob(job: MediaJob): Promise<MediaResult> {
  const candidates = ADAPTERS
    .filter(a => a.kind === job.kind)
    .filter(a => !job.quality || qualityRank(a.quality) >= qualityRank(job.quality))
    .filter(a => a.available())
    .filter(a => !job.budgetUsd || a.estCostUsd <= job.budgetUsd)
    .sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality) || a.estCostUsd - b.estCostUsd);

  if (candidates.length === 0) {
    return { ok: false, reason: 'no_adapter_available' };
  }

  let lastFailure: MediaResult = { ok: false, reason: 'no_adapter_succeeded' };
  for (const adapter of candidates) {
    try {
      const result = await adapter.generate(job);
      if (result.ok) return { ...result, provider: result.provider ?? adapter.id };
      lastFailure = { ...result, provider: result.provider ?? adapter.id };
    } catch (err) {
      lastFailure = {
        ok: false,
        provider: adapter.id,
        reason: (err as Error).message,
      };
    }
  }
  return lastFailure;
}

function qualityRank(q: Quality): number {
  return { draft: 0, social: 1, broadcast: 2 }[q];
}
