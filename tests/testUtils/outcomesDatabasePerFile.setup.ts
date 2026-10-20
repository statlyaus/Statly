import type { Pool } from 'pg';
import { afterAll, inject } from 'vitest';

import { OUTCOMES_TEMPLATE_SCHEMA_KEY } from '../outcomes-integration/outcomesPrismaTestCli';

import {
  OUTCOMES_SHARED_DATABASE_URL_KEY,
  OUTCOMES_TEMPLATE_SCHEMA,
  assertSharedOutcomesTestDatabase,
  withOutcomesAdminPool,
} from './outcomesParallelDatabases';

/**
 * Gives each outcomes integration file its own database so files can run in parallel.
 *
 * The outcomes SQL takes transaction advisory locks keyed by hashtextextended(<text key>, 0) with no
 * schema part, and advisory locks are per database. The fixtures are content-addressed, so two files
 * in different schemas of one database take identical keys and block each other. Separate databases
 * make the keys disjoint.
 *
 * This runs before each file's own module code, which reads AFL_OUTCOMES_TEST_DATABASE_URL at load.
 * A forked worker keeps process.env across files, so the shared URL is remembered under its own key
 * and the file's URL is restored after the file finishes.
 */
const sharedUrl =
  process.env[OUTCOMES_SHARED_DATABASE_URL_KEY] ??
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL?.trim();

if (sharedUrl) {
  assertSharedOutcomesTestDatabase(sharedUrl);
  process.env[OUTCOMES_SHARED_DATABASE_URL_KEY] = sharedUrl;

  const suffix = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  const databaseName = `statly_outcomes_test_${process.pid}_${Date.now()}${suffix}`;
  const fileUrl = new URL(sharedUrl);
  fileUrl.pathname = `/${databaseName}`;

  const runtimeUrlFollowsTestUrl =
    process.env.AFL_OUTCOMES_DATABASE_URL === undefined ||
    process.env.AFL_OUTCOMES_DATABASE_URL.trim() === sharedUrl;

  // Cloned from the migrated template when global setup proved adoption equivalent to a deploy, so
  // the file's first `migrate deploy` adopts the template schema instead of replaying migrations.
  const templateDatabase = inject('outcomesTemplateDatabase');
  await withOutcomesAdminPool(sharedUrl, (admin: Pool) =>
    admin.query(
      templateDatabase
        ? `CREATE DATABASE "${databaseName}" TEMPLATE "${templateDatabase}"`
        : `CREATE DATABASE "${databaseName}"`
    )
  );
  if (templateDatabase) process.env[OUTCOMES_TEMPLATE_SCHEMA_KEY] = OUTCOMES_TEMPLATE_SCHEMA;
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL = fileUrl.toString();
  if (runtimeUrlFollowsTestUrl && process.env.AFL_OUTCOMES_DATABASE_URL !== undefined) {
    process.env.AFL_OUTCOMES_DATABASE_URL = fileUrl.toString();
  }

  // Registered first, so with sequence.hooks 'stack' it runs after the file's own afterAll hooks
  // have closed their pools. FORCE ends any connection a file left open.
  afterAll(async () => {
    delete process.env[OUTCOMES_TEMPLATE_SCHEMA_KEY];
    process.env.AFL_OUTCOMES_TEST_DATABASE_URL = sharedUrl;
    if (runtimeUrlFollowsTestUrl && process.env.AFL_OUTCOMES_DATABASE_URL !== undefined) {
      process.env.AFL_OUTCOMES_DATABASE_URL = sharedUrl;
    }
    await withOutcomesAdminPool(sharedUrl, async (admin: Pool) => {
      // pg Pool.end() resolves before its clients' sockets close. Forcing the drop while one is still
      // closing terminates it, and its 57P01 surfaces as an uncaught error that fails the file
      // (#1034). Wait for the file's own disconnects first; FORCE is only for pools left open.
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const open = await admin.query(
          'SELECT 1 FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
          [databaseName]
        );
        if (open.rowCount === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    });
  });
}
