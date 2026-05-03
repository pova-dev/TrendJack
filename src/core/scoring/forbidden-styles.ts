// Forbidden-style taxonomy.
//
// `BrandProfile.tone.forbiddenStyles` is a free-text array — operators
// type tone categories they want to AVOID matching against (e.g.
// "doom messaging", "lifestyle warmth", "motivational cliché"). Until
// now those strings were stored but never read.
//
// This module turns each style into a regex vocabulary. computeCringe
// and computeTonalFit consume it: when a trend's body matches a regex
// for a style the brand has on its forbidden list, cringe lifts and
// tonal-fit drops.
//
// Adding a new style is one line — append to FORBIDDEN_STYLE_VOCAB.
// Lowercase the lookup key; case-insensitive regex on the value.

export const FORBIDDEN_STYLE_VOCAB: Record<string, RegExp[]> = {
  'doom messaging': [
    /\b(doom|apocalypse|catastrophe|cataclysm|dying|dead end|extinct|collapse|disaster)\b/i,
    /\b(fashion is dead|industry is dead|world is ending|it'?s over)\b/i,
  ],
  'lifestyle warmth': [
    /\b(cozy|cosy|bliss|blissful|magical|embrace|journey|warm|warmth|pure ritual|simple joys?)\b/i,
    /\b(self[- ]?care(?: sunday)?|treat yourself|me time)\b/i,
  ],
  'motivational cliché': [
    /\b(unleash|limitless|crush(?:ing)? it|level up|grind|hustle|manifest|main character|live your truth|conquer)\b/i,
    /\b(dream big|be the best version|future is now|never settle|push the limits)\b/i,
  ],
  'green-washing': [
    /\b(planet[- ]?saving|guilt[- ]?free|mother earth|save the world|eco[- ]?friendly)\b/i,
    /\b(sustainable lifestyle|green movement|earth-positive)\b/i,
  ],
  'corporate-speak': [
    /\b(synerg|paradigm|leverag|next-gen|disrupt(?:ive|ing)?|frictionless|holistic|turnkey)\b/i,
    /\b(thought leader|move the needle|low[- ]?hanging fruit)\b/i,
  ],
  'fast fashion glorification': [
    /\b(haul|fast fashion|new arrivals weekly|trendy fast|micro[- ]?trend)\b/i,
    /\b(buy now wear once)\b/i,
  ],
};

/** Returns the names of forbidden styles whose vocabulary matches the
 *  given text blob. Caller is responsible for filtering this list against
 *  the brand's actual `tone.forbiddenStyles` selection. */
export function detectForbiddenStyles(blob: string, brandSelected: string[]): string[] {
  const out: string[] = [];
  for (const style of brandSelected) {
    const key = style.trim().toLowerCase();
    const vocab = FORBIDDEN_STYLE_VOCAB[key];
    if (!vocab) continue;
    if (vocab.some(re => re.test(blob))) out.push(style);
  }
  return out;
}
