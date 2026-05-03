import type { SourceId, ConnectorMode } from '@/types';
import type { RawSignal } from '@/lib/scoring/engine';

export interface ConnectorPollOpts {
  since?: Date;
  limit?: number;
  /** Specific product / brand search terms — drive primary fan-out queries.
   *  Example for POVA: "pova", "tecno pova", "pova curve", "pova 7". */
  brandKeywords?: string[];
  /** Competitors — used as additional query fan-out and for "competitor
   *  claimed this trend" tagging. */
  competitors?: string[];
  /** Broader themes — used for secondary query fan-out and as fallback
   *  signal anchors when brand keywords don't match. Example: "gaming
   *  phone", "battery life", "thermal performance". */
  themes?: string[];
  /**
   * Optional geography override. ISO country code (US, IN, GB), Google's
   * state code (US-NY, IN-MH), or US DMA code for city-level. Connectors
   * decide what they support; unsupported values are ignored.
   */
  geo?: string;
  /**
   * When true, the connector should emit signals even if they don't match
   * the brand keyword filters. Useful for "browse all trending" columns
   * (Google Trends in particular). Engine still scores them — low brandFit
   * trends sort down naturally.
   */
  emitAll?: boolean;
  /**
   * Org-level credential bag. Connectors should prefer this over process.env
   * so each tenant can supply their own API keys via the UI.
   */
  credentials?: Record<string, string>;
}

export interface ConnectorOk {
  ok: true;
  source: SourceId;
  mode: ConnectorMode;
  signals: RawSignal[];
  fetchedAt: Date;
}

export interface ConnectorErr {
  ok: false;
  source: SourceId;
  mode: ConnectorMode;
  reason: string;
}

export type ConnectorResult = ConnectorOk | ConnectorErr;

export interface Connector {
  id: string;
  source: SourceId;
  mode: ConnectorMode;
  poll(opts: ConnectorPollOpts): Promise<ConnectorResult>;
}
