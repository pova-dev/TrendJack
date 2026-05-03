// Credential resolver. Order:
//   1. Org-level Credential row (DB, AES-GCM encrypted)
//   2. process.env fallback (legacy / dev convenience)
//
// We cache the resolved org credential set per orgId for ~30s. Cache is
// invalidated on every save/delete (caller must call invalidate(orgId)).
//
// Connectors and AI provider receive an `OrgCredentials` object — a plain
// Record<string, string> — at call time, so no module-level state leaks
// between orgs.

import 'server-only';
import { prisma } from './db';
import { decrypt, encrypt } from './security/crypto';

export type OrgCredentials = Record<string, string>;

export type CredScope = 'connector' | 'ai' | 'research' | 'integration';

interface CacheEntry { creds: OrgCredentials; expiresAt: number }
const cache = new Map<string, CacheEntry>();
const TTL_MS = 30_000;

export async function getOrgCredentials(orgId: string): Promise<OrgCredentials> {
  const hit = cache.get(orgId);
  if (hit && hit.expiresAt > Date.now()) return hit.creds;

  const rows = await prisma.credential.findMany({ where: { orgId } });
  const creds: OrgCredentials = {};
  for (const r of rows) {
    try { creds[r.key] = decrypt(r.value); }
    catch { /* swallow — corrupt rows are skipped, never leak ciphertext */ }
  }
  cache.set(orgId, { creds, expiresAt: Date.now() + TTL_MS });
  return creds;
}

/**
 * Returns the value for `key` for an org, falling back to process.env.
 * Use this in connectors / AI provider when you have orgId in context.
 */
export async function getCred(orgId: string | undefined, key: string): Promise<string | undefined> {
  if (orgId) {
    const c = await getOrgCredentials(orgId);
    if (c[key]) return c[key];
  }
  return process.env[key];
}

/**
 * Resolve a value purely from a passed-in credential bag (preferred when
 * inside a connector that already received `opts.credentials`).
 */
export function pickCred(creds: OrgCredentials | undefined, key: string): string | undefined {
  return (creds && creds[key]) || process.env[key];
}

export interface CredentialUpsert {
  orgId: string;
  scope: CredScope;
  key: string;
  value: string;
}

export async function upsertCredential({ orgId, scope, key, value }: CredentialUpsert) {
  await prisma.credential.upsert({
    where: { orgId_scope_key: { orgId, scope, key } },
    create: { orgId, scope, key, value: encrypt(value) },
    update: { value: encrypt(value) },
  });
  cache.delete(orgId);
}

export async function deleteCredential(orgId: string, scope: CredScope, key: string) {
  await prisma.credential.deleteMany({ where: { orgId, scope, key } });
  cache.delete(orgId);
}

export async function listCredentials(orgId: string) {
  const rows = await prisma.credential.findMany({
    where: { orgId },
    orderBy: [{ scope: 'asc' }, { key: 'asc' }],
  });
  // Never echo decrypted values back — only "set" flag + last 3 chars.
  return rows.map(r => {
    let mask = '';
    try { const v = decrypt(r.value); mask = v.length <= 6 ? '••••' : v.slice(0, 3) + '••••' + v.slice(-3); }
    catch { mask = '(corrupt)'; }
    return { id: r.id, scope: r.scope, key: r.key, mask, updatedAt: r.updatedAt.toISOString() };
  });
}

export function invalidateCache(orgId: string) { cache.delete(orgId); }
