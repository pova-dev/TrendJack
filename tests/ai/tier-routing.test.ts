// CLAUDE.md hard-rule 3:
//   "Premium AI for any user-visible fact. Free-tier LLMs (Llama etc. via
//    OpenRouter) hallucinate numbers. Use them for triage / classification
//    only. Drafts and the research panel must use Claude or GPT-4o."
//
// This rule was being violated silently. Both the research panel and the
// lineage probe requested `tier: 'balanced'`, which — for the very common
// OpenRouter-only setup — resolves to meta-llama/llama-3.3-70b-instruct.
// A free model was writing user-visible fact.
//
// Two layers of guard here:
//   1. the routing table itself does what the rule says
//   2. the user-visible-fact call sites actually ask for the premium tier
//
// Layer 2 is a source-level assertion on purpose: the bug was a one-word
// argument, invisible to any behavioural test that mocks runChat.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pickRouting } from '@/lib/ai/provider';
import type { OrgCredentials } from '@/lib/credentials';

const ROOT = resolve(__dirname, '../..');
const src = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/** A model that may sit behind a user-visible fact, per rule 3. */
const isPremiumGrade = (model: string) =>
  /claude|gpt-4o|gemini-2\.5-pro/i.test(model);

describe('tier routing — rule 3', () => {
  it('routes premium to a Claude model when only OpenRouter is configured', () => {
    // The exact real-world setup: one OpenRouter key, nothing else.
    const r = pickRouting('premium', { OPENROUTER_API_KEY: 'sk-or-test' });

    expect(r.provider).toBe('openrouter');
    expect(r.model).toMatch(/claude/i);
    expect(isPremiumGrade(r.model)).toBe(true);
  });

  it('routes premium direct to Anthropic when an Anthropic key exists', () => {
    const r = pickRouting('premium', {
      ANTHROPIC_API_KEY: 'sk-ant-test',
      OPENROUTER_API_KEY: 'sk-or-test',
    });

    expect(r.provider).toBe('anthropic');
    expect(r.model).toMatch(/claude/i);
  });

  it('never returns a free-tier model for premium under any key combination', () => {
    const combos: OrgCredentials[] = [
      { OPENROUTER_API_KEY: 'x' },
      { OPENAI_API_KEY: 'x' },
      { GOOGLE_API_KEY: 'x' },
      { ANTHROPIC_API_KEY: 'x' },
      { OPENROUTER_API_KEY: 'x', OPENAI_API_KEY: 'x', GOOGLE_API_KEY: 'x' },
    ];

    for (const creds of combos) {
      const { model } = pickRouting('premium', creds);
      expect(model, `premium resolved to "${model}" for ${JSON.stringify(creds)}`)
        .not.toMatch(/llama|mistral|deepseek|qwen/i);
      expect(isPremiumGrade(model), `premium resolved to non-premium "${model}"`).toBe(true);
    }
  });

  it('documents WHY balanced is unsafe here — it is a free model', () => {
    // Not a bug: balanced is correct for triage/classification. This test
    // exists so the next person understands the cost of using it elsewhere.
    const r = pickRouting('balanced', { OPENROUTER_API_KEY: 'sk-or-test' });
    expect(r.model).toMatch(/llama/i);
  });

  it('returns no provider when nothing is configured', () => {
    expect(pickRouting('premium', {}).provider).toBe('none');
  });
});

describe('user-visible-fact call sites request the premium tier', () => {
  it('the research panel summarizer is premium', () => {
    const body = src('lib/research/index.ts');
    // The single runChat() in this module summarizes search results into
    // the operator-facing research panel.
    expect(body).toMatch(/tier:\s*'premium'/);
    expect(body).not.toMatch(/tier:\s*'balanced'/);
  });

  it('the lineage probe is premium', () => {
    const body = src('lib/lineage/index.ts');
    expect(body).toMatch(/tier:\s*'premium'/);
    expect(body).not.toMatch(/tier:\s*'balanced'/);
  });

  it('draft generation is premium', () => {
    const body = src('lib/ai/draft-gen.ts');
    expect(body).toMatch(/tier:\s*'premium'/);
  });
});
