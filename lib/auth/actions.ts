'use server';

// Auth server actions: signup, signin, signout, switchBrand.
// All return either { ok: true } or { ok: false, error }. Forms call them via
// startTransition / form action.

import { z } from 'zod';
import { prisma } from '@/lib/db';
import { DEFAULT_WEIGHTS } from '@/types';
import { hashPassword, verifyPassword } from './index';
import { getSession } from './session';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

const SignupInput = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(80),
  orgName: z.string().min(1).max(80),
});

const SigninInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function signupAction(form: FormData): Promise<void> {
  const parsed = SignupInput.safeParse({
    email: form.get('email'),
    password: form.get('password'),
    name: form.get('name'),
    orgName: form.get('orgName'),
  });
  if (!parsed.success) throw new Error('invalid_input');

  const { email, password, name, orgName } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error('email_taken');

  const passwordHash = await hashPassword(password);
  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Math.random().toString(36).slice(2, 6);

  const user = await prisma.user.create({ data: { email, name, passwordHash } });
  const org = await prisma.organization.create({ data: { name: orgName, slug } });
  await prisma.membership.create({ data: { userId: user.id, orgId: org.id, role: 'owner' } });

  const session = await getSession();
  session.userId = user.id;
  session.orgId = org.id;
  session.brandId = undefined;
  await session.save();

  redirect('/onboard');
}

export async function signinAction(form: FormData): Promise<void> {
  const parsed = SigninInput.safeParse({
    email: form.get('email'),
    password: form.get('password'),
  });
  if (!parsed.success) throw new Error('invalid_input');

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    include: { memberships: true },
  });
  if (!user) throw new Error('invalid_credentials');

  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) throw new Error('invalid_credentials');

  const session = await getSession();
  session.userId = user.id;
  session.orgId = user.memberships[0]?.orgId;
  session.brandId = undefined;
  await session.save();

  redirect(user.memberships[0] ? '/' : '/onboard');
}

export async function signoutAction(): Promise<void> {
  const session = await getSession();
  session.destroy();
  redirect('/signin');
}

export async function switchBrandAction(brandId: string): Promise<void> {
  const session = await getSession();
  if (!session.userId || !session.orgId) throw new Error('unauthenticated');

  const brand = await prisma.brand.findFirst({
    where: { id: brandId, orgId: session.orgId },
    select: { id: true },
  });
  if (!brand) throw new Error('not_found');

  session.brandId = brand.id;
  await session.save();
  revalidatePath('/');
}

const OnboardInput = z.object({
  brandName: z.string().min(1).max(80),
  category: z.string().min(1).max(80),
  tagline: z.string().max(120).optional(),
  voice: z.string().max(400).optional(),
  competitors: z.string().max(400).optional(),
  markets: z.string().max(200).optional(),
  riskTolerance: z.enum(['low', 'medium', 'high']).default('medium'),
  approvalMode: z.enum(['strict', 'moderate', 'fast']).default('moderate'),
});

export async function createBrandAction(form: FormData): Promise<void> {
  const session = await getSession();
  if (!session.userId || !session.orgId) throw new Error('unauthenticated');

  const parsed = OnboardInput.safeParse({
    brandName: form.get('brandName'),
    category: form.get('category'),
    tagline: form.get('tagline'),
    voice: form.get('voice'),
    competitors: form.get('competitors'),
    markets: form.get('markets'),
    riskTolerance: form.get('riskTolerance') ?? 'medium',
    approvalMode: form.get('approvalMode') ?? 'moderate',
  });
  if (!parsed.success) throw new Error('invalid_input');

  const competitors = (parsed.data.competitors ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const markets = (parsed.data.markets ?? '').split(',').map(s => s.trim()).filter(Boolean);

  const brand = await prisma.brand.create({
    data: {
      orgId: session.orgId,
      name: parsed.data.brandName,
      category: parsed.data.category,
      markets: JSON.stringify(markets),
      audience: JSON.stringify({
        primary: ['Gen Z', 'young professionals'],
        age: '18-30',
        psychographics: ['mobile-first', 'value-conscious'],
      }),
      tone: JSON.stringify({
        voice: parsed.data.voice ?? 'Sharp. Direct. Confident.',
        tagline: parsed.data.tagline ?? '',
        bannedPhrases: ['unleash your potential', 'best version of yourself', 'level up', 'redefine'],
        allowedJokes: [],
        forbiddenStyles: ['lifestyle warmth', 'motivational cliché'],
      }),
      bannedTopics: JSON.stringify(['politics', 'religion', 'tragedy']),
      // Seed brandKeywords with the brand name + a few common variants so
      // the user has SOMETHING in Brand Matches on day one. They'll add
      // product names + market suffixes via /brand later.
      brandKeywords: JSON.stringify(deriveDefaultBrandKeywords(parsed.data.brandName)),
      safeThemes: JSON.stringify([parsed.data.category.toLowerCase()]),
      competitors: JSON.stringify(competitors),
      priorityPlatforms: JSON.stringify(['x', 'youtube', 'reddit', 'tiktok']),
      contentGoal: 'engagement',
      riskTolerance: parsed.data.riskTolerance,
      approvalMode: parsed.data.approvalMode,
      scoringWeights: JSON.stringify(DEFAULT_WEIGHTS),
    },
  });

  // Seed initial demo trends so the dashboard isn't empty on first run.
  const { seedTrendsForBrand } = await import('@/lib/seed');
  await seedTrendsForBrand(brand.id);

  // Default board with 8 columns.
  await prisma.board.create({
    data: {
      brandId: brand.id,
      ownerId: session.userId,
      name: `${parsed.data.brandName} · War Room`,
      shared: true,
      columns: JSON.stringify(defaultColumns()),
    },
  });

  session.brandId = brand.id;
  await session.save();

  redirect('/');
}

function defaultColumns() {
  // Defaults tuned for "show me everything plausibly relevant", not
  // "show me only POST_NOW slam-dunks". Thresholds are intentionally
  // generous — empty columns are worse than slightly-noisy columns
  // because operators stop trusting the dashboard when it looks dead.
  return [
    { id: 'col_brand_matches', type: 'brand_matches',     title: 'Brand Matches',       refreshSec: 60, filters: { minOpportunity: 25, bannedTopicSafe: true, maxRisk: 0.6 }, sort: { key: 'opportunity', dir: 'desc' } },
    { id: 'col_first_mover',   type: 'first_mover_window', title: 'First-Mover Window',  refreshSec: 60, filters: { firstMoverOnly: true, minOpportunity: 20 },                 sort: { key: 'firstSeenAt', dir: 'desc' } },
    { id: 'col_rising',        type: 'rising_trends',     title: 'Rising Trends',       refreshSec: 60, filters: {},                                                            sort: { key: 'velocity',    dir: 'desc' } },
    { id: 'col_competitors',   type: 'competitor_activity', title: 'Competitor Activity', refreshSec: 120, filters: { competitorClaimed: true },                                  sort: { key: 'velocity',    dir: 'desc' } },
    { id: 'col_high_velocity', type: 'high_velocity',     title: 'High Velocity Posts', refreshSec: 60, filters: {},                                                            sort: { key: 'velocity',    dir: 'desc' } },
    { id: 'col_risk_watch',    type: 'risk_watch',        title: 'Trend Risk Watch',    refreshSec: 90, filters: {},                                                            sort: { key: 'risk',        dir: 'desc' } },
    { id: 'col_decay',         type: 'decay_watch',       title: 'Decay Watch',         refreshSec: 300, filters: { decay: true },                                                sort: { key: 'firstSeenAt', dir: 'asc'  } },
    { id: 'col_alerts',        type: 'alerts',            title: 'Alerts',              refreshSec: 30, filters: {},                                                            sort: { key: 'firstSeenAt', dir: 'desc' } },
  ];
}

// Generates sensible default brand keywords from the brand name. Users
// will refine these from /brand → keywords (e.g. add product names like
// "POVA Curve", "POVA 7", or parent brand "Tecno"). The goal is to give
// signup an immediately-useful Brand Matches column.
function deriveDefaultBrandKeywords(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const lower = trimmed.toLowerCase();
  // Tokens: full name + lowercase + common phrase variants.
  return Array.from(new Set([
    trimmed,
    lower,
    `${lower} mobile`,
    `${lower} phone`,
    `${lower} india`,
  ])).filter(t => t.length >= 2);
}
