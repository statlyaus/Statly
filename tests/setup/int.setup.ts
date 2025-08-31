import { beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_TEST! } },
});

if (!process.env.DATABASE_URL_TEST) {
  throw new Error('Missing DATABASE_URL_TEST for integration tests');
}

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  await import('child_process')
    .then(({ execSync }) =>
      execSync('npx prisma migrate deploy', { stdio: 'inherit' })
    );
});

afterAll(async () => {
  await prisma.$disconnect();
});
