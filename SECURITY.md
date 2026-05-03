# Security policy

## Reporting a vulnerability

**Do not file public GitHub issues for security problems.** Email the maintainers
at `security@trendjack.dev` (or open a private security advisory via GitHub's
*Report a vulnerability* button on the repo's Security tab).

You'll get an acknowledgement within 48 hours. We aim to ship fixes within 7
days for high-severity issues, 30 days for medium, 90 days for low.

## What we consider in-scope

- Auth / session escape (forging a session for another user/org)
- Tenant isolation breaks (reading or mutating another org's data)
- Secret leaks (credentials returned to the browser unmasked, logs)
- Server-side request forgery via connector / research backends
- Stored XSS via brand profile fields, draft text, trend titles
- SQL injection (Prisma protects most of this, but worth flagging)
- Webhook/Telegram dispatch sending data to the wrong endpoint

## Out-of-scope (or low priority)

- Exhausting AI provider quota by spamming the co-pilot — rate-limit your own deployment.
- Broken `mock` fixtures — the mock is for local dev only.
- Hardcoded `dev-only-insecure-secret-please-change-…` — this string is checked into the repo on purpose so a freshly cloned repo runs; production deployments **must** override `SESSION_SECRET` (the README + `.env.example` say so).

## Hardening checklist for self-hosters

- [ ] Set `SESSION_SECRET` to a 32+ random hex (`openssl rand -hex 32`)
- [ ] Use Postgres in prod (SQLite is fine for ≤10 users)
- [ ] Run behind HTTPS — iron-session cookies are set `secure` in production
- [ ] Set `TJ_CRON_TOKEN` and use it (don't leave `/api/cron-tick` open)
- [ ] Audit `OPENROUTER_API_KEY` / other AI keys spend-limits in their consoles
- [ ] Webhook secret rotation — TrendJack signs with HMAC-SHA256 per webhook
