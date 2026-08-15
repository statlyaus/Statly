import { Pool } from 'pg';

import { AFL_TRADE_LOCAL_OUTCOMES_DATABASE_URL } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntime';
import {
  assertLocalAflTradeOutcomesRuntimeIdentity,
  requireLocalAflTradeOutcomesRuntimeNonce,
} from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';

const expectedNonce = requireLocalAflTradeOutcomesRuntimeNonce(
  process.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE ?? ''
);
const pool = new Pool({
  connectionString:
    process.env.AFL_OUTCOMES_DATABASE_URL ?? AFL_TRADE_LOCAL_OUTCOMES_DATABASE_URL,
  connectionTimeoutMillis: 3_000,
  max: 1,
  statement_timeout: 3_000,
});

try {
  await assertLocalAflTradeOutcomesRuntimeIdentity(
    {
      async query(sql, parameters) {
        const result = await pool.query(sql, parameters);
        return { rows: result.rows as unknown[] };
      },
    },
    expectedNonce
  );
  process.stdout.write('local stack: authenticated the Statly AFL outcomes database process\n');
} finally {
  await pool.end();
}
