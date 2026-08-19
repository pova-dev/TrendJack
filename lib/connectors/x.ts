// Removed 2026-05-29. The throwing-stub XConnector was never wired into the
// registry; the real X connector lives in `x-official.ts` (paid Bearer) and
// `nitter.ts` (open-source frontend). Keeping the file as an empty module
// so any rogue `import './x'` resolves cleanly.
export {};
