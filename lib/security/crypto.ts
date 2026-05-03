// AES-256-GCM credential encryption. The key is derived once via SHA-256
// from SESSION_SECRET. Ciphertext envelope: base64(iv | tag | data).
//
// Why GCM: built-in authentication, no MAC-then-encrypt pitfalls.
// Why derived key: SESSION_SECRET is already the security boundary for
// session cookies; reusing it keeps the secret-management surface small.

import crypto from 'crypto';
import 'server-only';

const SECRET = process.env.SESSION_SECRET || 'dev-only-insecure-secret-please-change-to-32+chars-in-prod';
const KEY = crypto.createHash('sha256').update(SECRET).digest(); // 32 bytes
const IV_LEN = 12;

export function encrypt(plain: string): string {
  if (!plain) return '';
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString('base64');
}

export function decrypt(envelope: string): string {
  if (!envelope) return '';
  const buf = Buffer.from(envelope, 'base64');
  if (buf.length < IV_LEN + 16 + 1) throw new Error('cipher_too_short');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const data = buf.subarray(IV_LEN + 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function maskValue(v: string): string {
  if (!v) return '';
  if (v.length <= 6) return '••••';
  return v.slice(0, 3) + '••••' + v.slice(-3);
}
