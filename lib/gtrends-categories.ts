// Google Trends category id mapping.
//
// The legacy /trending/rss endpoint accepts a small set of category ids:
//   ''  | 'all'  → top stories (no filter)
//   't'          → sports
//   'b'          → business
//   'e'          → entertainment
//   'm'          → sci/tech
//   'h'          → health
//
// The newer Trending Now UI (https://trends.google.com/trending) exposes
// a longer list (Autos, Beauty, Climate, Games, Hobbies, Jobs, Law, Pets,
// Science, Shopping, Travel) but those use a different JSON endpoint that
// requires session-style headers. We start with the RSS-supported set
// and can extend later without changing the schema (just the mapping).

export interface GtrendsCategory {
  id: string;       // Google Trends id (sent in &category= URL param)
  label: string;    // Human-readable label rendered in dropdowns
  helper: string;   // One-line description for tooltips
}

export const GTRENDS_CATEGORIES: GtrendsCategory[] = [
  { id: 'top', label: 'Top stories',  helper: 'All categories — daily trending searches' },
  { id: 't',   label: 'Sports',       helper: 'Cricket, football, scores, athletes' },
  { id: 'b',   label: 'Business',     helper: 'Markets, finance, deals' },
  { id: 'e',   label: 'Entertainment',helper: 'Films, music, celebs, streaming' },
  { id: 'm',   label: 'Sci & Tech',   helper: 'Phones, gadgets, AI, science news' },
  { id: 'h',   label: 'Health',       helper: 'Wellness, medicine, fitness' },
];

const VALID = new Set(GTRENDS_CATEGORIES.map(c => c.id));

export function isValidCategory(id: string): boolean {
  return VALID.has(id);
}

/** Heuristic: derive a sensible default category set from the brand's
 *  free-text `category` field. New brands get auto-suggested categories
 *  on creation; the operator can override via /brand settings. */
export function suggestCategoriesForBrand(category: string, name: string = ''): string[] {
  const blob = `${category} ${name}`.toLowerCase();
  const out = new Set<string>();
  if (/phone|smartphone|gadget|laptop|tech|electronics|ai|software|saas|app/.test(blob)) {
    out.add('m');
  }
  if (/sports|cricket|football|fitness|athlet|gym/.test(blob)) {
    out.add('t');
  }
  if (/finance|fintech|bank|invest|crypto|stock|business|b2b|saas|enterprise/.test(blob)) {
    out.add('b');
  }
  if (/film|music|stream|entertainment|media|gaming|otts?/.test(blob)) {
    out.add('e');
  }
  if (/health|wellness|pharma|beauty|skincare|food|nutrition/.test(blob)) {
    out.add('h');
  }
  // No matches → fall back to top stories so the column isn't empty.
  if (out.size === 0) out.add('top');
  return Array.from(out);
}
