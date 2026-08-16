import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { reviewLocalAflTradeHpnFieldMaps } from '../../src/server/aflTradeIntelligence/development/localHpnFieldMapReview';
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
  throw new Error('HPN field-map review requires loopback statly_outcomes_test.');
}
const runtimeNonce = (
  process.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE ??
  (await readFile(resolve(root, '.statly-local/afl-trade-outcomes-runtime-nonce'), 'utf8'))
).trim();
const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  statement_timeout: 120_000,
  application_name: 'statly-local-hpn-field-map-review',
});

try {
  await assertLocalAflTradeOutcomesRuntimeIdentity(pool, runtimeNonce);
  const result = await reviewLocalAflTradeHpnFieldMaps(createPgAflOutcomeSqlClient(pool), {
    valuationScopeKey: 'workbook:2025',
    fromSeason: 2021,
    throughSeason: 2025,
    reviewerId: 'local-hpn-field-map-reviewer',
  });
  process.stdout.write(
    `Approved ${result.approvals.length} exact HPN projection maps from ` +
      `${result.packet.content.fromSeason}-${result.packet.content.throughSeason} for ` +
      'private local non-production calculation only.\n'
  );
} finally {
  await pool.end();
}
