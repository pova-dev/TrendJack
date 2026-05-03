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
  // Role pick — drives the operator's membership.role on the new org.
  // Only relevant when the user is creating their first brand (creates
  // both the org and its membership). Default 'owner' preserves the
  // legacy single-user-shop default.
  role: z.enum(['owner', 'admin', 'strategist', 'operator', 'approver', 'viewer']).default('owner'),
  // Tone capture (lighter-weight than the full BrandEditor surface).
  // Comma-separated, parsed into JSON arrays. Operator can refine
  // later from /brand.
  bannedPhrases: z.string().max(400).optional(),
  forbiddenStyles: z.string().max(400).optional(),
  allowedJokes: z.string().max(400).optional(),
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
    role: form.get('role') ?? 'owner',
    bannedPhrases: form.get('bannedPhrases'),
    forbiddenStyles: form.get('forbiddenStyles'),
    allowedJokes: form.get('allowedJokes'),
  });
  if (!parsed.success) throw new Error('invalid_input');

  const competitors = (parsed.data.competitors ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const markets = (parsed.data.markets ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const splitCsv = (s?: string) => (s ?? '').split(',').map(v => v.trim()).filter(Boolean);
  const bannedPhrases = splitCsv(parsed.data.bannedPhrases);
  const forbiddenStyles = splitCsv(parsed.data.forbiddenStyles);
  const allowedJokes = splitCsv(parsed.data.allowedJokes);

  // Auto-suggest gtrends categories from the brand's free-text category.
  // Operator can refine later via /brand → "Categories to ingest".
  const { suggestCategoriesForBrand } = await import('@/lib/gtrends-categories');
  const gtrendsCategories = suggestCategoriesForBrand(parsed.data.category, parsed.data.brandName);

  // Update the user's membership role on this org. The auth signup path
  // creates the membership with role='owner'; if the operator picked a
  // different role here, persist it. Multi-user orgs can still grant
  // owner via a separate admin flow later.
  if (parsed.data.role !== 'owner') {
    await prisma.membership.updateMany({
      where: { userId: session.userId, orgId: session.orgId },
      data: { role: parsed.data.role },
    });
  }

  // Category-aware defaults — Round 3 cross-category audit caught the
  // previous defaults silently injecting POVA-shaped identity (Gen Z
  // mobile-first, TikTok-flavored platforms, motivational-cliché bans)
  // into Vault (fintech), Hearth (home goods), and Strider (B2B SaaS).
  const audienceDefault = audienceDefaultsForCategory(parsed.data.category);
  const platformsDefault = priorityPlatformsForCategory(parsed.data.category);
  const bannedTopicsDefault = bannedTopicsForCategory(parsed.data.category);

  const brand = await prisma.brand.create({
    data: {
      orgId: session.orgId,
      name: parsed.data.brandName,
      category: parsed.data.category,
      markets: JSON.stringify(markets),
      audience: JSON.stringify(audienceDefault),
      tone: JSON.stringify({
        voice: parsed.data.voice ?? '',
        tagline: parsed.data.tagline ?? '',
        // Empty defaults — operator fills via /brand. The previous default
        // ('unleash your potential', 'level up', 'lifestyle warmth') was
        // smartphone-marketing flavored and either irrelevant (B2B SaaS)
        // or actively wrong (home goods, where lifestyle warmth IS the
        // voice). Empty = operator must consciously decide.
        bannedPhrases,
        allowedJokes,
        forbiddenStyles,
      }),
      bannedTopics: JSON.stringify(bannedTopicsDefault),
      // Seed only the name + lowercase variant. Category-specific suffixes
      // ("mobile", "india", etc.) would silently fabricate brand identity.
      brandKeywords: JSON.stringify(deriveDefaultBrandKeywords(parsed.data.brandName)),
      gtrendsCategories: JSON.stringify(gtrendsCategories),
      safeThemes: JSON.stringify([parsed.data.category.toLowerCase()]),
      competitors: JSON.stringify(competitors),
      priorityPlatforms: JSON.stringify(platformsDefault),
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

// Generates sensible default brand keywords from the brand name. We seed
// only the brand name + lowercase form — anything else (product lines,
// market suffixes) is brand/category-specific and would silently inject
// false identity into non-POVA tenants. (Round 3 cross-category audit
// caught the previous "${name} mobile / phone / india" seeds polluting
// Solera/Vault/Hearth/Strider tenants from day one.)
//
// Operator refines from /brand → Brand Keywords on first visit.
function deriveDefaultBrandKeywords(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const lower = trimmed.toLowerCase();
  return Array.from(new Set([trimmed, lower].filter(t => t.length >= 2)));
}

// ──────────────────────────────────────────────────────────────────────
// Category-aware seeded defaults. Each function takes the brand's
// free-text category string and returns the seed for one field. Match
// is loose-keyword (case-insensitive contains) so "DTC home goods" and
// "candles & ceramics" both route to home-goods. Unmatched categories
// fall back to a neutral generic seed — never to POVA-flavored copy.
// ──────────────────────────────────────────────────────────────────────

interface AudienceShape { primary: string[]; age: string; psychographics: string[] }

function categoryClass(category: string): 'tech' | 'finance' | 'fashion' | 'home' | 'b2b' | 'health' | 'food' | 'generic' {
  const c = category.toLowerCase();
  if (/(phone|smartphone|laptop|gadget|electronics|tech|software|saas|ai\b|app)/.test(c)) {
    if (/(b2b|enterprise|saas|crm|erp|ops|hr|fintech-saas)/.test(c)) return 'b2b';
    return 'tech';
  }
  if (/(fintech|finance|bank|invest|crypto|wealth|loan|payment|insurance)/.test(c)) return 'finance';
  if (/(fashion|apparel|footwear|shoe|sneaker|clothing|streetwear|luxury|jewelry|cosmetic|beauty)/.test(c)) return 'fashion';
  if (/(home|decor|furniture|candle|ceramic|kitchen|bedding|garden|dtc home)/.test(c)) return 'home';
  if (/(b2b|enterprise|warehouse|logistics|hr|crm|erp|ops)/.test(c)) return 'b2b';
  if (/(health|wellness|fitness|nutrition|pharma|medical|telehealth|supplement)/.test(c)) return 'health';
  if (/(food|beverage|drink|coffee|tea|snack|restaurant|cpg)/.test(c)) return 'food';
  return 'generic';
}

function audienceDefaultsForCategory(category: string): AudienceShape {
  switch (categoryClass(category)) {
    case 'tech':    return { primary: [], age: '', psychographics: [] };  // tech defaults vary too widely; leave empty
    case 'finance': return { primary: [], age: '', psychographics: ['financially literate', 'risk-aware'] };
    case 'fashion': return { primary: [], age: '', psychographics: ['design-conscious'] };
    case 'home':    return { primary: [], age: '', psychographics: ['aspirational', 'design-led'] };
    case 'b2b':     return { primary: [], age: '', psychographics: ['operations-pragmatic', 'ROI-led'] };
    case 'health':  return { primary: [], age: '', psychographics: ['wellness-led'] };
    case 'food':    return { primary: [], age: '', psychographics: ['flavor-curious'] };
    case 'generic': return { primary: [], age: '', psychographics: [] };
  }
}

function priorityPlatformsForCategory(category: string): string[] {
  switch (categoryClass(category)) {
    case 'tech':    return ['x', 'youtube', 'reddit'];
    case 'finance': return ['linkedin', 'x', 'youtube'];
    case 'fashion': return ['instagram', 'tiktok', 'youtube'];
    case 'home':    return ['instagram', 'pinterest', 'tiktok'];
    case 'b2b':     return ['linkedin', 'x', 'youtube'];
    case 'health':  return ['instagram', 'tiktok', 'youtube'];
    case 'food':    return ['instagram', 'tiktok', 'youtube'];
    case 'generic': return ['x', 'youtube', 'instagram'];
  }
}

function bannedTopicsForCategory(category: string): string[] {
  // Always banned regardless of vertical.
  const universal = ['politics', 'religion', 'tragedy'];
  switch (categoryClass(category)) {
    // Regulated finance must avoid these — surfacing trends about them
    // can drag drafts into compliance violations even if the operator
    // doesn't act on them.
    case 'finance': return [...universal, 'investment advice', 'guaranteed returns', 'get rich quick', 'risk-free'];
    case 'health':  return [...universal, 'medical claims', 'cures', 'guaranteed results'];
    default:        return universal;
  }
}
