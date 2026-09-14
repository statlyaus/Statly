import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';

const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!url) throw new Error('Disposable PostgreSQL required.');
const schema = `exact_consumer_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const consumers = [
  'outcome_acquisition_spell_metric',
  'outcome_acquisition_spell_metric_batch',
  'outcome_acquisition_spell_metric_version',
  'outcome_release_acquisition_spell',
  'outcome_valuation_dataset_row',
  'outcome_hpn_pav_calculation_player',
  'outcome_player_pav_observation',
];

// Synthetic rows isolate the shared trigger contract; repository tests cover full admission.
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(`CREATE TABLE outcome_acquisition_spell_version
    (spell_version_id TEXT PRIMARY KEY, registration_canonical_json TEXT)`);
  await pool.query(`INSERT INTO outcome_acquisition_spell_version VALUES
    ('exact', '{"schemaVersion":"afl-trade-acquisition-registration/v1"}'),
    ('window', '{"schemaVersion":"afl-trade-acquisition-registration/v2"}')`);
  await pool.query(
    await readFile(
      'prisma/afl-trade-outcomes/migrations/0206_exact_acquisition_consumer_columns/migration.sql',
      'utf8'
    )
  );
  for (const table of consumers) {
    const column =
      table === 'outcome_valuation_dataset_row'
        ? 'acquisition_spell_version_id'
        : 'spell_version_id';
    await pool.query(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, ${column} TEXT)`);
    await pool.query(`CREATE TRIGGER outcome_exact_acquisition_consumer
      BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW
      EXECUTE FUNCTION require_outcome_exact_acquisition_consumer()`);
  }
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

it.each(consumers)(
  'preserves exact writes and rejects window inserts/updates for %s',
  async (table) => {
    const column =
      table === 'outcome_valuation_dataset_row'
        ? 'acquisition_spell_version_id'
        : 'spell_version_id';
    await pool.query(`INSERT INTO ${table} VALUES (1, 'exact')`);
    await pool.query(`UPDATE ${table} SET ${column}='exact' WHERE id=1`);
    await expect(pool.query(`INSERT INTO ${table} VALUES (2, 'window')`)).rejects.toThrow(
      'Window acquisition requires interval-aware metric and release qualification'
    );
    await expect(pool.query(`UPDATE ${table} SET ${column}='window' WHERE id=1`)).rejects.toThrow(
      'Window acquisition requires interval-aware metric and release qualification'
    );
    expect((await pool.query(`SELECT id,${column} AS spell FROM ${table}`)).rows).toEqual([
      { id: 1, spell: 'exact' },
    ]);
  }
);
