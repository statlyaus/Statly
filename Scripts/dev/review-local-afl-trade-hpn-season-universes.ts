import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { reviewLocalAflTradeHpnSeasonUniverses } from '../../src/server/aflTradeIntelligence/development/localHpnReviewedSeasonReview';
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
  throw new Error('HPN season review requires loopback statly_outcomes_test.');
}
const runtimeNonce = (
  process.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE ??
  (await readFile(resolve(root, '.statly-local/afl-trade-outcomes-runtime-nonce'), 'utf8'))
).trim();
const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  statement_timeout: 120_000,
  application_name: 'statly-local-hpn-season-review',
});

try {
  await assertLocalAflTradeOutcomesRuntimeIdentity(pool, runtimeNonce);
  const reviewed = await reviewLocalAflTradeHpnSeasonUniverses(
    createPgAflOutcomeSqlClient(pool),
    {
      fromSeason: 2021,
      throughSeason: 2025,
      reviewerId: 'local-hpn-season-reviewer',
    }
  );
  const rowCount = reviewed.reduce(
    (total, season) => total + season.content.counts.sourceRows,
    0
  );
  const matchCount = reviewed.reduce(
    (total, season) => total + season.content.counts.completedMatches,
    0
  );
  const quarantineCount = reviewed.reduce(
    (total, season) => total + season.content.counts.quarantinedIdentityRows,
    0
  );
  process.stdout.write(
    `Approved ${reviewed.length} reviewed HPN seasons containing ${rowCount} exact ` +
      `appearances across ${matchCount} completed matches; ${quarantineCount} ` +
      'unresolved appearances remain explicitly quarantined.\n'
  );
} finally {
  await pool.end();
}
