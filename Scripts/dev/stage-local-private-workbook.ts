import { resolve } from 'node:path';

import { Pool } from 'pg';

import { createLocalAflTradeNonProductionArtifactRepository } from '../../src/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import { assertLocalAflTradeOutcomesRuntimeIdentity } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
import { createPgAflOutcomeSqlClient } from '../../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { loadAflOutcomesDevelopmentWorkbookEvidence } from '../../src/server/aflTradeIntelligence/source/developmentWorkbookLoader';
import { PostgresAflTradePrivateWorkbookStagingService } from '../../src/server/aflTradeIntelligence/source/postgresPrivateWorkbookStagingService';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required.`);
  return value;
}

const databaseUrl = required('AFL_OUTCOMES_DATABASE_URL');
const parsedDatabase = new URL(databaseUrl);
if (
  process.env.NODE_ENV === 'production' ||
  !['postgres:', 'postgresql:'].includes(parsedDatabase.protocol) ||
  !LOOPBACK_HOSTS.has(parsedDatabase.hostname) ||
  parsedDatabase.pathname !== '/statly_outcomes_test'
) {
  throw new TypeError('Private workbook staging requires disposable loopback PostgreSQL.');
}
const runtimeNonce = required('STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE');
if (!/^[a-f0-9]{64}$/u.test(runtimeNonce)) {
  throw new TypeError('STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE is invalid.');
}
const workbookSha256 = required('AFL_OUTCOMES_DEV_WORKBOOK_SHA256').toLowerCase();
if (!/^[a-f0-9]{64}$/u.test(workbookSha256)) {
  throw new TypeError('AFL_OUTCOMES_DEV_WORKBOOK_SHA256 is invalid.');
}

const pool = new Pool({
  connectionString: databaseUrl,
  application_name: 'statly-local-private-workbook-staging',
  connectionTimeoutMillis: 5_000,
  max: 2,
});
try {
  await assertLocalAflTradeOutcomesRuntimeIdentity(pool, runtimeNonce);
  const evidence = await loadAflOutcomesDevelopmentWorkbookEvidence({
    workbookPath: required('AFL_OUTCOMES_DEV_WORKBOOK_PATH'),
    expectedSha256: workbookSha256,
    runtimeEnvironment: process.env.NODE_ENV ?? 'development',
  });
  const rawArtifacts = createLocalAflTradeNonProductionArtifactRepository({
    rootDirectory: resolve(
      process.env.AFL_TRADE_PRIVATE_ARTIFACT_ROOT?.trim() ??
        resolve(process.cwd(), '.statly-local/afl-trade-private-confirmed-artifacts')
    ),
    repositoryId: 'private-workbook-raw-v1',
    artifactClass: 'raw_source',
    maximumObjectBytes: 128 * 1024 * 1024,
  });
  const staged = await new PostgresAflTradePrivateWorkbookStagingService(
    createPgAflOutcomeSqlClient(pool),
    rawArtifacts
  ).stage({
    sourceArtifact: evidence.staging.sourceArtifact,
    sourceBytes: evidence.sourceBytes,
    originalFilename: evidence.staging.originalFilename,
    seasonYears: evidence.staging.partitions.map(({ seasonYear }) => seasonYear),
  });
  process.stdout.write(
    `${JSON.stringify({
      mode: 'private_local_workbook_staging',
      productionAuthority: 'none',
      publicationAuthority: 'none',
      ...staged,
    })}\n`
  );
} finally {
  await pool.end();
}
