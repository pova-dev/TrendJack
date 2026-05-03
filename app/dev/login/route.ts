// DEV-ONLY: bootstrap a demo POVA account in one HTTP GET.
// - Creates user demo@pova.local + POVA org + POVA brand (if missing)
// - Seeds 16 mock trends
// - Sets the iron-session cookie
// - Redirects to /
//
// Disabled in production. Useful for local demos and end-to-end tests.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { getSession } from '@/lib/auth/session';
import { DEFAULT_WEIGHTS } from '@/types';
import { seedTrendsForBrand } from '@/lib/seed';

export async function GET(_req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'disabled_in_prod' }, { status: 403 });
  }

  const email = 'demo@pova.local';
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, name: 'Demo Operator', passwordHash: await hashPassword('demo12345') },
    });
  }

  let membership = await prisma.membership.findFirst({ where: { userId: user.id }, include: { org: { include: { brands: true } } } });
  if (!membership) {
    const org = await prisma.organization.create({ data: { name: 'POVA Marketing', slug: `pova-${Math.random().toString(36).slice(2, 6)}` } });
    membership = await prisma.membership.create({
      data: { userId: user.id, orgId: org.id, role: 'owner' },
      include: { org: { include: { brands: true } } },
    });
  }

  let brand = membership.org.brands[0];
  if (!brand) {
    brand = await prisma.brand.create({
      data: {
        orgId: membership.org.id,
        name: 'POVA',
        category: 'Smartphones / consumer tech',
        markets: JSON.stringify(['India', 'SEA', 'MEA']),
        audience: JSON.stringify({
          primary: ['Gen Z', 'young professionals', 'students', 'gamers', 'creators'],
          age: '18-28',
          psychographics: ['mobile-first', 'value-conscious', 'spec-aware', 'irony-fluent'],
        }),
        tone: JSON.stringify({
          voice: 'Sharp. Direct. Confident. Anti-cliché. Outcome-led, not spec-war.',
          tagline: "Built for What's Next.",
          bannedPhrases: ['unleash your potential', 'best version of yourself', 'level up', 'redefine', 'reimagined', 'limitless', 'dream big', 'game changer'],
          allowedJokes: ['battery', 'thermal', 'thin', 'gaming', 'thumb pain', 'budget', 'flagship killer'],
          forbiddenStyles: ['lifestyle warmth', 'generic corporate tone', 'forced Gen Z slang', 'motivational cliché'],
        }),
        bannedTopics: JSON.stringify(['politics', 'religion', 'caste', 'communal', 'election', 'tragedy', 'lawsuit']),
        // Brand keywords drive the Brand Matches column. These are real
        // POVA product / parent-brand search terms an operator would
        // actually want to track. Tweak via /brand → Brand Keywords.
        brandKeywords: JSON.stringify([
          'pova', 'pova mobile', 'pova phone', 'pova india',
          'pova curve', 'pova 7', 'pova 6', 'pova 5',
          'tecno', 'tecno pova', 'tecno mobile',
        ]),
        safeThemes: JSON.stringify(['battery life', 'gaming', 'thermal', 'design', 'thin', 'curve', 'display', 'performance', 'budget', 'creator', 'speed', 'durability', 'specs', 'smartphone', 'phone']),
        competitors: JSON.stringify(['Xiaomi', 'Realme', 'iQOO', 'Samsung', 'OnePlus', 'Motorola']),
        priorityPlatforms: JSON.stringify(['x', 'youtube', 'reddit', 'tiktok']),
        contentGoal: 'engagement + brand-fit relevance for Gen Z buyers',
        riskTolerance: 'medium',
        approvalMode: 'moderate',
        scoringWeights: JSON.stringify(DEFAULT_WEIGHTS),
      },
    });
    await seedTrendsForBrand(brand.id);
    await prisma.board.create({
      data: {
        brandId: brand.id, ownerId: user.id, name: 'POVA · War Room', shared: true,
        columns: JSON.stringify([
          { id: 'col_brand_matches', type: 'brand_matches', title: 'Brand Matches', refreshSec: 60, filters: { minOpportunity: 45, bannedTopicSafe: true, maxRisk: 0.6 }, sort: { key: 'opportunity', dir: 'desc' } },
          { id: 'col_first_mover', type: 'first_mover_window', title: 'First-Mover Window', refreshSec: 60, filters: { firstMoverOnly: true, minOpportunity: 40 }, sort: { key: 'firstSeenAt', dir: 'desc' } },
          { id: 'col_rising', type: 'rising_trends', title: 'Rising Trends', refreshSec: 60, filters: {}, sort: { key: 'velocity', dir: 'desc' } },
          { id: 'col_competitors', type: 'competitor_activity', title: 'Competitor Activity', refreshSec: 120, filters: { competitorClaimed: true }, sort: { key: 'velocity', dir: 'desc' } },
          { id: 'col_high_velocity', type: 'high_velocity', title: 'High Velocity Posts', refreshSec: 60, filters: {}, sort: { key: 'velocity', dir: 'desc' } },
          { id: 'col_risk_watch', type: 'risk_watch', title: 'Trend Risk Watch', refreshSec: 90, filters: {}, sort: { key: 'risk', dir: 'desc' } },
          { id: 'col_decay', type: 'decay_watch', title: 'Decay Watch', refreshSec: 300, filters: { decay: true }, sort: { key: 'firstSeenAt', dir: 'asc' } },
          { id: 'col_alerts', type: 'alerts', title: 'Alerts', refreshSec: 30, filters: {}, sort: { key: 'firstSeenAt', dir: 'desc' } },
        ]),
      },
    });
  }

  const session = await getSession();
  session.userId = user.id;
  session.orgId = membership.orgId;
  session.brandId = brand.id;
  await session.save();

  return NextResponse.redirect(new URL('/', _req.url));
}
