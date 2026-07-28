import { prisma } from '@/lib/prisma';

type RelationalDatabaseHealth = {
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime: number;
  error?: string;
  lastChecked: string;
};

export async function checkRelationalDatabase(): Promise<RelationalDatabaseHealth> {
  const start = Date.now();

  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    const responseTime = Date.now() - start;

    return {
      status: responseTime < 1000 ? 'healthy' : 'degraded',
      responseTime,
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      responseTime: Date.now() - start,
      error:
        process.env.NODE_ENV === 'production'
          ? 'Relational database connectivity issue'
          : error instanceof Error
            ? error.message
            : String(error),
      lastChecked: new Date().toISOString(),
    };
  }
}
