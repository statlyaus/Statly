import { Pool } from 'pg';

import { runOutcomesPrismaTestCommand } from '../outcomes-integration/outcomesPrismaTestCli';

/** Holds the shared database URL so every file in a worker derives its own database from it. */
export const OUTCOMES_SHARED_DATABASE_URL_KEY = 'STATLY_OUTCOMES_SHARED_TEST_DATABASE_URL';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const PER_FILE_DATABASE_PATTERN = 'statly\\_outcomes\\_test\\_%';

/** Refuses anything but the disposable loopback test database the outcomes job provisions. */
export function assertSharedOutcomesTestDatabase(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.pathname !== '/statly_outcomes_test'
  ) {
    throw new Error(
      'Per-file outcomes databases require the disposable loopback statly_outcomes_test database.'
    );
  }
}

export async function withOutcomesAdminPool<Result>(
  databaseUrl: string,
  action: (admin: Pool) => Promise<Result>
): Promise<Result> {
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    return await action(admin);
  } finally {
    await admin.end();
  }
}

/**
 * Roles and role memberships are server-wide, not per database. Migrations and fixtures create fixed
 * role names guarded only against an existing role, so two files creating the same role at once fail
 * with unique_violation. Running every migration once and creating the fixture-only roles before any
 * file starts means parallel files only ever find the roles already there.
 */
export async function prepareSharedOutcomesRoles(sharedUrl: string): Promise<void> {
  const warmUpDatabase = `statly_outcomes_test_0_${Date.now()}`;
  const warmUpUrl = new URL(sharedUrl);
  warmUpUrl.pathname = `/${warmUpDatabase}`;
  warmUpUrl.searchParams.set('schema', 'outcomes_role_warm_up');

  await withOutcomesAdminPool(sharedUrl, (admin) =>
    admin.query(`CREATE DATABASE "${warmUpDatabase}"`)
  );
  try {
    runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: warmUpUrl.toString() });
    await withOutcomesAdminPool(sharedUrl, (admin) =>
      admin.query(`DO $roles$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afl_trade_nonproduction_governance_registry_writer') THEN
          CREATE ROLE afl_trade_nonproduction_governance_registry_writer NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afl_trade_nonproduction_spell_metric_policy_reviewer') THEN
          CREATE ROLE afl_trade_nonproduction_spell_metric_policy_reviewer NOLOGIN;
        END IF;
        GRANT afl_trade_nonproduction_spell_metric_policy_reviewer TO CURRENT_USER;
        GRANT afl_trade_private_evaluation_coordinator TO CURRENT_USER;
        GRANT afl_trade_current_valuation_refresh_owner TO CURRENT_USER;
      END $roles$`)
    );
  } finally {
    await withOutcomesAdminPool(sharedUrl, (admin) =>
      admin.query(`DROP DATABASE IF EXISTS "${warmUpDatabase}" WITH (FORCE)`)
    );
  }
}

/** Drops per-file databases a crashed or interrupted file left behind. */
export async function dropLeftoverOutcomesDatabases(sharedUrl: string): Promise<void> {
  await withOutcomesAdminPool(sharedUrl, async (admin) => {
    const leftovers = await admin.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE $1`,
      [PER_FILE_DATABASE_PATTERN]
    );
    for (const { datname } of leftovers.rows) {
      await admin.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    }
  });
}
