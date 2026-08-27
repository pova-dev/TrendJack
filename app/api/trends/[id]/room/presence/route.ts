// Live Rooms presence — poll-based MVP.
//
// Why poll, not WebSockets? The rest of TrendJack already uses SSE
// for one-way push (lib/realtime/bus). Adding bidirectional WS for a
// presence indicator is over-scoped for the v1 — operators want to
// see "Sam and Priya are looking at this trend right now" with a
// 30-second freshness budget, and a 10s heartbeat gives that with
// zero infra changes.
//
// Storage: in-memory Map keyed by `${trendId}:${userId}`. Presence is
// per-process (so behind a multi-replica deploy, presences split per
// replica), but for the single-replica dev/early-customer setup this
// is correct + fast. Promotion path: Redis SETEX on a Phase 8 deploy.
//
// API
//   POST /api/trends/[id]/room/presence  — heartbeat (writes ping)
//   GET  /api/trends/[id]/room/presence  — list active participants
//
// TTL: 30s. Browser pings every 10s → ≤2 missed pings → drop.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { getTrend } from '@/lib/store';
import { requireCapability, guardErrorResponse } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PresenceEntry {
  userId: string;
  userName: string;
  lastPingAt: number;
}

// Module-scoped Map survives across requests in the same Node process.
// Keys: `${trendId}` → Map<userId, PresenceEntry>. We GC entries older
// than the TTL on every read.
const PRESENCE_TTL_MS = 30_000;
const presenceByTrend: Map<string, Map<string, PresenceEntry>> = new Map();

function activeFor(trendId: string): PresenceEntry[] {
  const bucket = presenceByTrend.get(trendId);
  if (!bucket) return [];
  const now = Date.now();
  const out: PresenceEntry[] = [];
  for (const [userId, entry] of bucket) {
    if (now - entry.lastPingAt > PRESENCE_TTL_MS) {
      bucket.delete(userId);
    } else {
      out.push(entry);
    }
  }
  if (bucket.size === 0) presenceByTrend.delete(trendId);
  return out.sort((a, b) => a.userName.localeCompare(b.userName));
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Permission gate. Deny-by-default: this route mutates state, so it must
  // name the capability it needs. See lib/auth/capabilities.ts.
  try { await requireCapability('room:comment'); }
  catch (e) { const denied = guardErrorResponse(e); if (denied) return denied; throw e; }

  const auth = await getCurrentContext();
  if (!auth?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const trend = await getTrend(id);
  if (!trend || trend.brandId !== auth.brand.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let bucket = presenceByTrend.get(id);
  if (!bucket) {
    bucket = new Map();
    presenceByTrend.set(id, bucket);
  }
  bucket.set(auth.user.id, {
    userId: auth.user.id,
    userName: auth.user.name || auth.user.email || auth.user.id.slice(0, 8),
    lastPingAt: Date.now(),
  });

  return NextResponse.json({ ok: true, participants: activeFor(id) });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentContext();
  if (!auth?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const trend = await getTrend(id);
  if (!trend || trend.brandId !== auth.brand.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ participants: activeFor(id) });
}

// DELETE /api/trends/[id]/room/presence — explicit disconnect (sendBeacon
// on tab unload). Best-effort; TTL handles tabs that closed without a
// chance to fire this.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Permission gate. Deny-by-default: this route mutates state, so it must
  // name the capability it needs. See lib/auth/capabilities.ts.
  try { await requireCapability('room:comment'); }
  catch (e) { const denied = guardErrorResponse(e); if (denied) return denied; throw e; }

  const auth = await getCurrentContext();
  if (!auth?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const bucket = presenceByTrend.get(id);
  if (bucket) {
    bucket.delete(auth.user.id);
    if (bucket.size === 0) presenceByTrend.delete(id);
  }
  return NextResponse.json({ ok: true });
}
