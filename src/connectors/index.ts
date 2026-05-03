// Connector bootstrap — imports every src/connectors/* module so their
// register() side-effects fire. Also adapts the legacy class-based
// connectors (lib/connectors/*) into the new registry via registerClassic().
//
// Importing this module once at process boot ensures the registry is
// fully populated before the first Scout tick.

import { registerClassic } from '@/src/core/connectors/registry';

// Phase-9 native connectors (registered via the ≤10-LoC pattern).
import './google-alerts';

// Legacy class-based connectors — adapted to the registry shape so the
// Scout / Architect see them all through one interface. Removing any of
// these is a one-line change.
import { RedditLiveConnector } from '@/lib/connectors/reddit';
import { HackerNewsConnector } from '@/lib/connectors/hackernews';
import { GoogleNewsConnector } from '@/lib/connectors/googlenews';
import { NitterConnector } from '@/lib/connectors/nitter';
import { InvidiousConnector } from '@/lib/connectors/invidious';
import { RsshubConnector } from '@/lib/connectors/rsshub';
import { GoogleTrendsConnector } from '@/lib/connectors/googletrends';
import { XOfficialConnector } from '@/lib/connectors/x-official';
import { YoutubeOfficialConnector } from '@/lib/connectors/youtube-official';

let bootstrapped = false;

/** Idempotent bootstrap. Safe to call multiple times — register() replaces
 *  prior entries with the same id. */
export function bootstrapConnectors(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  registerClassic(new RedditLiveConnector(),     { cadenceSec: 90 });
  registerClassic(new HackerNewsConnector(),     { cadenceSec: 90 });
  registerClassic(new GoogleNewsConnector(),     { cadenceSec: 120 });
  registerClassic(new NitterConnector(),         { cadenceSec: 180 });
  registerClassic(new InvidiousConnector(),      { cadenceSec: 600 }); // dying network — back off hard
  registerClassic(new RsshubConnector(),         { cadenceSec: 300 });
  registerClassic(new GoogleTrendsConnector(),   { cadenceSec: 600 });
  registerClassic(new XOfficialConnector(),      { cadenceSec: 60 });  // X v2 → real-time-ish
  registerClassic(new YoutubeOfficialConnector(),{ cadenceSec: 300 });
  // google_alerts already registered via top-of-file `import './google-alerts'`.
}

export { listRegistered, getRegistered } from '@/src/core/connectors/registry';
