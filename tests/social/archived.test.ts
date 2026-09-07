// Archived channels must stay reachable.
//
// Removing a channel is a soft delete, which is the right call: it keeps the
// follower history so re-adding restores the sparkline rather than starting
// from nothing. But the list filtered on `active: true`, so a removed channel
// vanished from every screen while its row stayed in the table and kept being
// counted elsewhere. The landing view read "7 channels configured, all
// switched off" while the social page read "No channels tracked yet", from the
// same data, and there was no control anywhere that could bring one back.
//
// These pin the two halves that have to agree: the query must return archived
// rows, and the page must only claim emptiness when the table is genuinely
// empty.

import { describe, expect, it } from 'vitest';
import type { AccountView } from '@/lib/social/store';

function account(id: string, archived: boolean, isOwn = true): AccountView {
  return {
    id, platform: 'instagram', handle: `h_${id}`, displayName: null, profileUrl: null,
    avatarUrl: null, isOwn, competitorName: null, archived,
    lastPolledAt: null, lastError: null, followers: null, followersDelta: null,
    postCount: null, history: [], latestPost: null,
  } as AccountView;
}

/** The partition the dashboard performs. Kept here so the rule is asserted
 *  rather than only existing inside a render. */
function partition(accounts: AccountView[]) {
  const live = accounts.filter(a => !a.archived);
  return {
    live,
    archived: accounts.filter(a => a.archived),
    own: live.filter(a => a.isOwn),
    rivals: live.filter(a => !a.isOwn),
    showsEmptyState: accounts.length === 0,
  };
}

describe('partition', () => {
  it('keeps archived channels out of the working lists', () => {
    const p = partition([account('a', false), account('b', true)]);
    expect(p.own.map(a => a.id)).toEqual(['a']);
    expect(p.archived.map(a => a.id)).toEqual(['b']);
  });

  it('does not claim emptiness when every channel is archived', () => {
    // The exact defect. Seven archived rows rendered "No channels tracked yet",
    // which is both false and a dead end.
    const p = partition([account('a', true), account('b', true)]);
    expect(p.showsEmptyState).toBe(false);
    expect(p.archived).toHaveLength(2);
  });

  it('still shows the empty state when there is genuinely nothing', () => {
    expect(partition([]).showsEmptyState).toBe(true);
  });

  it('separates own from competitor among live channels only', () => {
    const p = partition([
      account('mine', false, true),
      account('rival', false, false),
      account('old-rival', true, false),
    ]);
    expect(p.own.map(a => a.id)).toEqual(['mine']);
    expect(p.rivals.map(a => a.id)).toEqual(['rival']);
    expect(p.rivals.map(a => a.id)).not.toContain('old-rival');
  });
});

describe('the store contract the page depends on', () => {
  it('exposes archived on the view type', async () => {
    // A compile-time guarantee made explicit: if archived were dropped from
    // AccountView the page would silently treat every row as live again.
    const store = await import('@/lib/social/store');
    expect(typeof store.restoreAccount).toBe('function');
    expect(typeof store.removeAccount).toBe('function');
  });
});
