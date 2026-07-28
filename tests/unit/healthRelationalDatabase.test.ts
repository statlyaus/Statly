import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: {} }));
vi.mock('@/lib/redis', () => ({ redisClient: {} }));
vi.mock('@/lib/metrics', () => ({ metricsCollector: {} }));

import { checkRelationalDatabase } from '@/server/health/relationalDatabaseHealth';

describe('health relational database probe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports a successful read-only Prisma probe', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([{ result: 1 }]);

    await expect(checkRelationalDatabase()).resolves.toMatchObject({
      status: 'healthy',
      responseTime: expect.any(Number),
      lastChecked: expect.any(String),
    });
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith('SELECT 1');
  });

  it('reports failures and redacts the production error', async () => {
    prisma.$queryRawUnsafe.mockRejectedValue(new Error('password leaked by driver'));

    await expect(checkRelationalDatabase()).resolves.toMatchObject({
      status: 'unhealthy',
      error: 'password leaked by driver',
    });

    vi.stubEnv('NODE_ENV', 'production');
    await expect(checkRelationalDatabase()).resolves.toMatchObject({
      status: 'unhealthy',
      error: 'Relational database connectivity issue',
    });
  });

  it('includes Prisma in both health aggregation and critical readiness', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/health/route.ts'), 'utf8');

    expect(source.match(/checkRelationalDatabase\(\)/g)).toHaveLength(2);
    expect(source).toContain(
      'const criticalServices = [database, relationalDatabase, metricsCheck]'
    );
    expect(source).toContain('relationalDatabase: relationalDatabase.status');
  });
});
