// Reference brand fixture — POVA. Mirrors the demo seed in app/dev/login/route.ts
// but kept here as a stable test input. Changes to the demo seed should NOT
// affect this file unless we explicitly want to retune the fixture suite.

import type { BrandProfile } from '@/types';
import { DEFAULT_WEIGHTS } from '@/types';

export const POVA_BRAND: BrandProfile = {
  id: 'fixture-pova',
  name: 'POVA',
  category: 'Smartphones / consumer tech',
  markets: ['India', 'SEA', 'MEA'],
  audience: {
    primary: ['Gen Z', 'young professionals', 'students', 'gamers', 'creators'],
    age: '18-28',
    psychographics: ['mobile-first', 'value-conscious', 'spec-aware', 'irony-fluent'],
  },
  tone: {
    voice: "Sharp. Direct. Confident. Anti-cliché. Outcome-led, not spec-war.",
    tagline: "Built for What's Next.",
    bannedPhrases: [
      'unleash your potential', 'best version of yourself', 'level up',
      'redefine', 'reimagined', 'limitless', 'dream big', 'game changer',
    ],
    allowedJokes: [
      'battery', 'thermal', 'thin', 'gaming', 'thumb pain', 'budget', 'flagship killer',
    ],
    forbiddenStyles: [
      'lifestyle warmth', 'generic corporate tone', 'forced Gen Z slang', 'motivational cliché',
    ],
  },
  bannedTopics: [
    'politics', 'religion', 'caste', 'communal', 'election', 'tragedy', 'lawsuit',
  ],
  brandKeywords: [
    'pova', 'pova mobile', 'pova phone', 'pova india',
    'pova curve', 'pova 7', 'pova 6', 'pova 5',
    'tecno', 'tecno pova', 'tecno mobile',
  ],
  safeThemes: [
    'battery life', 'gaming', 'thermal', 'design', 'thin', 'curve', 'display',
    'performance', 'budget', 'creator', 'speed', 'durability', 'specs',
    'smartphone', 'phone',
  ],
  competitors: [
    'Xiaomi', 'Realme', 'iQOO', 'Samsung', 'OnePlus', 'Motorola',
  ],
  priorityPlatforms: ['x', 'youtube', 'reddit', 'tiktok'],
  contentGoal: 'engagement + brand-fit relevance for Gen Z buyers',
  riskTolerance: 'medium',
  approvalMode: 'moderate',
  crisisMode: false,
  scoringWeights: DEFAULT_WEIGHTS,
};
