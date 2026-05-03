// Citation parser. Given an LLM response and a brand's keyword/competitor
// lists, decides:
//   - was the brand cited at all?
//   - at what rank-position (1 = first named brand-like noun)
//   - which competitors were mentioned (subset of brand.competitors that
//     appear in the response)
//
// Word-boundary matched, case-insensitive, deduped. Position-1 means
// "named before any competitor"; position-2 means "named after exactly
// one competitor"; etc. When the brand isn't cited, position is null.

export interface CitationParseResult {
  cited: boolean;
  position: number | null;
  /** Up to 200 chars of the response surrounding the first brand mention,
   *  for operator drill-down. Empty when not cited. */
  snippet: string;
  competitorsMentioned: string[];
}

export function parseCitation(
  responseText: string,
  brandKeywords: string[],
  competitors: string[],
): CitationParseResult {
  const text = responseText ?? '';
  const lc = text.toLowerCase();

  // Build a regex that matches any brand keyword as a whole word.
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const brandPattern = brandKeywords
    .filter(k => k.trim().length >= 2)
    .map(k => escapeRe(k.trim().toLowerCase()))
    .join('|');
  const competitorPattern = competitors
    .filter(c => c.trim().length >= 2)
    .map(c => escapeRe(c.trim().toLowerCase()))
    .join('|');

  const brandRe = brandPattern ? new RegExp(`\\b(${brandPattern})\\b`, 'gi') : null;
  const competitorRe = competitorPattern ? new RegExp(`\\b(${competitorPattern})\\b`, 'gi') : null;

  // Find ALL named-entity matches (brand + competitor) with positions.
  // Then sort by index and rank-determine.
  type Hit = { name: string; index: number; isBrand: boolean };
  const hits: Hit[] = [];
  if (brandRe) {
    let m;
    while ((m = brandRe.exec(lc)) !== null) {
      hits.push({ name: m[1], index: m.index, isBrand: true });
    }
  }
  if (competitorRe) {
    let m;
    while ((m = competitorRe.exec(lc)) !== null) {
      hits.push({ name: m[1], index: m.index, isBrand: false });
    }
  }
  hits.sort((a, b) => a.index - b.index);

  // First brand mention.
  const firstBrandHit = hits.find(h => h.isBrand);
  const cited = !!firstBrandHit;

  // Position: count distinct preceding entity names (brand or competitor)
  // before the first brand mention. If brand is the first named entity,
  // position is 1.
  let position: number | null = null;
  if (firstBrandHit) {
    const seenBefore = new Set<string>();
    for (const h of hits) {
      if (h.index >= firstBrandHit.index) break;
      seenBefore.add(h.name);
    }
    position = seenBefore.size + 1;
  }

  // Snippet: ~200 chars around the first brand mention, original casing.
  let snippet = '';
  if (firstBrandHit) {
    const start = Math.max(0, firstBrandHit.index - 80);
    const end = Math.min(text.length, firstBrandHit.index + 120);
    snippet = text.slice(start, end).trim();
  }

  // Distinct competitors mentioned.
  const competitorsMentioned = Array.from(new Set(
    hits.filter(h => !h.isBrand).map(h => h.name),
  ));

  return { cited, position, snippet, competitorsMentioned };
}
