// Role and capability vocabulary. Deliberately has no 'server-only' marker.
//
// The matrix and `can()` stay server-side in capabilities.ts, because the
// authority for a permission decision must never be something a browser can
// reach and edit. But the *names* are not secrets: a members screen has to
// render a role picker, and a gated control has to name the capability it
// wants. Importing those from the server-only module pulled the whole matrix
// into the client bundle and Next refused to build the page at all.
//
// So this file holds only the vocabulary. No logic, nothing that decides
// anything. capabilities.ts re-exports it so server code has one import.

export type Role = 'owner' | 'admin' | 'strategist' | 'operator' | 'approver' | 'viewer';

/**
 * Named actions. Deliberately about INTENT rather than mechanism:
 * `brand:edit` rather than `PUT /api/brand`, so the matrix survives routes
 * being renamed or split.
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
  // Destruction. Separated from every other capability on purpose: deleting
  // is the one action with no undo, so it is never implied by the ability to
  // create or edit the same thing.
  | 'resource:delete'
  // Administration
  | 'member:manage'     // invites, role changes
  | 'org:admin';        // destructive org-level operations

/** Ordered most privileged first, which is the order a role picker should
 *  read in. */
export const ALL_ROLES: Role[] = ['owner', 'admin', 'strategist', 'operator', 'approver', 'viewer'];

export const ALL_CAPABILITIES: Capability[] = [
  'trend:act', 'draft:create', 'room:comment', 'room:vote',
  'draft:approve', 'plan:approve', 'room:decide',
  'board:edit', 'scoring:edit', 'social:manage', 'brand:edit', 'credential:write',
  'resource:delete', 'member:manage', 'org:admin',
];

/** Human-readable, for permission-denied messages and the members screen. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Full control, including org-level and destructive actions.',
  admin: 'Everything except org-level destruction. Manages people, brand and keys.',
  strategist: 'Configures the product and makes calls: boards, scoring, approvals.',
  operator: 'Day-to-day work: act on trends, generate drafts, comment and vote.',
  approver: 'Reviews and approves. Cannot create the work being approved.',
  viewer: 'Read only.',
};
