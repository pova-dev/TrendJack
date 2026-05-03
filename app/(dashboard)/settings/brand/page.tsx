import * as React from 'react';
import { requireBrand } from '@/lib/auth';
import { getBrand } from '@/lib/store';
import { BrandEditor } from '@/components/brand/BrandEditor';

export default async function BrandSettings() {
  const ctx = await requireBrand();
  const brand = await getBrand(ctx.brand.id);
  if (!brand) return null;
  return (
    <div className="p-6">
      <header className="mb-5 max-w-6xl">
        <h1 className="text-xl font-semibold text-ink-100">Brand Profile</h1>
        <p className="text-sm text-ink-300">
          Voice, keywords, topics, audience, operating posture. Autosaves and
          rescores trends across your war room when anything changes.
        </p>
      </header>
      <BrandEditor initial={brand} />
    </div>
  );
}
