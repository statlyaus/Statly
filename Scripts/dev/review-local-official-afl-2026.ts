import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { assertLocalAflTradeOutcomesRuntimeIdentity } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
import { reviewLocalOfficialAfl2026SamFlandersEvidence } from '../../src/server/aflTradeIntelligence/development/localOfficialAfl2026Review';
import { createPgAflOutcomeSqlClient } from '../../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';

const root = resolve(import.meta.dirname, '../..');
const databaseUrl = process.env.AFL_OUTCOMES_DATABASE_URL;
if (!databaseUrl) throw new Error('AFL_OUTCOMES_DATABASE_URL is required.');
const parsed = new URL(databaseUrl);
if (
  !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
  !new Set(['127.0.0.1', 'localhost', '::1']).has(parsed.hostname) ||
  parsed.pathname !== '/statly_outcomes_test'
) {
  throw new Error('The official 2026 review requires loopback statly_outcomes_test.');
}
const runtimeNonce = (
  process.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE ??
  (await readFile(resolve(root, '.statly-local/afl-trade-outcomes-runtime-nonce'), 'utf8'))
).trim();
const pool = new Pool({ connectionString: databaseUrl, max: 1, statement_timeout: 10_000 });

try {
  await assertLocalAflTradeOutcomesRuntimeIdentity(pool, runtimeNonce);
  const captures = await pool.query<{
    capture_id: string;
    normalization_run_id: string;
  }>(
    `SELECT capture.capture_id,run.normalization_run_id
       FROM outcome_source_capture capture
       JOIN outcome_provider_normalization_run run USING (capture_id)
      WHERE capture.environment='non_production'
        AND capture.provider='official_afl'
        AND capture.capability_id='official-afl-player-stats'
        AND capture.anchor_season_year=2026
        AND capture.status='staged'
        AND run.finalized_at IS NOT NULL
      ORDER BY capture.captured_at DESC`
  );
  if (captures.rows.length !== 1) {
    throw new Error('The private review requires exactly one retained official AFL 2026 capture.');
  }
  const capture = captures.rows[0]!;
  const evidence = await reviewLocalOfficialAfl2026SamFlandersEvidence(
    createPgAflOutcomeSqlClient(pool),
    capture.capture_id,
    capture.normalization_run_id
  );
  process.stdout.write(
    `Reviewed ${evidence.concludedAppearanceCount} Sam Flanders appearances and ${evidence.goals} goal for private local evaluation.\n`
  );
} finally {
  await pool.end();
}
