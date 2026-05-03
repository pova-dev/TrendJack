// X / Twitter live connector skeleton. Wires up against the v2 API or any
// pluggable scraper. For now it throws unless env is set, and the caller
// (see lib/connectors/index.ts) chooses MockConnector by default.

import type { Connector, ConnectorPollOpts, ConnectorResult } from './types';

export class XConnector implements Connector {
  id = 'x_live';
  source = 'x' as const;
  mode = 'live' as const;

  async poll(_opts: ConnectorPollOpts): Promise<ConnectorResult> {
    const token = process.env.X_BEARER_TOKEN;
    if (!token) {
      return { ok: false, source: 'x', mode: 'live', reason: 'X_BEARER_TOKEN not set' };
    }
    // Implement: GET /2/tweets/search/recent or trends endpoint, normalize to
    // RawSignal[]. Out-of-scope for MVP. Phase 2 fills this.
    return { ok: false, source: 'x', mode: 'live', reason: 'live_not_implemented' };
  }
}
