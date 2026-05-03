// Server-side auth helpers. Use in route handlers, server actions, and pages.

import 'server-only';
import bcrypt from 'bcryptjs';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSession } from './session';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Returns the current user + their active org + active brand.
 * If anything is missing it returns null. Use `requireUser()` to redirect.
 */
export async function getCurrentContext() {
  const session = await getSession();
  if (!session.userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: {
      memberships: { include: { org: { include: { brands: true } } } },
    },
  });
  if (!user) return null;

  const memberships = user.memberships;
  if (!memberships.length) return { user, org: null, brand: null, role: null, brands: [] };

  const orgId = session.orgId && memberships.find(m => m.orgId === session.orgId)
    ? session.orgId
    : memberships[0].orgId;
  const membership = memberships.find(m => m.orgId === orgId)!;
  const org = membership.org;

  const brands = org.brands;
  const brandId = session.brandId && brands.find(b => b.id === session.brandId)
    ? session.brandId
    : brands[0]?.id ?? null;
  const brand = brands.find(b => b.id === brandId) ?? null;

  return { user, org, brand, role: membership.role, brands };
}

export async function requireUser() {
  const ctx = await getCurrentContext();
  if (!ctx) redirect('/signin');
  return ctx;
}

export async function requireBrand() {
  const ctx = await requireUser();
  if (!ctx.brand) redirect('/onboard');
  return ctx as typeof ctx & { brand: NonNullable<typeof ctx.brand> };
}
