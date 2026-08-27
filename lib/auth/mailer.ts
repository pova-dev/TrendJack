// Transactional email.
//
// One interface, adapters behind it, chosen by environment. The company SMTP
// server is the primary path because it works with whatever mail infrastructure
// IT already runs, needs no new vendor, and keeps OTP delivery inside the
// corporate domain. Nothing here is coupled to that choice: point the env vars
// at a different relay and it keeps working.
//
// Deliberately NOT a general-purpose mail library. It sends security codes,
// which have a narrow set of requirements: fast, verifiable, and loud when it
// fails. A silently dropped OTP is a locked-out admin.

import 'server-only';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
  describe(): string;
}

export class MailNotConfiguredError extends Error {
  constructor() {
    super(
      'Email is not configured, so one-time codes cannot be delivered. ' +
      'Set SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM.',
    );
    this.name = 'MailNotConfiguredError';
  }
}

/** Read SMTP settings without throwing, so callers can report readiness. */
export function smtpConfig() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM || user;
  const port = Number(process.env.SMTP_PORT) || 587;
  // 465 is implicit TLS; 587 upgrades via STARTTLS. Getting this wrong is the
  // most common reason company SMTP "does not work", so it is derived from the
  // port rather than left to be configured incorrectly.
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  return { host, port, user, pass, from, secure };
}

export function isMailConfigured(): boolean {
  const c = smtpConfig();
  return !!(c.host && c.user && c.pass && c.from);
}

let cached: Mailer | null = null;

export async function getMailer(): Promise<Mailer> {
  if (cached) return cached;

  const c = smtpConfig();
  if (!c.host || !c.user || !c.pass || !c.from) throw new MailNotConfiguredError();

  const nodemailer = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: { user: c.user, pass: c.pass },
    // A hung SMTP connection must not hold an HTTP request open. The user is
    // waiting on a code; failing in seconds and letting them retry beats
    // spinning.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  cached = {
    async send(msg) {
      await transport.sendMail({
        from: c.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      });
    },
    describe() {
      return `smtp ${c.host}:${c.port}${c.secure ? ' (tls)' : ' (starttls)'}`;
    },
  };
  return cached;
}

/** Verify the SMTP settings actually work, for the settings screen. Never
 *  called on the request path. */
export async function verifyMailer(): Promise<{ ok: boolean; detail: string }> {
  try {
    const c = smtpConfig();
    if (!c.host || !c.user || !c.pass || !c.from) {
      return { ok: false, detail: 'SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM must all be set.' };
    }
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: c.host, port: c.port, secure: c.secure,
      auth: { user: c.user, pass: c.pass },
      connectionTimeout: 10_000,
    });
    await transport.verify();
    return { ok: true, detail: `Connected to ${c.host}:${c.port}` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

/**
 * The code email.
 *
 * Plain and specific on purpose. A security code should say what it authorises
 * and how long it lasts, so a code arriving unexpectedly reads as an alarm
 * rather than as noise. No branding, no links: a security email with a link in
 * it trains people to click links in security emails.
 */
export function otpMessage(code: string, purpose: 'login' | 'step_up', minutes: number): Omit<MailMessage, 'to'> {
  const what = purpose === 'login'
    ? 'sign in to TrendJack'
    : 'approve a delete in TrendJack';

  return {
    subject: purpose === 'login'
      ? `${code} is your TrendJack sign-in code`
      : `${code} approves a deletion in TrendJack`,
    text: [
      `Your code is ${code}`,
      '',
      `It lets you ${what} and expires in ${minutes} minutes.`,
      '',
      'If you did not request this, someone has your password. Change it now.',
    ].join('\n'),
    html: [
      '<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;line-height:1.6;color:#14161A">',
      `<p style="margin:0 0 16px">Your code is</p>`,
      `<p style="margin:0 0 16px;font-size:30px;letter-spacing:.18em;font-weight:600">${code}</p>`,
      `<p style="margin:0 0 16px;font-family:system-ui,-apple-system,sans-serif">It lets you ${what} and expires in ${minutes} minutes.</p>`,
      '<p style="margin:0;font-family:system-ui,-apple-system,sans-serif;color:#5C6270">If you did not request this, someone has your password. Change it now.</p>',
      '</div>',
    ].join(''),
  };
}
