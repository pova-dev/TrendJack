import * as React from 'react';
import Link from 'next/link';
import { TopBar } from '@/components/shell/TopBar';
import { requireBrand } from '@/lib/auth';
import { getBrand, listBrandsForOrg } from '@/lib/store';
import { SettingsNav } from '@/components/settings/SettingsNav';

// Unified settings shell: a sidebar on the left listing every config
// section, content on the right. Replaces the previously-scattered
// /brand, /scoring, /connectors, /integrations, /audit pages by giving
// them one home. The old direct routes still exist (and these settings
// pages link to them) so deep-links keep working.

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireBrand();
  const brand = await getBrand(ctx.brand.id);
  if (!brand) return null;
  const brands = await listBrandsForOrg(ctx.org!.id);

  return (
    <>
      <TopBar
        brand={{ id: brand.id, name: brand.name, category: brand.category, crisisMode: brand.crisisMode }}
        brands={brands.map(b => ({ id: b.id, name: b.name, category: b.category, crisisMode: b.crisisMode }))}
        trendCount={0}
        postNowCount={0}
      />
      {/* flex-col on mobile so SettingsNav's mobile chip strip renders
          as a horizontal strip ABOVE content (not as a vertical bar
          to the LEFT, which was Round 4's P0 regression). flex-row
          desktop keeps the original sidebar layout. */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        <SettingsNav />
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </>
  );
}
