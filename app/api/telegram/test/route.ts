import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { tgSendDirect } from '@/lib/integrations/telegram';
import { requireCapability, guardErrorResponse } from '@/lib/auth/guard';

export async function POST(req: NextRequest) {
  // Permission gate. Deny-by-default: this route mutates state, so it must
  // name the capability it needs. See lib/auth/capabilities.ts.
  try { await requireCapability('credential:write'); }
  catch (e) { const denied = guardErrorResponse(e); if (denied) return denied; throw e; }

  const ctx = await getCurrentContext();
  if (!ctx?.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json();
  if (!body.botToken || !body.defaultChatId) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }
  const r = await tgSendDirect(body.botToken, body.defaultChatId, {
    text: '<b>✅ TrendJack connected.</b>\nYou will now receive trend alerts here.',
    parseMode: 'HTML',
  });
  return NextResponse.json(r);
}
