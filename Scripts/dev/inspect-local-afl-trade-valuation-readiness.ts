import { Pool } from 'pg';

import { inspectLocalAflTradeValuationReadiness } from '../../src/server/aflTradeIntelligence/development/localAflTradeValuationReadiness';
import { assertLocalAflTradeOutcomesRuntimeIdentity } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function scopeKeyFromArguments(arguments_: readonly string[]): string {
  const scopeIndex = arguments_.indexOf('--scope');
  const value = scopeIndex === -1 ? undefined : arguments_[scopeIndex + 1]?.trim();
  if (!value || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/u.test(value)) {
    throw new TypeError('--scope requires one bounded local valuation scope key.');
  }
  return value;
}

const databaseUrl = process.env.AFL_OUTCOMES_DATABASE_URL?.trim();
const runtimeNonce = process.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE?.trim();
if (!databaseUrl || !runtimeNonce || !/^[a-f0-9]{64}$/u.test(runtimeNonce)) {
  throw new Error('The admitted local outcomes database URL and runtime nonce are required.');
}
const database = new URL(databaseUrl);
if (
  !['postgres:', 'postgresql:'].includes(database.protocol) ||
  !LOOPBACK_HOSTS.has(database.hostname) ||
  database.pathname !== '/statly_outcomes_test'
) {
  throw new Error('Valuation readiness inspection requires disposable loopback PostgreSQL.');
}

const pool = new Pool({
  connectionString: databaseUrl,
  application_name: 'statly-local-valuation-readiness-cli',
  connectionTimeoutMillis: 5_000,
  max: 1,
});
try {
  await assertLocalAflTradeOutcomesRuntimeIdentity(pool, runtimeNonce);
  const readiness = await inspectLocalAflTradeValuationReadiness(pool, {
    scopeKey: scopeKeyFromArguments(process.argv.slice(2)),
  });
  process.stdout.write(`${JSON.stringify(readiness, null, 2)}\n`);
} finally {
  await pool.end();
}
