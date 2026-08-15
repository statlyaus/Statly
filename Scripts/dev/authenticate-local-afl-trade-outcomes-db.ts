import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import {
  installLocalAflTradeOutcomesRuntimeIdentity,
  requireLocalAflTradeOutcomesRuntimeNonce,
} from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';

const root = resolve(import.meta.dirname, '../..');
const noncePath = resolve(root, '.statly-local/afl-trade-outcomes-runtime-nonce');
const databaseUrl = process.env.AFL_OUTCOMES_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('AFL_OUTCOMES_DATABASE_URL is required.');
}
const parsed = new URL(databaseUrl);
if (
  !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
  !new Set(['127.0.0.1', 'localhost', '::1']).has(parsed.hostname) ||
  parsed.pathname !== '/statly_outcomes_test'
) {
  throw new Error('Only loopback PostgreSQL statly_outcomes_test may be authenticated.');
}
const runtimeNonce = requireLocalAflTradeOutcomesRuntimeNonce(
  process.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE ?? randomBytes(32).toString('hex')
);
const pool = new Pool({ connectionString: databaseUrl, max: 1, statement_timeout: 3_000 });

try {
  const identity = await pool.query<{ database_name: string }>(
    'SELECT current_database() AS database_name'
  );
  if (identity.rows[0]?.database_name !== 'statly_outcomes_test') {
    throw new Error('The connected database is not the named disposable outcomes database.');
  }
  await installLocalAflTradeOutcomesRuntimeIdentity(pool, runtimeNonce, process.pid);
  await mkdir(resolve(root, '.statly-local'), { recursive: true });
  await writeFile(noncePath, runtimeNonce, { encoding: 'utf8', flag: 'w', mode: 0o600 });
  process.stdout.write('Authenticated the caller-owned disposable AFL outcomes database.\n');
} finally {
  await pool.end();
}
