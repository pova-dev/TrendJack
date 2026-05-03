// VAPID configuration for Web Push.
//
// Web Push requires a VAPID key pair so push services (FCM, APNs via
// Mozilla autopush, etc.) can verify the sender. The pair is generated
// once per deployment with `npx web-push generate-vapid-keys` and pinned
// in env:
//
//   PUSH_VAPID_PUBLIC=BL...   (URL-safe base64, ~88 chars)
//   PUSH_VAPID_PRIVATE=...    (URL-safe base64, ~43 chars)
//   PUSH_VAPID_SUBJECT=mailto:ops@trendjack.example
//
// We deliberately fail SOFT here: if no keys are configured the delivery
// worker logs a one-line warning and stays idle. The dashboard still
// runs; users just don't get push notifications. This is the right
// tradeoff during local dev — generating keys per `npm run dev` would
// invalidate every existing browser subscription.

import 'server-only';
import webpush from 'web-push';

interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

let cached: VapidConfig | null | undefined;

export function getVapidConfig(): VapidConfig | null {
  if (cached !== undefined) return cached;

  const publicKey = process.env.PUSH_VAPID_PUBLIC?.trim();
  const privateKey = process.env.PUSH_VAPID_PRIVATE?.trim();
  const subject = process.env.PUSH_VAPID_SUBJECT?.trim() || 'mailto:ops@trendjack.local';

  if (!publicKey || !privateKey) {
    cached = null;
    return null;
  }
  cached = { publicKey, privateKey, subject };
  return cached;
}

/** Lazily configure the web-push singleton with VAPID details. Returns
 *  true when keys are present, false otherwise. Callers should bail when
 *  this returns false instead of attempting deliveries. */
export function ensureVapidConfigured(): boolean {
  const cfg = getVapidConfig();
  if (!cfg) return false;
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  return true;
}

export { webpush };
