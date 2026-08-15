import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { AFL_TRADE_LOCAL_OUTCOMES_DATABASE_URL } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntime';
import {
  assertLocalAflTradeOutcomesRuntimeIdentity,
  requireLocalAflTradeOutcomesRuntimeNonce,
} from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
import { createLocalAflTradeArtifactRepository } from '../../src/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import { prepareAndRehearseLocalAflTradeValuationPublication } from '../../src/server/aflTradeIntelligence/development/localAflTradeValuationPublicationRehearsal';
import { seedLocalAflTradeOutcomeArchive } from '../../src/server/aflTradeIntelligence/development/postgresLocalOutcomeArchiveSeed';
import { createPgAflOutcomeSqlClient } from '../../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { AFL_TRADE_PROJECTION_ARTIFACT_READ_RELEASE_MAX_BYTES } from '../../src/server/aflTradeIntelligence/publication/projectionArtifactReadRepository';

const noncePath = resolve(process.cwd(), '.statly-local/afl-trade-outcomes-runtime-nonce');
const configuredNonce = process.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE?.trim();
const expectedNonce = requireLocalAflTradeOutcomesRuntimeNonce(
  configuredNonce === undefined || configuredNonce === ''
    ? await readFile(noncePath, 'utf8')
    : configuredNonce
);

const pool = new Pool({
  connectionString: AFL_TRADE_LOCAL_OUTCOMES_DATABASE_URL,
  connectionTimeoutMillis: 3_000,
  max: 1,
  statement_timeout: 30_000,
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
  const artifactRoot =
    process.env.AFL_TRADE_LOCAL_ARTIFACT_ROOT ??
    resolve(process.cwd(), '.statly-local/afl-trade-artifacts');
  const client = createPgAflOutcomeSqlClient(pool);
  const result = await seedLocalAflTradeOutcomeArchive(client);
  const derivedRepository = createLocalAflTradeArtifactRepository({
    rootDirectory: artifactRoot,
    repositoryId: 'statly-local-afl-trade-derived',
    artifactClass: 'derived_private',
    maximumObjectBytes: 128 * 1024 * 1024,
  });
  const publicProjectionRepository = createLocalAflTradeArtifactRepository({
    rootDirectory: artifactRoot,
    repositoryId: 'statly-local-afl-trade-projections',
    artifactClass: 'public_projection',
    maximumObjectBytes: AFL_TRADE_PROJECTION_ARTIFACT_READ_RELEASE_MAX_BYTES,
  });
  const { lifecycle: valuation } = await prepareAndRehearseLocalAflTradeValuationPublication({
    client,
    factual: result,
    derivedRepository,
    publicProjectionRepository,
  });
  process.stdout.write(
    `[local-outcomes] ${result.idempotentReplay ? 'Verified' : 'Activated'} factual release ${result.releaseId} with ${result.archivedTradeCount} archived trades; governed rehearsal trade ${result.tradeId}.\n` +
      `[local-outcomes] ${valuation.idempotentReplay ? 'Verified' : 'Rehearsed'} synthetic valuation ${valuation.replacementPublicationId} and left it active after rollback and withdrawal proof.\n`
  );
} finally {
  await pool.end();
}
