// Capability matrix tests.
//
// These encode the decisions, so changing who can do what requires changing a
// test on purpose rather than discovering it in production.
//
// The important one is the last block: it walks every API route on disk and
// fails if a mutating handler has no guard. That converts "someone forgot to
// check permissions" from a silent hole into a red build, which is the only
// version of this that survives a team and a year.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import {
  can, capabilitiesFor, ALL_ROLES, ALL_CAPABILITIES,
  type Role, type Capability,
} from '@/lib/auth/capabilities';

describe('deny by default', () => {
  it('gives a viewer no capabilities at all', () => {
    // A viewer could previously delete a column, because most routes never
    // checked. Read-only has to mean read-only.
    for (const c of ALL_CAPABILITIES) {
      expect(can('viewer', c), `viewer must not have "${c}"`).toBe(false);
    }
    expect(capabilitiesFor('viewer')).toEqual([]);
  });

  it('denies an unknown or corrupt role everything', () => {
    // A future role, a typo, or a tampered row must fail closed.
    for (const bogus of ['superuser', 'ADMIN', '', 'null', 'root']) {
      for (const c of ALL_CAPABILITIES) {
        expect(can(bogus, c), `"${bogus}" must not have "${c}"`).toBe(false);
      }
    }
  });

  it('denies a missing role', () => {
    expect(can(null, 'trend:act')).toBe(false);
    expect(can(undefined, 'brand:edit')).toBe(false);
  });
});

describe('role boundaries that matter', () => {
  it('lets an owner do everything', () => {
    for (const c of ALL_CAPABILITIES) expect(can('owner', c)).toBe(true);
  });

  it('stops everyone except the owner doing org-level damage', () => {
    for (const r of ALL_ROLES.filter(r => r !== 'owner')) {
      expect(can(r, 'org:admin'), `${r} must not have org:admin`).toBe(false);
    }
  });

  it('keeps API keys away from anyone below admin', () => {
    expect(can('admin', 'credential:write')).toBe(true);
    expect(can('owner', 'credential:write')).toBe(true);
    for (const r of ['strategist', 'operator', 'approver', 'viewer'] as Role[]) {
      expect(can(r, 'credential:write'), `${r} must not write credentials`).toBe(false);
    }
  });

  it('separates approving work from creating it', () => {
    // The point of an approver: they review, they do not produce. Collapsing
    // these is how a reviewer silently gains authoring rights.
    expect(can('approver', 'draft:approve')).toBe(true);
    expect(can('approver', 'plan:approve')).toBe(true);
    expect(can('approver', 'draft:create')).toBe(false);
    expect(can('approver', 'trend:act')).toBe(false);
  });

  it('lets an operator work but not configure', () => {
    expect(can('operator', 'trend:act')).toBe(true);
    expect(can('operator', 'draft:create')).toBe(true);
    expect(can('operator', 'board:edit')).toBe(false);
    expect(can('operator', 'scoring:edit')).toBe(false);
    expect(can('operator', 'brand:edit')).toBe(false);
  });

  it('lets a strategist configure but not manage people', () => {
    expect(can('strategist', 'board:edit')).toBe(true);
    expect(can('strategist', 'scoring:edit')).toBe(true);
    expect(can('strategist', 'social:manage')).toBe(true);
    expect(can('strategist', 'member:manage')).toBe(false);
    expect(can('strategist', 'credential:write')).toBe(false);
  });

  it('is not a simple ladder, and the matrix proves it', () => {
    // An approver outranks an operator for approvals and is outranked for
    // authoring. A linear "level" model cannot express that, and pretending it
    // can is what produces over-granted reviewers.
    expect(can('approver', 'draft:approve')).toBe(true);
    expect(can('operator', 'draft:approve')).toBe(false);
    expect(can('operator', 'draft:create')).toBe(true);
    expect(can('approver', 'draft:create')).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Coverage: every mutating route must be guarded.
// ───────────────────────────────────────────────────────────────────────────

const API_ROOT = resolve(__dirname, '../../app/api');

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) routeFiles(p, out);
    else if (entry === 'route.ts') out.push(p);
  }
  return out;
}

/**
 * Routes that mutate but are deliberately not capability-guarded, each with
 * the reason. Anything not on this list must carry a guard.
 *
 * Kept explicit so an exemption is a decision someone made and can be
 * reviewed, rather than an omission nobody noticed.
 */
const EXEMPT = new Map<string, string>([
  ['cron-tick/route.ts', 'machine endpoint, authenticated by CRON_SECRET rather than a session'],
  ['cron/poll/[source]/route.ts', 'machine endpoint, same token auth'],
  ['devlog/route.ts', 'dev-only diagnostic, disabled in production'],
  ['auth/signin/route.ts', 'establishes the session; cannot require one'],
  ['auth/signup/route.ts', 'creates the account; no membership exists yet'],
  ['auth/signout/route.ts', 'ends a session; requires no capability'],
  ['health/route.ts', 'liveness probe'],
  ['push/subscribe/route.ts', 'per-user self-service: registers the callers own browser for notifications, grants no access to data'],
]);

describe('route guard coverage', () => {
  const files = routeFiles(API_ROOT);

  it('finds the API surface', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('guards every mutating route, or exempts it on purpose', () => {
    const unguarded: string[] = [];

    for (const file of files) {
      const rel = relative(API_ROOT, file);
      const src = readFileSync(file, 'utf8');

      const mutates = /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/.test(src);
      if (!mutates) continue;

      if ([...EXEMPT.keys()].some(k => rel.endsWith(k))) continue;

      const guarded =
        src.includes('requireCapability') ||
        src.includes('withCapability') ||
        // The older helper is still a real check; routes using it are guarded.
        src.includes('requireRole');

      if (!guarded) unguarded.push(rel);
    }

    expect(
      unguarded,
      `These routes mutate state with no permission check. Add requireCapability(), ` +
      `or add an entry to EXEMPT with the reason:\n  ${unguarded.join('\n  ')}`,
    ).toEqual([]);
  });
});
