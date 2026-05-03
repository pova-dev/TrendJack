import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { tgSendDirect } from '@/lib/integrations/telegram';

export async function POST(req: NextRequest) {
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
