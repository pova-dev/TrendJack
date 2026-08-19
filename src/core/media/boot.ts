// Boot-time adapter registration for the media router.
//
// Audit 2026-05-29 U4 — the router was useless without registered
// adapters. Import this module once at server startup (via the dashboard
// layout's side-effects, just like lib/cron) and the OpenAI image adapter
// activates automatically when OPENAI_API_KEY is present.
//
// Future adapters (Higgsfield video, Veo, Sora, Kling, ElevenLabs) plug
// into this same boot path — add another `registerAdapter(...)` line.

import 'server-only';
import { registerAdapter } from './router';
import { makeOpenAiImageAdapter } from './adapters/openai-image';

declare global {
  // eslint-disable-next-line no-var
  var __tj_media_booted: boolean | undefined;
}

export function bootMediaAdapters(): void {
  if (global.__tj_media_booted) return;
  global.__tj_media_booted = true;

  registerAdapter(makeOpenAiImageAdapter());
  // Add new adapters here as they land:
  //   registerAdapter(makeHiggsfieldVideoAdapter());
  //   registerAdapter(makeVeoAdapter());
  //   registerAdapter(makeElevenLabsAdapter());
}
