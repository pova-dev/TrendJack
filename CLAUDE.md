# CLAUDE.md — TrendJack agent guide

This file is the rulebook for any Claude session working in this codebase.
Read it on first invocation; the conventions here are non-negotiable.

---

## What this product is

**TrendJack** is a real-time trend-jacking command center for marketing
operators. It ingests signals from social/news platforms, scores them
against a brand profile, and surfaces actionable trends with optional
auto-generated drafts.

The product is **multi-tenant by design**: each org has multiple users
and one or more brands; ingestion + scoring + drafts are scoped per
brand.

---

## Architecture

The codebase is in the middle of an agentic refactor (Phases 0–11). The
target architecture is five agents over a typed bus:

```
Scout(per-source)  → STREAMS.rawSignals      → Filter
                                             → Verifier (when CVS ≥ 0.70)
                                             → Creative (Template-Hook-Context)
                                             → Architect (orchestration / DLQ / budget)
Lineage Agent      → STREAMS.lineage          → Filter (saturation input)
Resonance Agent    → STREAMS.resonance        → Creative (why-now string)
Cringe-Decay Agent → STREAMS.cringeDecay      → Filter (peak detection)
```

Every agent is a pure function over a typed stream. Tests construct
in-memory `MemoryStateBus` instances; production uses Redis Streams
(Phase 8).

### Canonical scoring formula — CVS

```
                  FIT × VEL_eff × FM × Sp
   CVS = clamp01( ──────────────────────────────────── )
                  max(0.05, RISK + CRINGE + SAT_eff)
```

Implementation: `src/core/scoring/jacking-score.ts`. Reasoning lives
in the file header — read it before changing the formula.

### File layout

```
src/agents/{scout,filter,verifier,creative,architect}/   # the agents
src/connectors/                                          # ≤10-LoC connectors
src/core/{scoring,state,connectors}/                     # shared primitives
lib/                                                      # Next-runtime-bound code (auth, db, realtime hooks)
app/                                                      # Next.js routes (must stay at root)
components/                                               # UI components
tests/                                                    # vitest tests
```

The legacy `lib/scoring/engine.ts` is now a re-export shim → `src/core/scoring`.

---

## Hard rules

1. **No silent fabrication.** If a connector doesn't have real data
   (e.g. Google News doesn't expose reach), emit `0` and let the UI
   render `—`. Never make up numbers that look real.

2. **No claims without citations.** Verifier Agent (Phase 6) extracts
   structured claims from research; every claim must carry `sourceUrl`
   + `quotedSpan`. Drafts cannot cite unverified claims.

3. **Premium AI for any user-visible fact.** Free-tier LLMs (Llama
   etc. via OpenRouter) hallucinate numbers. Use them for triage /
   classification only. Drafts and the research panel must use Claude
   or GPT-4o.

4. **CVS gates content generation, not dashboard ranking.** The
   `opportunity` score (additive composite) drives dashboard sort.
   `jackingScore` (multiplicative AND-gate) drives the Creative Agent's
   go/no-go. Don't conflate them.

5. **Pinned trends always show in Pinned Watchlist.** Other columns
   exclude them — pinning is an explicit operator choice that takes
   precedence over filter ordering.

6. **Cross-column dedup is mandatory.** Each trend appears in exactly
   ONE column (its highest-priority match) via `assignTrendsToColumns`.
   Observer columns (Alerts / Risk / Decay / Compliance / Crisis) tap
   the stream — they show their filtered view but don't claim.

7. **Connector adds are ≤10 LoC.** Use `register({ id, source, poll })`
   from `src/core/connectors/registry.ts`. Don't write a class-based
   `Connector` for new sources — those exist for legacy reasons only.

8. **SESSION_SECRET hard-fails in production.** No exceptions. The
   placeholder default is dev-only.

9. **Every API route requires auth except** the explicit allowlist in
   `middleware.ts`: health, devlog, cron-tick, cron-status, cron/poll.
   Adding a new public route requires updating that allowlist + a code
   comment explaining why.

10. **All time-dependent UI uses the `now` state pattern** in
    `TrendCard.tsx`. SSR + initial-client renders use stable `'—'`
    placeholders; `useEffect` populates the real value post-hydration.
    Direct `Date.now()` in render → React 18 hydration error.

---

## Commands

| Command | Use |
|---|---|
| `npm run dev` | Start dev server on `:3000` |
| `npm run build` | Production build (must pass — 0 TS errors required) |
| `npm test` | Run vitest suite (must pass before commit) |
| `npm run test:watch` | TDD loop |
| `npm run test:cov` | Coverage report |
| `npm run db:push` | Push schema changes to SQLite (dev only) |
| `npm run db:studio` | Prisma Studio at `:5555` |
| `npm run worker` | Long-running cron worker (production path) |

Path aliases (in `tsconfig.json` and `vitest.config.ts`):

| Alias | Resolves to |
|---|---|
| `@/*` | repo root |
| `@core/*` | `src/core/*` |
| `@agents/*` | `src/agents/*` |
| `@connectors/*` | `src/connectors/*` |

---

## Planning Mode protocol

When the user says "build X" or "refactor Y":

1. **Audit** — read affected files, summarize current behavior + risks.
   Output a short Good / Bad / Ugly synopsis.
2. **Plan** — propose changes as a typed contract diff. Show the new
   interface, what's added / removed / changed, what stays unchanged.
   No code yet.
3. **Approval gate** — wait for explicit "go" / "ship it" / "approved".
   Do not start writing code on ambiguous answers.
4. **Branch + commit-per-step** — each logical step is its own commit.
   Commit messages explain the *why*, not the *what*.
5. **Test** — run `npm test` after each significant change. Block ship
   if tests regress.
6. **Smoke** — hit the live dashboard for a manual sanity pass after
   any UI change.
7. **Merge or revert** — user's call, on a per-step basis. Backups at
   `../trendjack-backup-*` are always restorable.

---

## Common pitfalls

### "The dashboard is empty"

Three known causes, in order of likelihood:

1. **Volume crowd-out** — `listTrends` takes the top N by `firstSeenAt
   DESC`. Heavy news ingestion can push brand-keyword + pinned trends
   out of the window. **Fixed** in `lib/store.ts` via priority-row union
   (always include brandKeywordHit + pinned regardless of limit).

2. **Greedy claim phase** — A column with empty filters (`{}`) and high
   priority claims everything in the cross-column dedup. **Fixed** by
   marking observer types (alerts / risk_watch / decay_watch /
   compliance_hold / crisis_watch) as non-claiming.

3. **Stale HMR cache** — `__webpack_modules__[moduleId] is not a function`
   after long edit sessions. Kill dev server, `rm -rf .next`, restart.

### "Reach numbers look fake"

3 connectors used to fabricate reach (`googlenews`, `nitter`, `rsshub`).
Now emit `reach: 0`; UI renders `—`. Real-reach connectors: `reddit`,
`hackernews`, `invidious`, `youtube-official`, `x-official`,
`googletrends`. If a new connector lacks engagement data, **emit 0**.

### "Same trend repeats across columns"

Cross-column dedup is wired (`assignTrendsToColumns`). If the user sees
duplicates anyway, check:
- Are both columns observer types? (Alerts + Risk Watch both tap.)
- Are the duplicate trends actually distinct (different `id` but same
  title)? Run UI-level title dedup in `listTrends` — uses
  `${source}:${fingerprint}` key so Reddit cross-posts collapse.

### "1 error" toast on the dashboard

Hydration mismatch from `Date.now()` in render. The fix pattern:

```ts
const [now, setNow] = React.useState<number | null>(null);
React.useEffect(() => {
  setNow(Date.now());
  const t = setInterval(() => setNow(Date.now()), 60_000);
  return () => clearInterval(t);
}, []);

// then gate every Date.now()-derived render on `now != null`:
const peak = now != null ? timeUntil(trend.peakWindowEnd) : '—';
```

---

## Safety / privacy

- **No PII in scores or rationale.** Scoring engine reads only public
  fields (title / summary / hashtags / lineage). Operator credentials
  (X bearer tokens, etc.) are AES-256-GCM encrypted via
  `lib/security/crypto.ts`.

- **No cross-tenant data leakage.** Every Prisma query that reads
  trends / drafts / boards filters by `brandId` (resolved from the
  authenticated session). Reviewer should reject any new query that
  doesn't.

- **No download / upload by the agent.** When operating browser-side
  (computer-use), the agent never downloads files or follows email
  links without explicit user confirmation.

---

## Testing conventions

- **Fixtures live in `tests/fixtures/`** — `pova-brand.ts` is the
  reference brand, `trends.ts` has 20 hand-labeled signals across 6
  categories. Don't change fixtures to make a test pass; change the
  test or the implementation.

- **Test naming**: `tests/<area>/<unit>.test.ts`. Each axis function
  gets its own file (`tests/scoring/cringe.test.ts`,
  `tests/scoring/risk.test.ts`).

- **Integration tests live in `tests/integration/`** — exercise the
  full `score()` pipeline + agent compositions.

- **Coverage target**: `lib/scoring/**` + `src/core/scoring/**` +
  `src/agents/**` should stay above 80%. Run `npm run test:cov`.

---

## When to push back

If a user request would:
- Re-introduce silent fabrication (fake reach, hallucinated facts)
- Bypass the auth middleware
- Skip the verification step for user-visible claims
- Replace the additive `opportunity` with the multiplicative CVS
  (they serve different jobs — keep both)
- Ship a connector that fetches user PII
- Fork the codebase to Python "for LangGraph" without a clear migration plan

→ **explain why and propose an alternative**. Don't silently comply.

---

## See also

- `README.md` — user-facing setup
- `CHANGELOG.md` — release notes
- `prisma/schema.prisma` — DB schema
- `tests/fixtures/pova-brand.ts` — reference brand profile
