import { NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { getCronStatus } from '@/lib/cron';
import { prisma } from '@/lib/db';

// GET /api/cron-status — last ingest run timestamp + summary, plus a count
// of trends in the user's brand created/updated in the last 10 minutes.
// Lets the topbar show "fresh: 2m ago · 7 new in last hour".

export async function GET() {
  const ctx = await getCurrentContext();
  if (!ctx?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const [newLast10, updatedLast10, newLastHour, updatedLastHour] = await Promise.all([
    prisma.trend.count({ where: { brandId: ctx.brand.id, createdAt: { gte: tenMinAgo } } }),
    prisma.trend.count({ where: { brandId: ctx.brand.id, updatedAt: { gte: tenMinAgo }, createdAt: { lt: tenMinAgo } } }),
    prisma.trend.count({ where: { brandId: ctx.brand.id, createdAt: { gte: oneHourAgo } } }),
    prisma.trend.count({ where: { brandId: ctx.brand.id, updatedAt: { gte: oneHourAgo }, createdAt: { lt: oneHourAgo } } }),
  ]);

  return NextResponse.json({
    cron: getCronStatus(),
    newLast10, updatedLast10, newLastHour, updatedLastHour,
  });
}
