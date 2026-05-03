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
  const key = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  if (!key) {
    return {
      ok: true,
      mode: 'mock' as const,
      message: `[mock] Would append ${p.rows.length} row(s) to sheet ${p.sheetId ?? process.env.TRENDJACK_SHEET_ID ?? '<default>'}`,
    };
  }
  // Placeholder: live impl uses googleapis. Kept out of MVP bundle to avoid
  // the heavy dep until it's actually used.
  return { ok: false, mode: 'live' as const, error: 'live_not_implemented' };
}
