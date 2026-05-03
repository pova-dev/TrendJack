<!-- Thanks for the PR. Keep it scoped — one feature or fix per PR. -->

## What changed

<!-- 1-3 bullets. Use file paths. -->

## Why

<!-- One paragraph. What problem does this solve? -->

## How to test

<!-- Steps a reviewer can follow. Include curl commands or screenshots for UI. -->

## Checklist

- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` succeeds (with `BUILD_STANDALONE=1` if you touched build config)
- [ ] Relevant docs updated (README, inline comments, .env.example)
- [ ] No secrets committed
- [ ] If new env vars: added to `.env.example` + `app/api/credentials/route.ts` allowlist (when applicable)
- [ ] If new connector: added to `lib/connectors/index.ts` registry + `optionsFor()` switch + `/connectors` UI shows it
- [ ] CI green

## Screenshots / output

<!-- For UI changes: before/after. For API changes: example curl response. -->
