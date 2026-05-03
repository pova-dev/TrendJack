# Changelog

All notable changes to TrendJack are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Light mode toggle** in the topbar — cycles Light → Dark → System.
  CSS variables drive the ink palette so theme flips have no recompile.
  No-FOUC inline script in `app/layout.tsx` applies the resolved theme
  before paint.
- **Open-source release pack** — `LICENSE` (MIT), `Dockerfile`, `docker-compose.yml`,
  `vercel.json` with cron, `/api/health` + `/api/cron-tick` endpoints,
  GitHub Actions CI, issue + PR templates, `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, this changelog.
- **Per-source link fallback** — every trend card now shows an `↗`
  (or `Search ↗`) link, even when the connector didn't include a
  canonical URL. Falls back to a per-platform search query.
- **Faster ingest cadence** — cron tick from 5 min → 90 s. Fresh trends
  surface within ~2 min of being ingested.
- **NEW / UPDATED freshness chips** on cards — visible for 10 min after
  ingest, so it's obvious when something changed.

### Changed
- `next.config.js` — `output: 'standalone'` is enabled in production
  builds (and when `BUILD_STANDALONE=1`) so Docker images stay small.

### Fixed
- "Generate anyway" button no longer crashes — was passing the React
  `SyntheticEvent` as the `replace` flag → JSON.stringify circular ref.

## [0.4.0] — 2026-04-29

### Added
- **AI provider abstraction** with cost-aware tier routing (cheap /
  balanced / premium) across Anthropic, OpenAI, Google, OpenRouter.
- **Encrypted org-level credentials** (AES-256-GCM) — managed via
  `/settings/ai` and `/connectors`.
- **Live web research** — Perplexity Sonar via OpenRouter (preferred),
  Tavily, Brave, SearXNG, DuckDuckGo (free fallback). User-selectable
  backend per request.
- **Live connectors** — Reddit (public JSON), HackerNews (Algolia),
  Google News RSS, Google Trends real-time RSS, Nitter, Invidious,
  RSSHub, plus official paid options for X v2 and YouTube Data API v3.
- **Variant-intelligent draft generation** — the AI now picks only the
  variants that fit the trend (skips meme on hard news, skip-with-pivot
  for competitor-claimed, etc.).
- **Time-series trend history** with sparkline in the detail drawer.
- **Telegram bot integration** + outbound webhooks (HMAC-signed).
- **Drag-and-drop column reorder** + custom column builder.
- **AI co-pilot** grounded on the full dashboard state.

### Changed
- Multi-tenant rewrite — Users, Organizations, Memberships, multiple
  Brands per org with independent voice and scoring weights.
- Realtime via SSE pub/sub (single-process EventEmitter for dev,
  Redis-ready abstraction for prod).
