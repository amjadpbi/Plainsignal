import { PrismaClient } from '@prisma/client';

/**
 * Singleton Prisma client. Next.js dev hot-reload re-evaluates modules, which
 * would otherwise open a new connection pool on every change and exhaust
 * Postgres. Cache the instance on globalThis in non-production.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
