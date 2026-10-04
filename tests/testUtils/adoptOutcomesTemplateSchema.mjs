// Adopts the already-migrated template schema of a per-file outcomes test database as the schema a
// test asked `prisma migrate deploy` to create, instead of replaying the full migration history.
//
// Usage: node adoptOutcomesTemplateSchema.mjs <database-url-with-?schema=target> <template-schema>
// Prints `adopted` or `skipped`. `skipped` means the caller must run the real `migrate deploy`.
//
// The per-file database is a CREATE DATABASE ... TEMPLATE clone, so it already holds one migrated
// copy of the outcomes schema. Objects reference each other by OID, so renaming the schema keeps
// tables, views, triggers, grants and policies intact. The one thing migrations store by name is
// each function's `SET search_path TO <schema>, ...` setting, which is rewritten to the new name, and
// a few function bodies that migrations rebuilt with the schema name as literal text (for example
// 0135's `%I.outcome_provider_fact_batch%ROWTYPE`), which are re-created with the new name the same
// way those migrations created them.
// Global setup proves the result matches a real deploy before enabling this path.
import pg from 'pg';

const [databaseUrl, templateSchema] = process.argv.slice(2);
if (!databaseUrl || !templateSchema) {
  throw new Error('A database URL with ?schema= and the template schema name are required.');
}

/** quote_ident: bare when PostgreSQL would print it bare, so stored text matches a fresh deploy. */
function quoteIdentifier(name) {
  return /^[a-z_][a-z0-9_$]*$/u.test(name) ? name : pg.escapeIdentifier(name);
}

const url = new URL(databaseUrl);
const target = url.searchParams.get('schema');
if (!target) throw new Error('The deploy URL names no target schema.');
url.searchParams.delete('schema');

const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
let adopted = false;
try {
  await client.query('BEGIN');
  const state = await client.query(
    `SELECT
       to_regnamespace(quote_ident($1)) IS NOT NULL AS has_template,
       to_regnamespace(quote_ident($2)) IS NOT NULL AS has_target,
       (SELECT count(*) FROM pg_class WHERE relnamespace = to_regnamespace(quote_ident($2))) AS relations,
       (SELECT count(*) FROM pg_proc WHERE pronamespace = to_regnamespace(quote_ident($2))) AS routines,
       (SELECT count(*) FROM pg_type WHERE typnamespace = to_regnamespace(quote_ident($2))) AS types,
       (SELECT nspacl IS NULL FROM pg_namespace WHERE nspname = $2) AS default_acl,
       (SELECT count(*) FROM pg_default_acl WHERE defaclnamespace = to_regnamespace(quote_ident($2))) AS default_privileges`,
    [templateSchema, target]
  );
  const row = state.rows[0];
  // Only an absent or untouched empty schema matches what a fresh deploy would start from. Grants
  // made before the deploy would interact with the migrations' own GRANT/REVOKE statements, so any
  // schema ACL or default privilege falls back to the real deploy.
  const untouchedTarget =
    !row.has_target ||
    (Number(row.relations) === 0 &&
      Number(row.routines) === 0 &&
      Number(row.types) === 0 &&
      row.default_acl !== false &&
      Number(row.default_privileges) === 0);

  if (row.has_template && untouchedTarget) {
    if (row.has_target) await client.query(`DROP SCHEMA ${pg.escapeIdentifier(target)}`);
    await client.query(
      `ALTER SCHEMA ${pg.escapeIdentifier(templateSchema)} RENAME TO ${pg.escapeIdentifier(target)}`
    );
    const settings = await client.query(
      `SELECT p.oid::regprocedure::text AS routine, setting
         FROM pg_proc p CROSS JOIN LATERAL unnest(p.proconfig) AS setting
        WHERE p.pronamespace = to_regnamespace(quote_ident($1)) AND setting LIKE 'search_path=%'`,
      [target]
    );
    const quotedTemplate = pg.escapeIdentifier(templateSchema);
    const targetIdentifier = quoteIdentifier(target);
    for (const { routine, setting } of settings.rows) {
      const entries = setting.slice('search_path='.length).split(/,\s*/u);
      if (!entries.some((entry) => entry === templateSchema || entry === quotedTemplate)) continue;
      const rewritten = entries.map((entry) =>
        entry === templateSchema || entry === quotedTemplate ? targetIdentifier : entry
      );
      await client.query(`ALTER ROUTINE ${routine} SET search_path TO ${rewritten.join(', ')}`);
    }
    // CREATE OR REPLACE keeps the routine's OID, owner, grants and trigger bindings.
    const templateName = new RegExp(
      `(?<![A-Za-z0-9_$"])(?:"${templateSchema}"|${templateSchema})(?![A-Za-z0-9_$"])`,
      'gu'
    );
    const bodies = await client.query(
      `SELECT pg_get_functiondef(p.oid) AS definition
         FROM pg_proc p
        WHERE p.pronamespace = to_regnamespace(quote_ident($1))
          AND p.prokind IN ('f', 'p')
          AND position($2 IN p.prosrc) > 0`,
      [target, templateSchema]
    );
    for (const { definition } of bodies.rows) {
      await client.query(definition.replace(templateName, targetIdentifier));
    }
    await client.query('COMMIT');
    adopted = true;
  } else {
    await client.query('ROLLBACK');
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
process.stdout.write(adopted ? 'adopted' : 'skipped');
