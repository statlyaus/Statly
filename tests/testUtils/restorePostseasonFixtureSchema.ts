import { execFileSync } from 'node:child_process';
import type { Pool } from 'pg';

/** Destroys and restores only a named synthetic schema in the explicit disposable test database. */
export async function restorePostseasonFixtureSchema(
  admin: Pool,
  databaseUrl: string,
  schema: string
) {
  const url = new URL(databaseUrl);
  const containerId = process.env.AFL_OUTCOMES_TEST_CONTAINER_ID;
  if (
    url.pathname !== '/statly_outcomes_test' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !/^postseason_context_[0-9_]+$/.test(schema) ||
    !containerId ||
    !/^[a-f0-9]{64}$/.test(containerId)
  )
    throw new Error(
      'Postseason restore requires an explicit disposable database, container and synthetic schema.'
    );
  const archive = `/tmp/${schema}.dump`;
  const run = (tool: string, args: string[]) =>
    execFileSync(
      'docker',
      [
        'exec',
        '--env',
        `PGPASSWORD=${decodeURIComponent(url.password)}`,
        containerId,
        tool,
        ...args,
      ],
      { stdio: 'pipe', timeout: 30_000 }
    );
  const connection = [
    '--username',
    decodeURIComponent(url.username),
    '--dbname',
    'statly_outcomes_test',
  ];
  try {
    run('pg_dump', [
      ...connection,
      '--format=custom',
      `--file=${archive}`,
      `--schema=${schema}`,
      '--no-owner',
      '--no-privileges',
    ]);
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    const absent = await admin.query<{ absent: boolean }>(
      'SELECT to_regnamespace($1) IS NULL AS absent',
      [schema]
    );
    if (!absent.rows[0]?.absent)
      throw new Error('Synthetic schema was not removed before restore.');
    run('pg_restore', [
      ...connection,
      '--exit-on-error',
      '--single-transaction',
      '--no-owner',
      '--no-privileges',
      archive,
    ]);
  } finally {
    run('rm', ['-f', archive]);
  }
}
