import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

import { runOutcomesPrismaTestCommand } from '../outcomes-integration/outcomesPrismaTestCli';

/** Holds the shared database URL so every file in a worker derives its own database from it. */
export const OUTCOMES_SHARED_DATABASE_URL_KEY = 'STATLY_OUTCOMES_SHARED_TEST_DATABASE_URL';

/** The migrated database every per-file database is cloned from, and the schema it holds. */
export const OUTCOMES_TEMPLATE_DATABASE = 'statly_outcomes_template';
export const OUTCOMES_TEMPLATE_SCHEMA = 'outcomes_template';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const PER_FILE_DATABASE_PATTERN = 'statly\\_outcomes\\_test\\_%';
const VERIFY_FRESH_DATABASE = 'statly_outcomes_verify_fresh';
const VERIFY_ADOPTED_DATABASE = 'statly_outcomes_verify_adopted';
const VERIFY_SCHEMA = 'outcomes_verify';
const TEST_UTILS_DIRECTORY = dirname(fileURLToPath(import.meta.url));

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

function databaseUrlFor(sharedUrl: string, database: string, schema?: string): string {
  const url = new URL(sharedUrl);
  url.pathname = `/${database}`;
  if (schema !== undefined) url.searchParams.set('schema', schema);
  return url.toString();
}

async function dropDatabase(sharedUrl: string, database: string): Promise<void> {
  await withOutcomesAdminPool(sharedUrl, async (admin) => {
    const existing = await admin.query<{ datistemplate: boolean }>(
      'SELECT datistemplate FROM pg_database WHERE datname = $1',
      [database]
    );
    if (existing.rows[0]?.datistemplate) {
      await admin.query(
        `ALTER DATABASE "${database}" WITH IS_TEMPLATE false ALLOW_CONNECTIONS true`
      );
    }
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  });
}

/**
 * Roles and role memberships are server-wide, not per database. Migrations and fixtures create fixed
 * role names guarded only against an existing role, so two files creating the same role at once fail
 * with unique_violation. Building the template runs every migration once, which creates the migration
 * roles; the fixture-only roles and memberships are created here, before any file starts.
 */
async function prepareSharedOutcomesRoles(sharedUrl: string): Promise<void> {
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
}

/** Every definition, privilege and row count in one schema, as comparable text. */
async function describeSchema(databaseUrl: string, schema: string): Promise<string[]> {
  return withOutcomesAdminPool(databaseUrl, async (admin) => {
    const items = await admin.query<{ item: string }>(
      `WITH s AS (SELECT to_regnamespace(quote_ident($1)) AS oid)
       SELECT item FROM (
         SELECT 'schema-acl ' || coalesce(n.nspacl::text, '') AS item FROM pg_namespace n, s WHERE n.oid = s.oid
         UNION ALL
         SELECT 'default-acl ' || d.defaclobjtype::text || ' ' || coalesce(d.defaclacl::text, '')
           FROM pg_default_acl d, s WHERE d.defaclnamespace = s.oid
         UNION ALL
         SELECT 'routine ' || CASE WHEN p.prokind = 'a' THEN p.oid::regprocedure::text
                                   ELSE pg_get_functiondef(p.oid) END
                || ' acl ' || coalesce(p.proacl::text, '') || ' owner ' || pg_get_userbyid(p.proowner)
           FROM pg_proc p, s WHERE p.pronamespace = s.oid
         UNION ALL
         SELECT 'relation ' || c.relname || ' ' || c.relkind::text || ' acl ' || coalesce(c.relacl::text, '')
                || ' rls ' || c.relrowsecurity || ' ' || c.relforcerowsecurity
                || ' owner ' || pg_get_userbyid(c.relowner)
           FROM pg_class c, s WHERE c.relnamespace = s.oid
         UNION ALL
         SELECT 'column ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                || ' ' || a.attnotnull || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
                || ' ' || a.attidentity::text || a.attgenerated::text || ' acl ' || coalesce(a.attacl::text, '')
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN s ON c.relnamespace = s.oid
           LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attnum > 0 AND NOT a.attisdropped
         UNION ALL
         SELECT 'constraint ' || con.conname || ' ' || pg_get_constraintdef(con.oid)
           FROM pg_constraint con, s WHERE con.connamespace = s.oid
         UNION ALL
         SELECT 'index ' || pg_get_indexdef(i.indexrelid)
           FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN s ON c.relnamespace = s.oid
         UNION ALL
         SELECT 'trigger ' || pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text
           FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN s ON c.relnamespace = s.oid
          WHERE NOT t.tgisinternal
         UNION ALL
         SELECT 'view ' || c.relname || ' ' || pg_get_viewdef(c.oid)
           FROM pg_class c, s WHERE c.relnamespace = s.oid AND c.relkind::text IN ('v', 'm')
         UNION ALL
         SELECT 'policy ' || c.relname || '.' || pol.polname || ' ' || pol.polcmd::text || ' ' || pol.polpermissive
                || ' ' || pol.polroles::regrole[]::text
                || ' ' || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
                || ' ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
           FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid JOIN s ON c.relnamespace = s.oid
         UNION ALL
         SELECT 'type ' || t.typname || ' ' || t.typtype::text || ' ' || coalesce(
                  (SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid), '')
           FROM pg_type t, s WHERE t.typnamespace = s.oid
         UNION ALL
         SELECT 'sequence ' || c.relname || ' ' || coalesce(pg_sequence_last_value(c.oid)::text, '')
           FROM pg_class c, s WHERE c.relnamespace = s.oid AND c.relkind::text = 'S'
         UNION ALL
         SELECT 'rows ' || c.relname || ' ' || (xpath('/row/n/text()', query_to_xml(
                  format('SELECT count(*) AS n FROM %I.%I', $1, c.relname), false, true, '')))[1]::text
           FROM pg_class c, s WHERE c.relnamespace = s.oid AND c.relkind::text IN ('r', 'p')
       ) items
       ORDER BY item`,
      [schema]
    );
    const migrations = await admin.query<{ item: string }>(
      `SELECT 'migration ' || migration_name || ' ' || checksum || ' '
              || (finished_at IS NOT NULL) || ' ' || (rolled_back_at IS NULL) || ' ' || applied_steps_count AS item
         FROM "${schema}"._prisma_migrations ORDER BY migration_name`
    );
    return [...items.rows, ...migrations.rows].map((row) => row.item);
  });
}

/**
 * Proves that adopting the template schema produces exactly what a fresh `migrate deploy` produces:
 * deploy into one database, adopt into a clone of the template under the same schema name, and
 * compare every definition, privilege, row count and recorded migration.
 */
async function verifyTemplateAdoption(sharedUrl: string): Promise<string[]> {
  await dropDatabase(sharedUrl, VERIFY_FRESH_DATABASE);
  await dropDatabase(sharedUrl, VERIFY_ADOPTED_DATABASE);
  try {
    await withOutcomesAdminPool(sharedUrl, async (admin) => {
      await admin.query(`CREATE DATABASE "${VERIFY_FRESH_DATABASE}"`);
      await admin.query(
        `CREATE DATABASE "${VERIFY_ADOPTED_DATABASE}" TEMPLATE "${OUTCOMES_TEMPLATE_DATABASE}"`
      );
    });
    runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
      databaseUrl: databaseUrlFor(sharedUrl, VERIFY_FRESH_DATABASE, VERIFY_SCHEMA),
    });
    const adopted = execFileSync(
      process.execPath,
      [
        join(TEST_UTILS_DIRECTORY, 'adoptOutcomesTemplateSchema.mjs'),
        databaseUrlFor(sharedUrl, VERIFY_ADOPTED_DATABASE, VERIFY_SCHEMA),
        OUTCOMES_TEMPLATE_SCHEMA,
      ],
      { encoding: 'utf8', env: { NODE_ENV: 'test', PATH: process.env.PATH } }
    ).trim();
    if (adopted !== 'adopted') return [`adoption returned ${adopted}`];

    const fresh = await describeSchema(
      databaseUrlFor(sharedUrl, VERIFY_FRESH_DATABASE),
      VERIFY_SCHEMA
    );
    const clone = await describeSchema(
      databaseUrlFor(sharedUrl, VERIFY_ADOPTED_DATABASE),
      VERIFY_SCHEMA
    );
    const freshSet = new Set(fresh);
    const cloneSet = new Set(clone);
    return [
      ...fresh.filter((item) => !cloneSet.has(item)).map((item) => `only in fresh deploy: ${item}`),
      ...clone.filter((item) => !freshSet.has(item)).map((item) => `only in adopted: ${item}`),
    ];
  } finally {
    await dropDatabase(sharedUrl, VERIFY_FRESH_DATABASE);
    await dropDatabase(sharedUrl, VERIFY_ADOPTED_DATABASE);
  }
}

/**
 * Migrates the template database once, creates the shared roles, and proves template adoption is
 * equivalent to a real deploy. Returns false, after a CI warning, when it is not; files then replay
 * the migrations themselves as before.
 */
export async function prepareOutcomesTemplate(sharedUrl: string): Promise<boolean> {
  await dropDatabase(sharedUrl, OUTCOMES_TEMPLATE_DATABASE);
  await withOutcomesAdminPool(sharedUrl, (admin) =>
    admin.query(`CREATE DATABASE "${OUTCOMES_TEMPLATE_DATABASE}"`)
  );
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
    databaseUrl: databaseUrlFor(sharedUrl, OUTCOMES_TEMPLATE_DATABASE, OUTCOMES_TEMPLATE_SCHEMA),
  });
  await prepareSharedOutcomesRoles(sharedUrl);
  // No connections may exist while a database is cloned from it, and autovacuum respects this flag.
  await withOutcomesAdminPool(sharedUrl, (admin) =>
    admin.query(
      `ALTER DATABASE "${OUTCOMES_TEMPLATE_DATABASE}" WITH IS_TEMPLATE true ALLOW_CONNECTIONS false`
    )
  );

  const differences = await verifyTemplateAdoption(sharedUrl);
  if (differences.length > 0) {
    console.warn(
      `::warning::Outcomes template adoption differs from a fresh deploy (${differences.length} items); ` +
        `files will replay migrations instead.\n${differences.slice(0, 20).join('\n')}`
    );
    return false;
  }
  return true;
}

/** Drops per-file databases a crashed or interrupted file left behind, and the template. */
export async function dropLeftoverOutcomesDatabases(
  sharedUrl: string,
  options: { includeTemplate: boolean }
): Promise<void> {
  await withOutcomesAdminPool(sharedUrl, async (admin) => {
    const leftovers = await admin.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE $1`,
      [PER_FILE_DATABASE_PATTERN]
    );
    for (const { datname } of leftovers.rows) {
      await admin.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    }
  });
  if (options.includeTemplate) await dropDatabase(sharedUrl, OUTCOMES_TEMPLATE_DATABASE);
}
