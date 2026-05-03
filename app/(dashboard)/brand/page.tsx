import * as React from 'react';
import { requireBrand } from '@/lib/auth';
import { getBrand, listBrandsForOrg } from '@/lib/store';
import { TopBar } from '@/components/shell/TopBar';
import { BrandEditor } from '@/components/brand/BrandEditor';

export default async function BrandPage() {
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
      <div className="flex-1 overflow-y-auto p-6">
        <header className="mb-5">
          <h1 className="text-xl font-semibold text-ink-100">{brand.name} · brand voice</h1>
          <p className="text-sm text-ink-300">Edit anything. Autosaves. Other teammates see your changes live.</p>
        </header>
        <BrandEditor initial={brand} />
      </div>
    </>
  );
}
