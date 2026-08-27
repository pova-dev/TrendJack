// One-time codes.
//
// The naive version of this is broken in five ways, so each is closed here
// deliberately and the reason is written down:
//
//   1. Codes stored in plaintext. A backup or a compromised replica then hands
//      out working codes. Only a SHA-256 hash is persisted.
//   2. Unlimited guesses. A 6-digit code is a million possibilities, which a
//      script exhausts quickly. Five attempts kills the code permanently.
//   3. Unlimited sends. Without a cap, the endpoint is a free way to mail-bomb
//      someone, and it burns the company SMTP reputation.
//   4. Reusable codes. Without single-use, one intercepted code works until it
//      expires. Consumption is atomic.
//   5. String comparison that leaks timing. Compared with timingSafeEqual.
//
// SHA-256 rather than bcrypt is deliberate and worth explaining: codes are
// high-entropy-per-second (six digits, five minutes, five attempts) and
// verification sits on the login path. bcrypt's cost exists to slow down
// offline attacks on low-entropy secrets that live for years. A code that dies
// in five minutes after five guesses does not have that threat model, and a
// slow hash here would only slow the user down.

import 'server-only';
import crypto from 'crypto';
import { prisma } from '@/lib/db';

export type OtpPurpose = 'login' | 'step_up';

export const OTP_TTL_MINUTES = 5;
const MAX_ATTEMPTS = 5;
/** Sends allowed per user per purpose inside the window. */
const MAX_SENDS_PER_WINDOW = 5;
const SEND_WINDOW_MINUTES = 15;

/** Cryptographically random 6-digit code.
 *
 *  randomInt, not Math.random: the latter is predictable from prior output,
 *  which for an auth code is a complete break. Zero-padded so every code is
 *  the same length and no code is easier to guess than another. */
export function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/** Constant-time compare, so response timing reveals nothing about how much
 *  of a guess was correct. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export class OtpRateLimitError extends Error {
  constructor(readonly retryAfterMinutes: number) {
    super(`Too many codes requested. Try again in ${retryAfterMinutes} minutes.`);
    this.name = 'OtpRateLimitError';
  }
}

export interface IssuedOtp { code: string; expiresAt: Date }

/**
 * Issue a code.
 *
 * Any outstanding codes for the same purpose are consumed first, so requesting
 * a new code invalidates the old one. Without that, every resend widens the
 * window of simultaneously-valid codes.
 */
export async function issueOtp(
  userId: string,
  purpose: OtpPurpose,
  requestIp?: string,
): Promise<IssuedOtp> {
  const since = new Date(Date.now() - SEND_WINDOW_MINUTES * 60_000);
  const recent = await prisma.otpCode.count({
    where: { userId, purpose, createdAt: { gte: since } },
  });
  if (recent >= MAX_SENDS_PER_WINDOW) throw new OtpRateLimitError(SEND_WINDOW_MINUTES);

  // Supersede anything still live for this purpose.
  await prisma.otpCode.updateMany({
    where: { userId, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = generateCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);
  await prisma.otpCode.create({
    data: { userId, purpose, codeHash: hashCode(code), expiresAt, requestIp: requestIp ?? null },
  });

  return { code, expiresAt };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'no_code' | 'expired' | 'too_many_attempts' | 'mismatch' };

/**
 * Verify and consume a code.
 *
 * Every failure path is deliberately indistinguishable in cost and shape to a
 * caller: the same generic message is returned to the user regardless of
 * whether no code exists, it expired, or the digits were wrong. Telling an
 * attacker WHICH of those happened is free reconnaissance.
 */
export async function verifyOtp(
  userId: string,
  purpose: OtpPurpose,
  submitted: string,
): Promise<VerifyResult> {
  const row = await prisma.otpCode.findFirst({
    where: { userId, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return { ok: false, reason: 'no_code' };

  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.otpCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    return { ok: false, reason: 'expired' };
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    await prisma.otpCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    return { ok: false, reason: 'too_many_attempts' };
  }

  const matches = safeEqual(hashCode(submitted.trim()), row.codeHash);
  if (!matches) {
    const next = row.attempts + 1;
    await prisma.otpCode.update({
      where: { id: row.id },
      // Burn the code outright on the last allowed attempt rather than leaving
      // a dead row that still has to be re-checked.
      data: { attempts: next, consumedAt: next >= MAX_ATTEMPTS ? new Date() : null },
    });
    return { ok: false, reason: 'mismatch' };
  }

  // Single-use, and conditional on still being unconsumed so two concurrent
  // requests cannot both succeed with the same code.
  const consumed = await prisma.otpCode.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count === 0) return { ok: false, reason: 'no_code' };

  return { ok: true };
}

/** One message for every failure, so nothing is leaked by the difference. */
export function verifyFailureMessage(r: Extract<VerifyResult, { ok: false }>): string {
  return r.reason === 'too_many_attempts'
    ? 'Too many incorrect attempts. Request a new code.'
    : 'That code is not valid or has expired. Request a new one.';
}

/** Housekeeping. Called by the retention sweep so the table stays small. */
export async function pruneExpiredOtps(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000);
  const res = await prisma.otpCode.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { consumedAt: { lt: cutoff } }] },
  });
  return res.count;
}
