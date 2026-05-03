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
  /**
   * Sub-locality slug for connectors that support city/region drilldown
   * (e.g. trends24's `/india/mumbai/` path). Lowercase, dash-separated
   * to match the underlying URL scheme. Connectors that don't support
   * sub-localities ignore this field.
   */
  geoSubregion?: string;
  /**
   * competitorName → Facebook Page ID map. Used by the Meta Ad Library
   * connector to construct accurate `view_all_page_id` deep-links
   * instead of keyword search. Empty entries fall back to keyword
   * search with a "search-fallback" tag in the lineage.
   */
  competitorPageIds?: Record<string, string>;
  /**
   * Google Trends category filter. When supplied, the GoogleTrendsConnector
   * fans out one fetch per category and tags each emitted signal with its
   * category in the lineage string (`[cat:<id>]`). Other connectors ignore
   * this field.
   *
   * Recognized ids on the legacy /trending/rss endpoint are limited:
   *   ''  | 'all'  → top stories (default)
   *   't'         → sports
   *   'b'         → business
   *   'e'         → entertainment
   *   'm'         → sci/tech
   *   'h'         → health
   * Any other id is sent through but Google Trends will fall back to "all".
   */
  gtrendsCategories?: string[];
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
