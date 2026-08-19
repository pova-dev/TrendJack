// Google Sheets integration stub.
// Phase 1: logs the payload. Phase 2 implements service-account flow:
//
//   GOOGLE_SHEETS_PRIVATE_KEY
//   GOOGLE_SHEETS_CLIENT_EMAIL
//   TRENDJACK_SHEET_ID
//
// Sheet columns: timestamp | trend | source | opp | rec | hook | body | platform.

export interface SheetsPayload {
  sheetId?: string;
  rows: Array<Record<string, string | number>>;
}

export async function exportToSheets(p: SheetsPayload) {
  // Audit 2026-05-29 D2 — the previous code returned a confusing
  // `live_not_implemented` only when the user had set the env var (i.e.
  // exactly when they expected it to work). New behaviour: ALWAYS return a
  // 501-style response that's honest about the stub status. The UI shows a
  // single clear "coming soon" message either way.
  const target = p.sheetId ?? process.env.TRENDJACK_SHEET_ID ?? '<default>';
  return {
    ok: false,
    mode: 'stub' as const,
    error: 'sheets_export_not_implemented',
    message:
      `Sheets export is not yet implemented. Would append ${p.rows.length} row(s) ` +
      `to sheet ${target}. Track progress in the Phase 8 roadmap (or use the ` +
      `generic webhook output as a workaround).`,
  };
}
