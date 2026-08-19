# TrendJack

> Real-time trend-hijacking command center for reactive marketing teams.
> TweetDeck × trading-terminal hybrid, optimized for **signal → ship in &lt;90 seconds.**

<p>
  <a href="https://github.com/<your-org>/trendjack/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/<your-org>/trendjack/ci.yml?branch=main&label=ci" /></a>
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" />
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-strict-3178c6" />
  <img alt="Next.js 15" src="https://img.shields.io/badge/next.js-15-black" />
</p>

## What it does

TrendJack ingests signals from X / Reddit / YouTube / TikTok / Instagram /
Facebook / Google Trends / News (live, free + paid sources), scores them
against your brand profile, and surfaces opportunity cards with
ready-to-edit content angles, half-life predictions, and one-keystroke
routing to Slack / Telegram / Sheets / Notion / webhooks.

| Feature | What it gives you |
|---|---|
| **9-axis scoring engine** | Virality / brand-fit / timing / first-mover / saturation / risk / cringe / format-fatigue / effort. Hard kills override the math. |
| **Live data, free** | Reddit + HackerNews + Google News RSS + Google Trends RSS + Nitter + Invidious — no API keys required. |
| **Paid options** | X v2, YouTube Data API v3, Apify scrapers — drop-in when you have credentials. |
| **AI provider abstraction** | Anthropic / OpenAI / Google / OpenRouter (recommended). Cost-aware tier routing across `cheap`/`balanced`/`premium`. |
| **Web research with citations** | Perplexity Sonar via OpenRouter (preferred), Tavily, Brave, SearXNG, DuckDuckGo. User-selectable per-request. |
| **Variant-intelligent drafts** | AI picks only the variants that fit (no memes on hard news; skip + pivot for competitor-claimed). |
| **Multi-tenant SaaS** | Users → Orgs → Brands → Boards. Per-brand voice, scoring weights, banned phrases, audience. |
| **Realtime** | SSE pub/sub. Trend changes broadcast across tabs / users instantly. |
| **Light + dark themes** | CSS-variable driven. Toggle in the topbar. |
| **AI co-pilot** | Bottom-right pill grounded on the full dashboard state. |
| **Encrypted credentials** | AES-256-GCM at rest. Per-org. Never echoed back to the browser. |

## Quick start (local)

```bash
git clone https://github.com/pova-dev/TrendJack.git
cd TrendJack
cp .env.example .env.local                 # set SESSION_SECRET (32+ chars)
npm install
DATABASE_URL="file:./dev.db" npx prisma db push
npm run dev                                 # http://localhost:3000
```

Then open `/dev/login` for a seeded demo account, or `/signup` to create your own.

**On macOS, if the app fails to start.** If you moved this folder through
AirDrop, Feishu, Slack or a zip, macOS flags every downloaded file and then
refuses to load native binaries, so Next falls back to a slow WASM compiler
and Prisma cannot open the database at all. The error reads `library load
disallowed by system policy`. One command clears it:

```bash
xattr -dr com.apple.quarantine node_modules
```

Three ways in:

1. **Sign up** — visit `/signup`, walk through `/onboard`.
2. **One-click demo** — visit `/dev/login` (disabled in production). Bootstraps `demo@pova.local` / `demo12345` with a seeded brand and 16 mock trends.
3. **API** — see [`docs/api.md`](docs/api.md).

## Deploy

### Docker (single-command self-host)

```bash
echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env
docker compose up -d --build
# → http://localhost:3000
```

Persistent SQLite is mounted on a named volume. For Postgres in prod, see
the commented service block in `docker-compose.yml`.

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2F%3Cyour-org%3E%2Ftrendjack&env=SESSION_SECRET,DATABASE_URL,OPENROUTER_API_KEY&envDescription=See%20.env.example%20for%20full%20list)

`vercel.json` ships with a `*/2 * * * *` cron pinging `/api/cron-tick`.
Set `CRON_SECRET` in the project (Vercel adds the `Authorization: Bearer …`
header automatically).

> **Note:** Vercel's serverless model can't keep a long-lived in-process
> timer. The included Vercel Cron + `/api/cron-tick` is the supported path.

### Railway / Render / Fly.io / Coolify

Use the included `Dockerfile`. Set:

| env | required | notes |
|---|---|---|
| `SESSION_SECRET` | ✓ | `openssl rand -hex 32` |
| `DATABASE_URL` | ✓ | `file:/data/dev.db` (SQLite) or `postgresql://…` |
| `TJ_CRON_TOKEN` | ✓ if external cron | bearer token for `/api/cron-tick` |
| `OPENROUTER_API_KEY` | recommended | unlocks AI features |

## Environment

The full list lives in [`.env.example`](.env.example). Highlights:

```bash
# Required
SESSION_SECRET=                             # openssl rand -hex 32
DATABASE_URL=file:./dev.db                  # or postgresql://…

# AI providers (any one is enough; OpenRouter is recommended)
OPENROUTER_API_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_API_KEY=

# Per-tier model overrides (optional)
TJ_PROVIDER_PREMIUM=anthropic
TJ_MODEL_PREMIUM=claude-sonnet-4-5
TJ_PROVIDER_BALANCED=openrouter
TJ_MODEL_BALANCED=moonshotai/kimi-k2-0905

# Web research (free fallbacks work without keys)
TAVILY_API_KEY=
BRAVE_API_KEY=

# Live data — paid official APIs
X_BEARER_TOKEN=
YOUTUBE_API_KEY=
APIFY_TOKEN=                                # for Instagram/Facebook/TikTok scrapers

# Live data — open-source frontend instances (override defaults)
NITTER_INSTANCES=https://nitter.net,https://nitter.privacydev.net
INVIDIOUS_INSTANCES=https://yewtu.be,https://invidious.fdn.fr
RSSHUB_BASE=https://rsshub.app
RSSHUB_FEEDS=/twitter/keyword/POVA,/producthunt/today

# Outbound integrations
SLACK_BOT_TOKEN=
SLACK_DEFAULT_CHANNEL=#trendjack-drafts
TRENDJACK_DEFAULT_WEBHOOK=

# Cron auth (set when running behind a public URL with /api/cron-tick exposed)
TJ_CRON_TOKEN=
```

All AI + connector keys can also be added **from the UI** at `/settings/ai`
and `/connectors` — they're stored encrypted at the org level. The env
vars are just convenient defaults for self-hosters.

## Architecture

```
[Connectors] ─┐
              │   ┌──────────────┐
              ├─▶ │ Ingest cron  │ ─▶ Scoring engine ─▶ Postgres / SQLite
              │   │  (90s tick)  │                              │
              └─┐ └──────────────┘                              ▼
                │                                            SSE pub
                ▼                                                │
          AI provider                                            ▼
       (cheap/balanced/premium)                            Browser feed
                │                                                │
                ▼                                                ▼
        Drafts • Research • Co-pilot ◀────── User actions ──────┘
```

| Layer | Path | Notes |
|---|---|---|
| **Connectors** | `lib/connectors/*` | Each implements the `Connector` interface. Free public APIs first, paid official APIs when configured, mock fixtures only as last resort. |
| **Scoring** | `lib/scoring/engine.ts` | Pure functions, no I/O. Easy to unit-test. |
| **Ingest pipeline** | `lib/ingest.ts` + `/api/cron-tick` | Dedupe by `externalId`, write a `TrendSample` time-series row on every observation. |
| **AI** | `lib/ai/provider.ts` | One API; routes to Anthropic/OpenAI/Google/OpenRouter by tier + user preference. |
| **Research** | `lib/research/index.ts` | Free-first → paid-search → AI-search-built-in (Sonar) escalation. |
| **Realtime** | `lib/realtime/bus.ts` + `/api/stream/board/[id]` | SSE. EventEmitter for single-instance, Redis-ready interface. |
| **Auth** | `lib/auth/*` | iron-session encrypted cookie + bcrypt password hash. |
| **Multi-tenant** | every Prisma query scoped via session orgId/brandId | |

## Pages

| Path | What |
|---|---|
| `/` | Dashboard — TweetDeck-style columns, drag-and-drop reorder, live updates |
| `/queue` | Trends pending action |
| `/brand` | Editable brand profile (autosave + broadcast) |
| `/scoring` | Live weight tuner with projected top-N |
| `/connectors` | Per-source provider picker + credential editor + test buttons |
| `/settings/ai` | AI provider keys + model overrides |
| `/integrations` | Telegram bots + outbound webhooks |
| `/audit` | Org audit log |
| `/dev/login` | Dev-only: one-click demo bootstrap |

## Roadmap

The roadmap is intentionally driven by GitHub issues — see the
[Phase-3 milestone](https://github.com/<your-org>/trendjack/milestones/Phase%203).
Big rocks:

- [ ] Slack 2-way (👍 reaction = approve)
- [ ] AI brand-DNA extractor (paste site URL → auto-fill brand voice)
- [ ] Performance feedback loop (log post engagement → re-tune weights)
- [ ] Approval routing rules
- [ ] Threads / Bluesky / Mastodon connectors
- [ ] Mobile PWA + push
- [ ] Stripe billing + free/pro/enterprise tiers
- [ ] Public read-only board sharing

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The codebase is built to be
extended — connectors, AI providers, scoring rules, integrations, and
column types are the bulk of the contribution surface.

## Security

Reporting vulnerabilities → [SECURITY.md](SECURITY.md).
Hardening checklist for self-hosters is also there.

## License

[MIT](LICENSE) — use it, fork it, sell a SaaS on top of it. Just don't
strip the copyright notice.

## Credits

Built on [Next.js](https://nextjs.org), [Prisma](https://prisma.io),
[Tailwind](https://tailwindcss.com), [Anthropic](https://anthropic.com),
[OpenRouter](https://openrouter.ai), [Perplexity](https://perplexity.ai/sonar),
[Nitter](https://github.com/zedeus/nitter), [Invidious](https://invidious.io),
[RSSHub](https://docs.rsshub.app), [SearXNG](https://docs.searxng.org).
