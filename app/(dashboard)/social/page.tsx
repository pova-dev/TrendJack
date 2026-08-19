import * as React from 'react';
import { requireBrand } from '@/lib/auth';
import { getBrand, listBrandsForOrg } from '@/lib/store';
import { getOrgCredentials } from '@/lib/credentials';
import { TopBar } from '@/components/shell/TopBar';
import { listAccounts } from '@/lib/social/store';
import { SocialDashboard } from '@/components/social/SocialDashboard';

export const dynamic = 'force-dynamic';

export default async function SocialPage() {
  const ctx = await requireBrand();
  const brand = await getBrand(ctx.brand.id);
  if (!brand) return null;

  const [brands, accounts, creds] = await Promise.all([
    listBrandsForOrg(ctx.org!.id),
    listAccounts(brand.id),
    getOrgCredentials(ctx.org!.id),
  ]);

  // Which data paths are usable. Drives the setup checklist rather than
  // letting a poll fail later with an opaque auth error.
  const configured = {
    apify: !!creds.APIFY_TOKEN,
    youtube: !!(creds.YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY),
    meta: !!(creds.META_ACCESS_TOKEN || creds.INSTAGRAM_ACCESS_TOKEN || creds.FACEBOOK_ACCESS_TOKEN),
  };

  return (
    <>
      <TopBar
        brand={{ id: brand.id, name: brand.name, category: brand.category, crisisMode: brand.crisisMode }}
        brands={brands.map(b => ({ id: b.id, name: b.name, category: b.category, crisisMode: b.crisisMode }))}
        trendCount={accounts.length}
        postNowCount={0}
      />
      <div className="flex-1 overflow-y-auto p-6">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-ink-100 mb-1">Social analytics</h1>
          <p className="text-sm text-ink-300">
            Live follower and engagement tracking for {brand.name} and its competitors.
          </p>
        </header>
        <SocialDashboard initial={accounts} configured={configured} />
      </div>
    </>
  );
}
