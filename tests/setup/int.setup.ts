import { beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const testDatabaseUrl = process.env.DATABASE_URL_TEST;

if (!testDatabaseUrl) {
  throw new Error('DATABASE_URL_TEST must be set before running integration tests');
}

process.env.DATABASE_URL = testDatabaseUrl;

const prisma = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
});

beforeAll(async () => {
  await import('child_process').then(({ execSync }) =>
    execSync('npx prisma migrate deploy', { stdio: 'inherit' })
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
