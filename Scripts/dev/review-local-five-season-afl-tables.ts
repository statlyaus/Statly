import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { reviewLocalFiveSeasonAflTablesEvidence } from '../../src/server/aflTradeIntelligence/development/localFiveSeasonAflTablesReview';
import { assertLocalAflTradeOutcomesRuntimeIdentity } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
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
  throw new Error('The five-season review requires loopback statly_outcomes_test.');
}
const runtimeNonce = (
  process.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE ??
  (await readFile(resolve(root, '.statly-local/afl-trade-outcomes-runtime-nonce'), 'utf8'))
).trim();
const pool = new Pool({ connectionString: databaseUrl, max: 1, statement_timeout: 120_000 });

try {
  await assertLocalAflTradeOutcomesRuntimeIdentity(pool, runtimeNonce);
  const evidence = await reviewLocalFiveSeasonAflTablesEvidence(createPgAflOutcomeSqlClient(pool));
  await pool.query('ANALYZE outcome_review_decision');
  process.stdout.write(
    `Reviewed ${evidence.appearanceCount} AFL Tables appearances across ` +
      `${evidence.seasons.join('-')} for private local evaluation; ` +
      `${evidence.exactGoalsAppearanceCount} exact goals rows and ` +
      `${evidence.unavailableGoalsAppearanceCount} quarantined goals rows.\n`
  );
} finally {
  await pool.end();
}
