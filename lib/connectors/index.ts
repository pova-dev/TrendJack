// Connector registry. Three tiers per source:
//
//   1. OFFICIAL-PAID  — first preference when the relevant credential env
//      is present (best fidelity, supplier-backed SLAs).
//   2. OPEN-SOURCE FRONTEND  — free, no auth, public instances. Picked
//      automatically when no paid credential is set. Modes are explicit:
//      we never silently substitute.
//   3. MOCK  — fixtures that ship with the repo. Used only when neither
//      official nor OSS is available for that source.
//
// The user sees the choice in /connectors and can override per source.

import type { Connector } from './types';
import type { SourceId } from '@/types';
import { MockConnector } from './mock';
import { RedditLiveConnector } from './reddit';
import { HackerNewsConnector } from './hackernews';
import { GoogleNewsConnector } from './googlenews';
import { NitterConnector } from './nitter';
import { InvidiousConnector } from './invidious';
import { RsshubConnector } from './rsshub';
import { XOfficialConnector } from './x-official';
import { YoutubeOfficialConnector } from './youtube-official';
import { GoogleTrendsConnector } from './googletrends';

const SOURCES: SourceId[] = ['x', 'reddit', 'youtube', 'tiktok', 'instagram', 'facebook', 'google_trends', 'news', 'custom'];

interface ConnectorOption {
  /** Display label for /connectors */
  label: string;
  /** Underlying connector instance */
  conn: Connector;
  /** Quality / cost descriptor */
  badge: 'official' | 'oss' | 'mock';
  /** Required env keys for the option to actually be usable. */
  requires?: string[];
  /** Sources that strictly require user-configured feeds (no sane default
   *  fallback to mock). Used for `custom` / RSSHub-only sources. */
  configRequired?: boolean;
}

function optionsFor(source: SourceId): ConnectorOption[] {
  switch (source) {
    case 'x': return [
      { label: 'X / Twitter (official v2)',  conn: new XOfficialConnector(),  badge: 'official', requires: ['X_BEARER_TOKEN'] },
      { label: 'Nitter (open source)',        conn: new NitterConnector(),     badge: 'oss' },
      { label: 'Mock',                        conn: new MockConnector('mock_x', 'x'), badge: 'mock' },
    ];
    case 'reddit': return [
      { label: 'Reddit (public JSON)',        conn: new RedditLiveConnector(), badge: 'oss' },
      { label: 'Mock',                        conn: new MockConnector('mock_reddit', 'reddit'), badge: 'mock' },
    ];
    case 'youtube': return [
      { label: 'YouTube Data API v3',         conn: new YoutubeOfficialConnector(), badge: 'official', requires: ['YOUTUBE_API_KEY'] },
      { label: 'Invidious (open source)',     conn: new InvidiousConnector(),       badge: 'oss' },
      { label: 'Mock',                        conn: new MockConnector('mock_youtube', 'youtube'), badge: 'mock' },
    ];
    case 'tiktok': return [
      { label: 'RSSHub (open source)',        conn: new RsshubConnector(),     badge: 'oss', requires: ['RSSHUB_BASE', 'RSSHUB_FEEDS'] },
      { label: 'Mock',                        conn: new MockConnector('mock_tiktok', 'tiktok'), badge: 'mock' },
    ];
    case 'instagram': return [
      // Meta locked down public Instagram data after the Graph API
      // restrictions and CrowdTangle shutdown. There's no free official
      // route — every working option needs configuration. We never silently
      // mock for Meta sources.
      { label: 'Apify Instagram Scraper (paid)', conn: new MockConnector('apify_ig_stub', 'instagram'),    badge: 'official', requires: ['APIFY_TOKEN'], configRequired: true },
      { label: 'Instagram Graph API (own accounts only)', conn: new MockConnector('ig_graph_stub', 'instagram'), badge: 'official', requires: ['INSTAGRAM_ACCESS_TOKEN'], configRequired: true },
      { label: 'RSSHub Instagram (fragile)',     conn: new RsshubConnector(), badge: 'oss', requires: ['RSSHUB_BASE', 'RSSHUB_FEEDS'], configRequired: true },
    ];
    case 'facebook': return [
      // Same story as Instagram — CrowdTangle is dead, Graph API is owned-
      // page-only. Either pay for a scraper or scrape via RSSHub.
      { label: 'Apify Facebook Scraper (paid)',  conn: new MockConnector('apify_fb_stub', 'facebook'),    badge: 'official', requires: ['APIFY_TOKEN'], configRequired: true },
      { label: 'Facebook Graph API (own pages only)', conn: new MockConnector('fb_graph_stub', 'facebook'), badge: 'official', requires: ['FACEBOOK_ACCESS_TOKEN'], configRequired: true },
      { label: 'RSSHub Facebook page (fragile)', conn: new RsshubConnector(), badge: 'oss', requires: ['RSSHUB_BASE', 'RSSHUB_FEEDS'], configRequired: true },
    ];
    case 'google_trends': return [
      { label: 'Google Trends realtime (free)', conn: new GoogleTrendsConnector(), badge: 'oss' },
      { label: 'Mock (SerpAPI ready)',          conn: new MockConnector('mock_gt', 'google_trends'), badge: 'mock' },
    ];
    case 'news': return [
      { label: 'Google News RSS (free)',      conn: new GoogleNewsConnector(), badge: 'oss' },
      { label: 'HackerNews (Algolia, free)',  conn: new HackerNewsConnector(), badge: 'oss' },
      { label: 'Mock',                        conn: new MockConnector('mock_news', 'news'), badge: 'mock' },
    ];
    case 'custom': return [
      // Custom is your watchlist lane — by design it requires configuration.
      // We deliberately do NOT auto-fall-back to mock here.
      { label: 'RSSHub watchlist (configurable)', conn: new RsshubConnector(), badge: 'oss', requires: ['RSSHUB_BASE', 'RSSHUB_FEEDS'], configRequired: true },
    ];
  }
}

function pickActive(source: SourceId): { option: ConnectorOption | null; reason: 'env' | 'fallback' | 'unconfigured' } {
  const opts = optionsFor(source);
  // First try anything official whose env is satisfied.
  for (const o of opts) {
    if (o.badge !== 'official') continue;
    if ((o.requires ?? []).every(k => !!process.env[k])) return { option: o, reason: 'env' };
  }
  // Then OSS that doesn't require config.
  for (const o of opts) {
    if (o.badge !== 'oss') continue;
    if (!(o.requires ?? []).length) return { option: o, reason: 'env' };
  }
  // OSS requiring config (RSSHub) if env is set.
  for (const o of opts) {
    if (o.badge !== 'oss') continue;
    if ((o.requires ?? []).every(k => !!process.env[k])) return { option: o, reason: 'env' };
  }
  // If every option needs configuration we hadn't satisfied, return null —
  // the UI will surface an "unconfigured" state with a setup CTA. We do
  // NOT silently fall back to mock for these sources.
  if (opts.every(o => (o.configRequired || (o.requires?.length ?? 0) > 0))) {
    return { option: null, reason: 'unconfigured' };
  }
  // Mock as last resort for sources that have one.
  const mock = opts.find(o => o.badge === 'mock');
  return { option: mock ?? null, reason: mock ? 'fallback' : 'unconfigured' };
}

// Some sources may be intentionally unconfigured (custom RSS / TikTok-via-
// RSSHub when the user hasn't set RSSHUB_BASE). For those, getConnector
// returns null and callers (ingest, /api/connectors/test) skip them with a
// helpful "configure to enable" message instead of silently mocking.
const REGISTRY: Partial<Record<SourceId, Connector>> = {
  x:             pickActive('x').option?.conn,
  reddit:        pickActive('reddit').option?.conn,
  youtube:       pickActive('youtube').option?.conn,
  tiktok:        pickActive('tiktok').option?.conn,
  google_trends: pickActive('google_trends').option?.conn,
  news:          pickActive('news').option?.conn,
  custom:        pickActive('custom').option?.conn,
};

export function getConnector(source: SourceId): Connector | null { return REGISTRY[source] ?? null; }

export interface ConnectorOverview {
  source: SourceId;
  active:
    | { unconfigured: true; reason: string; configRequiredKeys: string[] }
    | { unconfigured?: false; id: string; mode: string; label: string; badge: 'official' | 'oss' | 'mock' };
  options: Array<{ id: string; label: string; badge: 'official' | 'oss' | 'mock'; mode: string; requires: string[]; available: boolean; configRequired?: boolean }>;
}

export function listConnectorOverview(): ConnectorOverview[] {
  return SOURCES.map(source => {
    const opts = optionsFor(source);
    const { option: active, reason } = pickActive(source);
    const configKeys = Array.from(new Set(opts.flatMap(o => o.requires ?? [])));
    return {
      source,
      active: active
        ? { id: active.conn.id, mode: active.conn.mode, label: active.label, badge: active.badge }
        : { unconfigured: true as const, reason, configRequiredKeys: configKeys },
      options: opts.map(o => ({
        id: o.conn.id,
        label: o.label,
        badge: o.badge,
        mode: o.conn.mode,
        requires: o.requires ?? [],
        available: (o.requires ?? []).every(k => !!process.env[k]) || (o.requires ?? []).length === 0,
        configRequired: o.configRequired,
      })),
    };
  });
}

// Bonus connectors — surfaced in addition to the primary registry on /connectors
export function listConnectors(): Connector[] {
  return SOURCES.map(s => REGISTRY[s]).filter((c): c is Connector => !!c);
}

export { MockConnector };
