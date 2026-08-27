// Request and verify a one-time code.
//
// POST   issues a code and emails it.
// PUT    verifies a submitted code and, on success, opens the step-up window.
//
// Both require an authenticated session. This is a second factor and a step-up
// gate, not a way in: it proves the person holding the session is the account
// holder, so there is nothing here to reach without already being signed in.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { issueOtp, verifyOtp, verifyFailureMessage, OtpRateLimitError, OTP_TTL_MINUTES, type OtpPurpose } from '@/lib/auth/otp';
import { getMailer, otpMessage, isMailConfigured, MailNotConfiguredError } from '@/lib/auth/mailer';
import { grantStepUp, stepUpSecondsRemaining } from '@/lib/auth/step-up';
import { logAudit } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parsePurpose(v: unknown): OtpPurpose {
  return v === 'login' ? 'login' : 'step_up';
}

/** Issue a code and send it. */
export async function POST(req: NextRequest) {
  const ctx = await getCurrentContext();
  if (!ctx?.user || !ctx.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!isMailConfigured()) {
    // Explicit rather than a generic failure: an admin who cannot receive a
    // code is locked out of deleting, and needs to know why immediately.
    return NextResponse.json({
      error: 'mail_not_configured',
      message: 'Email is not set up, so codes cannot be sent. Set SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM.',
    }, { status: 503 });
  }

  const body = await req.json().catch(() => ({})) as { purpose?: string };
  const purpose = parsePurpose(body.purpose);

  try {
    const { code, expiresAt } = await issueOtp(
      ctx.user.id,
      purpose,
      req.headers.get('x-forwarded-for') ?? undefined,
    );

    const mailer = await getMailer();
    await mailer.send({ to: ctx.user.email, ...otpMessage(code, purpose, OTP_TTL_MINUTES) });

    await logAudit({
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: 'auth.otp_sent',
      target: purpose,
    });

    // The code is never returned to the caller. It exists only in the email,
    // which is the entire point of a second factor.
    return NextResponse.json({
      sent: true,
      // Masked, so the user can tell which mailbox to check without the
      // response exposing a full address to anything reading the network.
      to: maskEmail(ctx.user.email),
      expiresAt: expiresAt.toISOString(),
      expiresInMinutes: OTP_TTL_MINUTES,
    });
  } catch (e) {
    if (e instanceof OtpRateLimitError) {
      return NextResponse.json({ error: 'rate_limited', message: e.message }, { status: 429 });
    }
    if (e instanceof MailNotConfiguredError) {
      return NextResponse.json({ error: 'mail_not_configured', message: e.message }, { status: 503 });
    }
    // Delivery failed. Say so plainly: a silent failure here reads to the user
    // as "the code never arrived", and they retry until rate-limited.
    return NextResponse.json({
      error: 'send_failed',
      message: `Could not send the code: ${(e as Error).message}`,
    }, { status: 502 });
  }
}

/** Verify a submitted code. */
export async function PUT(req: NextRequest) {
  const ctx = await getCurrentContext();
  if (!ctx?.user || !ctx.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { code?: string; purpose?: string };
  const code = String(body.code ?? '').trim();
  const purpose = parsePurpose(body.purpose);

  if (!/^\d{6}$/.test(code)) {
    // Shape-checked before touching the database, so malformed input cannot
    // burn a real attempt.
    return NextResponse.json({ error: 'invalid', message: 'Enter the 6-digit code.' }, { status: 400 });
  }

  const result = await verifyOtp(ctx.user.id, purpose, code);

  if (!result.ok) {
    await logAudit({
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: 'auth.otp_failed',
      target: purpose,
      meta: { reason: result.reason },
    });
    // One message for every failure mode. Distinguishing "expired" from
    // "wrong" tells an attacker whether a code was ever live.
    return NextResponse.json({ error: 'invalid', message: verifyFailureMessage(result) }, { status: 400 });
  }

  await grantStepUp();
  await logAudit({
    orgId: ctx.org.id,
    userId: ctx.user.id,
    action: 'auth.otp_verified',
    target: purpose,
  });

  return NextResponse.json({
    verified: true,
    // So the UI can show how long the authorisation lasts rather than failing
    // unexpectedly when it lapses mid-task.
    windowSeconds: await stepUpSecondsRemaining(),
  });
}

/** j***n@company.com — enough to identify the mailbox, not to harvest it. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const head = local.slice(0, 1);
  const tail = local.length > 1 ? local.slice(-1) : '';
  return `${head}${'*'.repeat(Math.max(1, local.length - 2))}${tail}@${domain}`;
}
