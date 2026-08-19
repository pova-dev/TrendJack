// DALL-E 3 image adapter for the media router.
//
// Audit 2026-05-29 U4 — the media router had zero registered adapters,
// so `routeMediaJob()` always returned `no_adapter_available`. This is the
// first real adapter; it activates whenever OPENAI_API_KEY is configured.
//
// Pricing reference (2026): DALL-E 3 standard quality ~$0.040 per 1024×1024
// image; HD quality ~$0.080. The router uses estCostUsd for budget gating.

import type { MediaAdapter, MediaJob, MediaResult } from '../router';

const SIZE_FOR_AR: Record<string, '1024x1024' | '1792x1024' | '1024x1792'> = {
  '1:1':  '1024x1024',
  '16:9': '1792x1024',
  '9:16': '1024x1792',
  '4:5':  '1024x1024', // closest supported; DALL-E 3 doesn't natively do 4:5
};

export function makeOpenAiImageAdapter(): MediaAdapter {
  return {
    id: 'dall-e-3',
    kind: 'image',
    quality: 'social',
    estCostUsd: 0.04,
    available: () => !!process.env.OPENAI_API_KEY,
    async generate(job: MediaJob): Promise<MediaResult> {
      const key = process.env.OPENAI_API_KEY;
      if (!key) return { ok: false, reason: 'OPENAI_API_KEY missing', provider: 'dall-e-3' };

      const size = SIZE_FOR_AR[job.aspectRatio ?? '1:1'] ?? '1024x1024';
      const prompt = job.brandExamples?.length
        ? `${job.prompt}\n\nStyle reference: ${job.brandExamples.join(' · ')}`
        : job.prompt;

      try {
        const res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${key}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'dall-e-3',
            prompt: prompt.slice(0, 4000), // DALL-E 3 prompt cap
            n: 1,
            size,
            quality: job.quality === 'broadcast' ? 'hd' : 'standard',
            response_format: 'url',
          }),
          signal: AbortSignal.timeout(60_000),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          return { ok: false, provider: 'dall-e-3', reason: `http_${res.status}: ${text.slice(0, 200)}` };
        }

        const json = await res.json() as { data?: Array<{ url?: string }> };
        const url = json.data?.[0]?.url;
        if (!url) return { ok: false, provider: 'dall-e-3', reason: 'no_url_in_response' };

        return {
          ok: true,
          url,
          provider: 'dall-e-3',
          model: 'dall-e-3',
          costUsd: job.quality === 'broadcast' ? 0.08 : 0.04,
        };
      } catch (e) {
        return { ok: false, provider: 'dall-e-3', reason: (e as Error).message };
      }
    },
  };
}
