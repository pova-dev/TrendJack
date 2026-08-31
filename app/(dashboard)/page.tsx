import * as React from 'react';
import { requireBrand } from '@/lib/auth';
import { getBrand } from '@/lib/store';
import { buildTodayBrief } from '@/lib/today';
import { TodayView } from '@/components/today/TodayView';
import { PendingPlansToast } from '@/components/shell/PendingPlansToast';

// The landing view.
//
// The board used to sit here. It surfaces every signal in thirteen columns
// roughly five thousand pixels wide, which is the right tool for an analyst
// digging and the wrong first thing to meet at nine in the morning. Of 6,204
// trends surfaced, three were ever acted on, so the default experience was a
// wall to scroll past rather than a decision to make.
//
// This ranks what the scoring engine already computed and shows the few that
// clear the bar. The board is still one click away at /board, unchanged.

export default async function TodayPage() {
  const ctx = await requireBrand();
  const brand = await getBrand(ctx.brand.id);
  if (!brand) return null;

  const brief = await buildTodayBrief(brand.id);

  return (
    <>
      <TodayView brief={brief} brandName={brand.name} />
      <PendingPlansToast />
    </>
  );
}
