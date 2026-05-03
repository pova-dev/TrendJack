# Contributing to TrendJack

Thanks for your interest. This project is built to be extended — adding new
connectors, scoring rules, integrations, and UI pieces is the bulk of the
expected contribution surface.

## Quick start

```bash
git clone https://github.com/<you>/trendjack
cd trendjack
cp .env.example .env.local                  # set SESSION_SECRET (32+ chars)
npm install
DATABASE_URL="file:./dev.db" npx prisma db push
npm run dev                                  # → http://localhost:3000
```

One-click bootstrap with a demo account: visit `http://localhost:3000/dev/login`.

## How to ship a change

1. **Fork + branch** — branch from `main`, name it `<area>/<short-desc>` (e.g. `connector/threads`, `ui/light-mode-fix`).
2. **Keep changes scoped** — one feature or one fix per PR. Refactors that change unrelated files belong in their own PR.
3. **Run the local checks** before pushing:
   ```bash
   npx tsc --noEmit          # type-check
   npm run build             # produces .next/standalone — must succeed
   ```
4. **Update docs if you changed behavior** — README, the inline doc-comments, or the relevant page in `/docs`.
5. **Open a PR** with:
   - what changed (1-3 bullets)
   - why
   - screenshots / `curl` output for UI / API changes
   - any env-var additions
6. **CI must be green** — see `.github/workflows/ci.yml`. Type-check, build, and Docker image build all run.

## Areas that are welcoming PRs

| Area | Where to start |
|---|---|
| New connector (e.g. Threads, Bluesky, Mastodon) | `lib/connectors/` — implement the `Connector` interface; add to the registry in `lib/connectors/index.ts`. |
| Scoring tweaks | `lib/scoring/engine.ts` — pure functions, easy to unit-test. Open a PR with before/after samples. |
| AI provider | `lib/ai/provider.ts` — add a `callX()` function + extend `pickRouting`. |
| Research backends | `lib/research/index.ts` — add a `xSearch(query, key)` function + plumb into `searchPaid` / `searchFree`. |
| Integration push (Slack 2-way, Linear, Notion) | `lib/integrations/` + `app/api/integrations/[type]/route.ts`. |
| Column types | Extend `ColumnType` in `types/index.ts` + add filter logic in `lib/columns.ts` + register in `components/board/ColumnBuilder.tsx`. |

## Style + conventions

- **TypeScript strict on** — no `any` unless commented-out as `unknown` and narrowed.
- **Server-only modules** — anything that imports `prisma`, `@/lib/auth`, or `process.env` must `import 'server-only'` or live under `app/api/`.
- **Tailwind** — color tokens via `ink-*` (theme-aware via CSS vars), brand orange via `flare-*`, status via `signal-{green,amber,red,blue,violet}`. Don't hardcode hex.
- **No silent mock substitution** — connectors must explicitly return `{ ok: false, reason }` when they fail. Mock fallback is allowed only when no live option is available for that source AND that's surfaced in the UI.
- **Comments earn their keep** — use them for *why*, not *what*. Don't restate the code.

## Architecture cheatsheet

```
Connectors → ingest → Scoring engine → Postgres/SQLite
                                          │
                                          ▼
                               AI triage / generate
                                          │
                                          ▼
                               Trends → SSE → Browser
```

- **Multi-tenant**: every query is scoped via the user's session orgId/brandId.
- **Realtime**: SSE bus (`lib/realtime/bus.ts`) — single-process EventEmitter for dev; swap to Redis pub/sub for multi-replica.
- **Credentials**: AES-256-GCM encrypted at rest in the `Credential` model. Never echoed back to the browser unmasked.
- **Cost-aware AI**: `lib/ai/provider.ts` routes by tier (`cheap` | `balanced` | `premium`) across Anthropic / OpenAI / Google / OpenRouter.

## Reporting bugs

Use the issue templates at `.github/ISSUE_TEMPLATE/`. Include:
- The page/route that broke
- A `curl` reproduction if it's an API issue
- Browser console log + the `[CLIENT ERROR]` lines from the server log

## Code of conduct

By participating you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).
