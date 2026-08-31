// The UI must offer only what the server would allow.
//
// Two independent systems now decide whether a control appears: the capability
// matrix on the server, and the set shipped to the browser for hiding buttons.
// If they drift, one of two bad things happens. Either a viewer sees a Delete
// button that 403s, which reads as the app being broken rather than the action
// not being theirs, or an admin loses a control they are entitled to and
// concludes the feature is missing.
//
// These pin the pairing. They are not a substitute for the server guard:
// anything shipped to a browser can be edited in a browser, so requireCapability
// re-checks on every request. Hiding a control is courtesy; the guard is
// security.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { capabilitiesFor, can, ALL_ROLES, type Capability } from '@/lib/auth/capabilities';

describe('shipped capability set', () => {
  it('matches the server matrix exactly for every role', () => {
    for (const role of ALL_ROLES) {
      for (const cap of capabilitiesFor(role)) {
        expect(can(role, cap), `${role} was shipped "${cap}" it does not hold`).toBe(true);
      }
    }
  });

  it('gives an unknown or absent role nothing', () => {
    // A corrupt role value must fail closed. Shipping an allow-all set to a
    // browser because a string did not parse is how a viewer ends up with an
    // admin toolbar.
    expect(capabilitiesFor(null)).toEqual([]);
    expect(capabilitiesFor(undefined)).toEqual([]);
    expect(capabilitiesFor('not-a-role')).toEqual([]);
  });

  it('never ships resource:delete to a role that cannot delete', () => {
    for (const role of ALL_ROLES) {
      const shipped = capabilitiesFor(role).includes('resource:delete');
      expect(shipped, `${role}`).toBe(can(role, 'resource:delete'));
    }
    // The specific expectation this whole feature rests on.
    expect(capabilitiesFor('strategist')).not.toContain('resource:delete');
    expect(capabilitiesFor('admin')).toContain('resource:delete');
    expect(capabilitiesFor('owner')).toContain('resource:delete');
  });
});

describe('destructive controls in the UI', () => {
  /** Every component that can trigger a delete, discovered rather than listed. */
  function deletingComponents(): string[] {
    const found: string[] = [];
    (function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!p.endsWith('.tsx')) continue;
        if (readFileSync(p, 'utf8').includes('deleteWithStepUp')) {
          found.push(p.slice(process.cwd().length + 1));
        }
      }
    })(join(process.cwd(), 'components'));
    return found.sort();
  }

  it('finds the delete controls at all, so a passing suite means something', () => {
    // Guards against the walk silently matching nothing after a rename, which
    // would make every assertion below vacuously true.
    expect(deletingComponents().length).toBeGreaterThanOrEqual(5);
  });

  it('gates every one of them on resource:delete', () => {
    // Discovered, not enumerated. A new component that deletes something is
    // caught the moment it is written, rather than when someone remembers to
    // add it to a list here.
    const ungated: string[] = [];
    for (const rel of deletingComponents()) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      const gated = src.includes('capability-context') && /capability="resource:delete"/.test(src);
      if (!gated) ungated.push(rel);
    }
    expect(
      ungated,
      'These components can delete but show the control to everyone. ' +
      'A viewer clicking one gets a 403, which reads as the app being broken:\n  ' +
      ungated.join('\n  '),
    ).toEqual([]);
  });
});
