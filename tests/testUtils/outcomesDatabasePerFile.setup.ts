import type { Pool } from 'pg';
import { afterAll } from 'vitest';

import {
  OUTCOMES_SHARED_DATABASE_URL_KEY,
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

  await withOutcomesAdminPool(sharedUrl, (admin: Pool) =>
    admin.query(`CREATE DATABASE "${databaseName}"`)
  );
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL = fileUrl.toString();
  if (runtimeUrlFollowsTestUrl && process.env.AFL_OUTCOMES_DATABASE_URL !== undefined) {
    process.env.AFL_OUTCOMES_DATABASE_URL = fileUrl.toString();
  }

  // Registered first, so with sequence.hooks 'stack' it runs after the file's own afterAll hooks
  // have closed their pools. FORCE ends any connection a file left open.
  afterAll(async () => {
    process.env.AFL_OUTCOMES_TEST_DATABASE_URL = sharedUrl;
    if (runtimeUrlFollowsTestUrl && process.env.AFL_OUTCOMES_DATABASE_URL !== undefined) {
      process.env.AFL_OUTCOMES_DATABASE_URL = sharedUrl;
    }
    await withOutcomesAdminPool(sharedUrl, (admin: Pool) =>
      admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
    );
  });
}
