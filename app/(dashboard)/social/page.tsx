import * as React from 'react';
import { requireBrand } from '@/lib/auth';
import { getBrand, listBrandsForOrg } from '@/lib/store';
import { getOrgCredentials } from '@/lib/credentials';
import { prisma } from '@/lib/db';
import { TopBar } from '@/components/shell/TopBar';
import { listAccounts } from '@/lib/social/store';
import { buildDailyBrief, type AccountSeries } from '@/lib/social/analytics';
import { SocialDashboard } from '@/components/social/SocialDashboard';
import { IntelligencePanel } from '@/components/social/IntelligencePanel';
import type { SocialPlatform } from '@/lib/social/types';

export const dynamic = 'force-dynamic';

// Readings per account. 7 days at 15 minutes is ~672; 200 covers the window at
// far more resolution than any of these metrics needs, and keeps the payload
// small enough that the page renders in one pass.
const MAX_SAMPLES = 200;

export default async function SocialPage() {
  const ctx = await requireBrand();
  const brand = await getBrand(ctx.brand.id);
  if (!brand) return null;

  const [brands, accounts, creds, raw] = await Promise.all([
    listBrandsForOrg(ctx.org!.id),
    listAccounts(brand.id),
    getOrgCredentials(ctx.org!.id),
    prisma.socialAccount.findMany({
      where: { brandId: brand.id, active: true },
      include: {
        samples: { orderBy: { sampledAt: 'desc' }, take: MAX_SAMPLES },
        posts: { where: { isLatest: true }, take: 1 },
      },
    }),
  ]);

  // Everything the intelligence panel shows is computed here, server side, so
  // the page arrives complete. The model-written narrative loads afterwards
  // and never blocks numbers that are already correct.
  const series: AccountSeries[] = raw.map(a => ({
    accountId: a.id,
    platform: a.platform as SocialPlatform,
    handle: a.handle,
    label: a.competitorName || a.displayName || a.handle,
    isOwn: a.isOwn,
    samples: [...a.samples].reverse().map(s => ({
      at: s.sampledAt, followers: Number(s.followers), postCount: s.postCount,
    })),
    latestPost: a.posts[0]
      ? {
          likes: Number(a.posts[0].likes),
          views: Number(a.posts[0].views),
          commentCount: a.posts[0].commentCount,
          postedAt: a.posts[0].postedAt,
        }
      : null,
  }));

  const brief = buildDailyBrief(series, 7);
  const historyByAccount = Object.fromEntries(
    series.map(s => [s.accountId, s.samples.map(p => p.followers)]),
  );

  const configured = {
    apify: !!creds.APIFY_TOKEN,
    youtube: !!(creds.YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY),
    meta: !!(creds.META_ACCESS_TOKEN || creds.INSTAGRAM_ACCESS_TOKEN || creds.FACEBOOK_ACCESS_TOKEN),
  };
  const aiAvailable = !!(creds.ANTHROPIC_API_KEY || creds.OPENAI_API_KEY
    || creds.GOOGLE_API_KEY || creds.OPENROUTER_API_KEY
    || process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY);

  return (
    <>
      <TopBar
        brand={{ id: brand.id, name: brand.name, category: brand.category, crisisMode: brand.crisisMode }}
        brands={brands.map(b => ({ id: b.id, name: b.name, category: b.category, crisisMode: b.crisisMode }))}
        trendCount={accounts.length}
        postNowCount={brief.opportunities.length}
      />
      <div className="flex-1 overflow-y-auto">
        {/* pb-24 clears the floating AI co-pilot pill, which otherwise sits on
            top of the last table row on desktop and covers a whole opportunity
            card on a phone. */}
        <div className="p-4 sm:p-6 pb-24 max-w-[1400px] mx-auto">
          <header className="mb-6">
            <h1 className="text-lg sm:text-xl font-semibold text-ink-100 mb-1">Social intelligence</h1>
            <p className="text-sm text-ink-300">
              Where {brand.name} stands against its competitors, and what to do about it.
            </p>
          </header>

          {brief.rows.length > 0 && (
            <div className="mb-7 sm:mb-9">
              <IntelligencePanel
                initialBrief={brief}
                aiAvailable={aiAvailable}
                historyByAccount={historyByAccount}
              />
            </div>
          )}

          <SocialDashboard initial={accounts} configured={configured} />
        </div>
      </div>
    </>
  );
}
