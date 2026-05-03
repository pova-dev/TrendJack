'use client';
import * as React from 'react';
import type { BrandProfile } from '@/types';
import { Chip } from '@/components/ui/Chip';
import { ChipInput } from './ChipInput';

// Watchlist editor — unified UI for brand keywords, competitors, themes,
// and banned topics. Currently a derived view over BrandProfile fields
// (Phase 5 shim); when the watch_term table lands this becomes the
// canonical editor.

interface Props {
  brand: BrandProfile;
  onPatch: (patch: Partial<BrandProfile>) => void;
}

interface SectionDef {
  key: 'brand' | 'competitor' | 'theme' | 'banned-phrase' | 'banned-topic';
  title: string;
  hint: string;
  tone: 'flare' | 'neutral' | 'good' | 'bad';
  placeholder: string;
  weight: 1 | 2 | 3 | 4 | 5;
  read: (b: BrandProfile) => string[];
  write: (b: BrandProfile, v: string[]) => Partial<BrandProfile>;
}

const SECTIONS: SectionDef[] = [
  {
    key: 'brand',
    title: 'Brand keywords',
    hint: 'Specific product / brand names. Trends mentioning these become Brand Matches. Tier-1 priority.',
    tone: 'flare',
    placeholder: 'your brand name, parent company, key product lines…',
    weight: 5,
    read: b => b.brandKeywords ?? [],
    write: (_b, v) => ({ brandKeywords: v }),
  },
  {
    key: 'competitor',
    title: 'Competitors',
    hint: 'Competitor names. Trends mentioning these route to Competitor Activity (not Brand Matches). Tier-2.',
    tone: 'neutral',
    placeholder: 'competitor brand names',
    weight: 3,
    read: b => b.competitors ?? [],
    write: (_b, v) => ({ competitors: v }),
  },
  {
    key: 'theme',
    title: 'Safe themes',
    hint: 'Broader category terms. Trends matching these gain soft-anchor topical fit. Tier-3.',
    tone: 'good',
    placeholder: 'broader themes that match your brand POV',
    weight: 2,
    read: b => b.safeThemes ?? [],
    write: (_b, v) => ({ safeThemes: v }),
  },
  {
    key: 'banned-phrase',
    title: 'Banned phrases',
    hint: 'Phrases that should never appear in drafts. Trigger high cringe + IGNORE.',
    tone: 'bad',
    placeholder: 'unleash your potential, level up, redefine…',
    weight: 5,
    read: b => b.tone.bannedPhrases ?? [],
    write: (b, v) => ({ tone: { ...b.tone, bannedPhrases: v } }),
  },
  {
    key: 'banned-topic',
    title: 'Banned topics',
    hint: 'Topics that force topicalFit=0 and route trends to ESCALATE.',
    tone: 'bad',
    placeholder: 'politics, religion, election, tragedy, lawsuit…',
    weight: 5,
    read: b => b.bannedTopics ?? [],
    write: (_b, v) => ({ bannedTopics: v }),
  },
];

export function WatchlistEditor({ brand, onPatch }: Props) {
  const totalTerms = SECTIONS.reduce((sum, s) => sum + s.read(brand).length, 0);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-flare-500/40 bg-flare-500/[0.03] p-4">
        <div className="flex items-baseline gap-2 mb-1">
          <h2 className="text-sm font-semibold text-ink-100">Watchlist</h2>
          <Chip tone="flare">unified</Chip>
          <span className="ml-auto text-2xs font-mono text-ink-300">{totalTerms} terms</span>
        </div>
        <p className="text-2xs text-ink-300">
          The operator-curated taxonomy that drives every connector query, brand-fit gate, and
          column filter. Higher-tier terms claim trends first (Brand &gt; Competitor &gt; Theme).
        </p>
      </div>

      {SECTIONS.map(section => {
        const value = section.read(brand);
        return (
          <div key={section.key} className="rounded-md border border-ink-700 bg-ink-900 p-4">
            <div className="flex items-baseline gap-2 mb-1">
              <h3 className="text-sm font-semibold text-ink-100">{section.title}</h3>
              <Chip tone="neutral">w{section.weight}</Chip>
              <span className="ml-auto text-2xs font-mono text-ink-400">{value.length}</span>
            </div>
            <p className="text-2xs text-ink-400 mb-2">{section.hint}</p>
            <ChipInput
              tone={section.tone}
              value={value}
              onChange={v => onPatch(section.write(brand, v))}
              placeholder={section.placeholder}
            />
          </div>
        );
      })}

      <div className="rounded-md border border-ink-700 bg-ink-800/40 p-3">
        <h3 className="text-2xs font-semibold uppercase tracking-wider text-ink-300 mb-1">Coming in Phase 5.5</h3>
        <ul className="text-2xs text-ink-400 space-y-0.5 list-disc list-inside">
          <li>Account watches (X handles, Reddit users, YouTube channels)</li>
          <li>Hashtag watches</li>
          <li>Per-term staleness ("this term hasn't fired in 14d")</li>
          <li>Migration to a dedicated watch_term Prisma table</li>
        </ul>
      </div>
    </div>
  );
}
