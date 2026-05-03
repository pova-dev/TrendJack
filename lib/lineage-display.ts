// Lineage rendering helper.
//
// The Google Trends connector tags every emitted signal with a leading
// `[cat:<id>]` token so column-level filters can match it. That token is
// purely structural — it's not human copy, and showing it in the
// dashboard ("[cat:m] Google Trends · IN · top src: NDTV") is ugly.
//
// This helper strips the tag for rendering. Filtering still uses the raw
// lineage string, so /lib/columns.ts doesn't change.

export function displayLineage(raw: string): string {
  if (!raw) return raw;
  const m = raw.match(/^\[cat:[^\]]+\]\s*/);
  return m ? raw.slice(m[0].length) : raw;
}
