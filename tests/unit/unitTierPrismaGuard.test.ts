import { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';

// The unit setup keeps the native query engine out of Vitest workers (#809).
describe('unit-tier Prisma guard', () => {
  it('refuses to construct a PrismaClient', () => {
    expect(() => new PrismaClient()).toThrow(/must not construct a PrismaClient/);
  });

  it('gives modules a shared client that throws on first use', () => {
    expect(() => prisma.league).toThrow(/must not use the shared Prisma client \(prisma\.league\)/);
  });

  it('stays inspectable by matchers and await', async () => {
    expect(prisma).toBeDefined();
    await expect(Promise.resolve(prisma)).resolves.toBe(prisma);
  });
});
