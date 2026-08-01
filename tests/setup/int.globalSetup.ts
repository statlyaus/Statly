import { execSync } from 'node:child_process';

export default function setupIntegrationDatabase(): void {
  const testDatabaseUrl = process.env.DATABASE_URL_TEST;

  if (!testDatabaseUrl) {
    throw new Error('DATABASE_URL_TEST must be set before running integration tests');
  }

  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
    },
  });
}
