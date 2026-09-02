import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { stageLocalAflcaCoachesVotes } from '../../src/server/aflTradeIntelligence/development/localAflcaCoachesVotesStaging';
import { requireLocalAflTradeOutcomesRuntimeNonce } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
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
  throw new Error('AFLCA staging requires disposable loopback statly_outcomes_test.');
}
const runtimeNonce = requireLocalAflTradeOutcomesRuntimeNonce(
  process.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE ??
    (await readFile(resolve(root, '.statly-local/afl-trade-outcomes-runtime-nonce'), 'utf8'))
);
const artifactRoot =
  process.env.AFL_TRADE_LOCAL_ARTIFACT_ROOT ?? resolve(root, '.statly-local/afl-trade-artifacts');
const pool = new Pool({ connectionString: databaseUrl, max: 2, statement_timeout: 240_000 });

try {
  const result = await stageLocalAflcaCoachesVotes(createPgAflOutcomeSqlClient(pool), {
    artifactRootDirectory: resolve(artifactRoot, 'aflca-coaches-votes'),
    expectedRuntimeNonce: runtimeNonce,
  });
  process.stdout.write(
    `Retained ${result.captures.length} private AFLCA coaches-votes captures for ` +
      `${result.captures.map(({ seasonYear }) => seasonYear).join('-')}. ` +
      `Player-contribution evaluation remains blocked (${result.readiness.blockerCode}): ` +
      `${result.readiness.requiredRemedy}\n`
  );
} finally {
  await pool.end();
}
