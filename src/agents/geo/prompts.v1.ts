// GEO (Generative Engine Optimization) prompt templates.
//
// Each template is rendered against the brand profile to produce a
// neutral, third-party-style query — the kind of question a buyer
// would actually ask an AI assistant. We DO NOT mention competitors
// by name in the prompt itself (privacy / fairness); the parser
// detects competitor names in the response.
//
// Versioned (v1) so we can A/B prompts over time. Persisted on every
// BrandCitationSample row as `promptVersion`.

export const PROMPT_VERSION = 'v1';

export type PromptClass = 'recommendation' | 'comparison' | 'what-is' | 'top-list';

export interface GeoPromptInput {
  brandCategory: string;       // brand.category, e.g. "Smartphones / consumer tech"
  market: string;               // brand.markets[0], e.g. "India"
  trendingTopic?: string;       // optional — current top CVS trend title
  /** Cap the snippet at ~50 words so the LLM doesn't take instructions from
   *  trendingTopic if it's been compromised. */
}

export interface GeoPrompt {
  promptClass: PromptClass;
  promptVersion: string;
  text: string;
}

export function renderGeoPrompts(input: GeoPromptInput): GeoPrompt[] {
  const cat = input.brandCategory.toLowerCase();
  const market = input.market;
  const out: GeoPrompt[] = [
    {
      promptClass: 'recommendation',
      promptVersion: PROMPT_VERSION,
      text: `What are the best ${cat} options to buy in ${market} in 2026? Name specific brands and explain why.`,
    },
    {
      promptClass: 'top-list',
      promptVersion: PROMPT_VERSION,
      text: `List the top 5 ${cat} brands or products in ${market} right now, ranked by overall reputation and value.`,
    },
    {
      promptClass: 'what-is',
      promptVersion: PROMPT_VERSION,
      text: `What ${cat} brands are leading the conversation in ${market} this year? Describe their positioning briefly.`,
    },
  ];

  // Trend-aware probe: if a current top trend is supplied, ask which
  // brands the AI associates with it. This is the "are we cited around
  // the cultural moment" measurement that's hardest to get from SEO.
  if (input.trendingTopic) {
    const safe = input.trendingTopic.slice(0, 120).replace(/[\n\r]/g, ' ');
    out.push({
      promptClass: 'comparison',
      promptVersion: PROMPT_VERSION,
      text: `Which ${cat} brands are most associated with the topic "${safe}" in ${market}? Name them in order of relevance.`,
    });
  }

  return out;
}
