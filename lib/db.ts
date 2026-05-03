// Prisma client singleton. Used in Phase 2+ once the in-memory store is
// retired. Phase 1 still works without the DB; this file just ensures
// `prisma generate` produces a usable client.

import { PrismaClient } from '@prisma/client';

const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient({ log: ['error', 'warn'] });
if (process.env.NODE_ENV !== 'production') g.prisma = prisma;
