import { beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const testDatabaseUrl = process.env.DATABASE_URL_TEST;
const prisma = testDatabaseUrl
  ? new PrismaClient({
      datasources: { db: { url: testDatabaseUrl } },
    })
  : null;

beforeAll(async () => {
  if (!testDatabaseUrl) {
    return;
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  await import('child_process').then(({ execSync }) =>
    execSync('npx prisma migrate deploy', { stdio: 'inherit' })
  );
});

afterAll(async () => {
  await prisma?.$disconnect();
});
