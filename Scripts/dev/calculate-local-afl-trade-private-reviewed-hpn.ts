import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { assertLocalAflTradeOutcomesRuntimeIdentity } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
import { PostgresAflTradePrivateReviewedHpnCalculationRepository } from '../../src/server/aflTradeIntelligence/modeling/postgresPrivateReviewedHpnCalculationRepository';
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
  throw new Error('Private reviewed HPN calculation requires loopback statly_outcomes_test.');
}
const runtimeNonce = (
  process.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE ??
  (await readFile(resolve(root, '.statly-local/afl-trade-outcomes-runtime-nonce'), 'utf8'))
).trim();
const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  statement_timeout: 180_000,
  application_name: 'statly-local-private-reviewed-hpn-calculation',
});

try {
  await assertLocalAflTradeOutcomesRuntimeIdentity(pool, runtimeNonce);
  const repository = new PostgresAflTradePrivateReviewedHpnCalculationRepository(
    createPgAflOutcomeSqlClient(pool)
  );
  for (let seasonYear = 2021; seasonYear <= 2025; seasonYear += 1) {
    const result = await repository.calculateAndPersist(seasonYear);
    process.stdout.write(
      `${seasonYear}: ${result.calculation.content.allocations.length} player/team allocations, ` +
        `${result.calculation.content.counts.quarantinedAllocations} quarantined, ` +
        `${result.idempotentReplay ? 'verified replay' : 'calculated and persisted'}.\n`
    );
  }
} finally {
  await pool.end();
}
