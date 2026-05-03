// Role-based authorization helper.
//
// `Membership.role` already supports owner / admin / strategist /
// operator / approver / viewer per prisma schema, but until now every
// route that checked role did it ad-hoc. This module is the single
// source of truth — Features E (Trend Rooms decisions) and F (Ship-It
// Plan approvals) both need a fast `requireRole(orgId, userId, [...])`
// that throws or returns the membership, so they can share one
// implementation.
//
// Permission matrix (the "what can each role do" reference):
//
//   owner      → everything (transitively grants all sub-roles)
//   admin      → user mgmt + brand mgmt + plan approval + room decision
//   strategist → drafts + research + plan approval + room comment/vote/decision
//   operator   → drafts + research + room comment/vote (no decision)
//   approver   → review-only — plan approval, no plan create/edit
//   viewer     → read-only — no comments, no votes, no actions
//
// `requireRole(orgId, userId, allowed)` resolves the user's membership
// in the org and returns it iff their role is in `allowed`. Throws
// `AuthorizationError('forbidden')` otherwise. Routes catch this and
// return 403.

import 'server-only';
import { prisma } from '@/lib/db';

export type Role = 'owner' | 'admin' | 'strategist' | 'operator' | 'approver' | 'viewer';

/** Roles in priority order (higher index = more permissions). Used
 *  to check role-AT-LEAST relations in `roleAtLeast`. */
const ROLE_PRIORITY: Role[] = ['viewer', 'approver', 'operator', 'strategist', 'admin', 'owner'];

export class AuthorizationError extends Error {
  constructor(public reason: 'forbidden' | 'no_membership' | 'no_user') {
    super(reason);
    this.name = 'AuthorizationError';
  }
}

/** Resolve the membership and return it iff role is in `allowed`.
 *  Throws AuthorizationError on miss. */
export async function requireRole(
  orgId: string,
  userId: string,
  allowed: Role[],
): Promise<{ userId: string; orgId: string; role: Role }> {
  const m = await prisma.membership.findFirst({
    where: { userId, orgId },
    select: { role: true },
  });
  if (!m) throw new AuthorizationError('no_membership');
  const role = m.role as Role;
  if (!allowed.includes(role)) throw new AuthorizationError('forbidden');
  return { userId, orgId, role };
}

/** True iff the user's role is `>=` the threshold in priority order.
 *  Returns null when there's no membership. Useful for UI gating where
 *  throwing is too strong. */
export async function roleAtLeast(
  orgId: string,
  userId: string,
  threshold: Role,
): Promise<Role | null> {
  const m = await prisma.membership.findFirst({
    where: { userId, orgId },
    select: { role: true },
  });
  if (!m) return null;
  const role = m.role as Role;
  const userIdx = ROLE_PRIORITY.indexOf(role);
  const reqIdx = ROLE_PRIORITY.indexOf(threshold);
  return userIdx >= reqIdx ? role : null;
}

// Common role tuples — keep route handlers from re-typing the same
// arrays and from forgetting to include 'owner'.
export const ROLES_CAN_DECIDE: Role[] = ['owner', 'admin', 'strategist'];
export const ROLES_CAN_APPROVE: Role[] = ['owner', 'admin', 'strategist', 'approver'];
export const ROLES_CAN_COMMENT: Role[] = ['owner', 'admin', 'strategist', 'operator'];
export const ROLES_CAN_EDIT_BRAND: Role[] = ['owner', 'admin'];
