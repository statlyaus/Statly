import { Pool } from 'pg';

import { AFL_TRADE_LOCAL_OUTCOMES_DATABASE_URL } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntime';
import { seedLocalAflTradeOutcomeArchive } from '../../src/server/aflTradeIntelligence/development/postgresLocalOutcomeArchiveSeed';
import { createPgAflOutcomeSqlClient } from '../../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';

const pool = new Pool({
  connectionString: process.env.AFL_OUTCOMES_DATABASE_URL ?? AFL_TRADE_LOCAL_OUTCOMES_DATABASE_URL,
  max: 1,
});

try {
  const result = await seedLocalAflTradeOutcomeArchive(createPgAflOutcomeSqlClient(pool));
  process.stdout.write(
    `[local-outcomes] ${result.idempotentReplay ? 'Verified' : 'Activated'} release ${result.releaseId} for trade ${result.tradeId}.\n`
  );
} finally {
  await pool.end();
}
