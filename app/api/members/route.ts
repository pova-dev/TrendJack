// Members of the current org, and their roles.
//
// Three guards matter more than the CRUD here, because each one prevents a
// state nobody can recover from through the UI:
//
//   1. The last owner cannot be demoted or removed. An org with no owner has
//      nobody who can grant org:admin again, so it is permanently stuck.
//   2. You cannot change your own role. Self-demotion is the same lockout by
//      another route, and self-promotion makes the matrix decorative.
//   3. Roles are validated against the matrix rather than accepted as strings.
//      An unrecognised role denies everything (`can` fails closed), so a typo
//      would silently strip a real person of all access.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireCapability, guardErrorResponse } from '@/lib/auth/guard';
import { ALL_ROLES, type Role } from '@/lib/auth/capabilities';
import { logAudit } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ctx = await requireCapability('member:manage');
    const members = await prisma.membership.findMany({
      where: { orgId: ctx.org.id },
      include: { user: { select: { id: true, email: true, name: true, createdAt: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({
      members: members.map(m => ({
        membershipId: m.id,
        userId: m.userId,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        joinedAt: m.createdAt.toISOString(),
        isSelf: m.userId === ctx.user.id,
      })),
      // So the client can disable the control rather than let someone discover
      // the rule by being refused.
      ownerCount: members.filter(m => m.role === 'owner').length,
    });
  } catch (e) {
    const res = guardErrorResponse(e);
    if (res) return res;
    throw e;
  }
}

/** Change a member's role. */
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireCapability('member:manage');
    const body = await req.json().catch(() => ({})) as { userId?: string; role?: string };

    const role = String(body.role ?? '') as Role;
    if (!ALL_ROLES.includes(role)) {
      return NextResponse.json({ error: 'invalid_role', message: `Role must be one of: ${ALL_ROLES.join(', ')}.` }, { status: 400 });
    }
    if (!body.userId) {
      return NextResponse.json({ error: 'invalid', message: 'userId is required.' }, { status: 400 });
    }
    if (body.userId === ctx.user.id) {
      return NextResponse.json({
        error: 'self_change',
        message: 'You cannot change your own role. Ask another owner to do it.',
      }, { status: 400 });
    }

    const target = await prisma.membership.findFirst({
      where: { orgId: ctx.org.id, userId: body.userId },
    });
    if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    if (target.role === 'owner' && role !== 'owner') {
      const owners = await prisma.membership.count({ where: { orgId: ctx.org.id, role: 'owner' } });
      if (owners <= 1) {
        return NextResponse.json({
          error: 'last_owner',
          message: 'This is the only owner. Promote someone else first, or the org would be left with nobody who can manage it.',
        }, { status: 409 });
      }
    }

    await prisma.membership.update({ where: { id: target.id }, data: { role } });
    await logAudit({
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: 'member.role_changed',
      target: body.userId,
      meta: { from: target.role, to: role },
    });

    return NextResponse.json({ ok: true, role });
  } catch (e) {
    const res = guardErrorResponse(e);
    if (res) return res;
    throw e;
  }
}

/**
 * Remove someone from the org.
 *
 * Gated on resource:delete, not member:manage, so it also requires a fresh
 * emailed code. Removing a person is destructive in the same way deleting a
 * webhook is, and considerably harder to undo.
 */
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireCapability('resource:delete');
    const userId = req.nextUrl.searchParams.get('userId');
    if (!userId) return NextResponse.json({ error: 'invalid', message: 'userId is required.' }, { status: 400 });

    if (userId === ctx.user.id) {
      return NextResponse.json({
        error: 'self_remove',
        message: 'You cannot remove yourself. Ask another owner to do it.',
      }, { status: 400 });
    }

    const target = await prisma.membership.findFirst({ where: { orgId: ctx.org.id, userId } });
    if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    if (target.role === 'owner') {
      const owners = await prisma.membership.count({ where: { orgId: ctx.org.id, role: 'owner' } });
      if (owners <= 1) {
        return NextResponse.json({
          error: 'last_owner',
          message: 'This is the only owner and cannot be removed.',
        }, { status: 409 });
      }
    }

    await prisma.membership.delete({ where: { id: target.id } });
    await logAudit({
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: 'member.removed',
      target: userId,
      meta: { role: target.role },
    });

    // The membership is gone; the user row stays. They may belong to another
    // org, and deleting the account here would be a much larger action than
    // the one that was asked for.
    return NextResponse.json({ ok: true });
  } catch (e) {
    const res = guardErrorResponse(e);
    if (res) return res;
    throw e;
  }
}
