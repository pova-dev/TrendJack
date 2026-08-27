// Capability model.
//
// The previous design was `requireRole(orgId, userId, ['owner','admin'])`
// called from whichever routes remembered to. Two problems, both structural:
//
//   1. A route that forgets the call is not restricted, it is WIDE OPEN. The
//      safe default was "allow", which is backwards. Six of forty-eight
//      mutating routes actually called it, so a viewer could delete a column
//      or publish a draft.
//   2. The knowledge of who-can-do-what was smeared across route files, so
//      adding a role meant auditing every route to find the ones that needed
//      updating.
//
// This module inverts both. Capabilities are named actions; one matrix maps
// roles to them; routes ask for a capability rather than listing roles. Adding
// a role is one line here and nothing anywhere else. And a companion test
// enumerates every mutating route and fails the build if one has no guard, so
// "forgot to check" becomes a red CI run rather than a silent hole.

import 'server-only';

export type Role = 'owner' | 'admin' | 'strategist' | 'operator' | 'approver' | 'viewer';

/**
 * Named actions. Deliberately about INTENT rather than mechanism: `brand:edit`
 * rather than `PUT /api/brand`, so the matrix survives routes being renamed or
 * split.
 */
export type Capability =
  // Day-to-day operator work
  | 'trend:act'         // save, dismiss, pin, un-pin
  | 'draft:create'      // generate a draft, run research
  | 'room:comment'
  | 'room:vote'
  // Judgement calls
  | 'draft:approve'
  | 'plan:approve'
  | 'room:decide'
  // Configuration
  | 'board:edit'        // columns, layout
  | 'scoring:edit'      // weights, calibration
  | 'social:manage'     // tracked accounts
  | 'brand:edit'        // profile, keywords, competitors
  | 'credential:write'  // API keys
  // Administration
  | 'member:manage'     // invites, role changes
  | 'org:admin';        // destructive org-level operations

/**
 * Role to capability matrix. The single source of truth.
 *
 * Written as explicit unions rather than a hierarchy, because the hierarchy is
 * not actually linear: an approver outranks an operator for approvals but
 * cannot create drafts, and a strategist configures the product but does not
 * manage people. Flattening that into "levels" is what produces the classic
 * bug where a reviewer accidentally gains write access.
 */
const VIEWER: Capability[] = [];

const APPROVER: Capability[] = [
  // Review only. Deliberately cannot create the thing it approves.
  'draft:approve', 'plan:approve', 'room:comment', 'room:vote',
];

const OPERATOR: Capability[] = [
  'trend:act', 'draft:create', 'room:comment', 'room:vote',
];

const STRATEGIST: Capability[] = [
  ...OPERATOR,
  'draft:approve', 'plan:approve', 'room:decide',
  'board:edit', 'scoring:edit', 'social:manage',
];

const ADMIN: Capability[] = [
  ...STRATEGIST,
  'brand:edit', 'credential:write', 'member:manage',
];

const OWNER: Capability[] = [...ADMIN, 'org:admin'];

const MATRIX: Record<Role, ReadonlySet<Capability>> = {
  viewer: new Set(VIEWER),
  approver: new Set(APPROVER),
  operator: new Set(OPERATOR),
  strategist: new Set(STRATEGIST),
  admin: new Set(ADMIN),
  owner: new Set(OWNER),
};

export const ALL_ROLES: Role[] = ['owner', 'admin', 'strategist', 'operator', 'approver', 'viewer'];

export const ALL_CAPABILITIES: Capability[] = [
  'trend:act', 'draft:create', 'room:comment', 'room:vote',
  'draft:approve', 'plan:approve', 'room:decide',
  'board:edit', 'scoring:edit', 'social:manage', 'brand:edit', 'credential:write',
  'member:manage', 'org:admin',
];

/**
 * Can this role perform this action?
 *
 * Pure and synchronous, so it is trivially testable and can be used to gate UI
 * without a round trip. An unknown role string denies everything: a corrupt or
 * future role value must fail closed, never open.
 */
export function can(role: string | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  const set = MATRIX[role as Role];
  if (!set) return false;   // unknown role: deny
  return set.has(capability);
}

/** Every capability a role holds. Used to ship a permission set to the client
 *  so the UI can hide what the user cannot do. */
export function capabilitiesFor(role: string | null | undefined): Capability[] {
  if (!role) return [];
  const set = MATRIX[role as Role];
  return set ? [...set] : [];
}

/** Human-readable, for permission-denied messages and the members screen. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Full control, including org-level and destructive actions.',
  admin: 'Everything except org-level destruction. Manages people, brand and keys.',
  strategist: 'Configures the product and makes calls: boards, scoring, approvals.',
  operator: 'Day-to-day work: act on trends, generate drafts, comment and vote.',
  approver: 'Reviews and approves. Cannot create the work being approved.',
  viewer: 'Read only.',
};
