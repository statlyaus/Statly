import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { createLocalAflTradePrivateDerivedArtifactRepository } from '../../src/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import { assertLocalAflTradeOutcomesRuntimeIdentity } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
import { createPgAflOutcomeSqlClient } from '../../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createLocalPrivateTradeEvaluationModule } from '../../src/server/aflTradeIntelligence/valuation/localPrivateTradeEvaluationModule';
import { PostgresLocalPrivateTradeEvaluationLifecycle } from '../../src/server/aflTradeIntelligence/valuation/postgresLocalPrivateTradeEvaluationLifecycle';

const MAXIMUM_ARTIFACT_BYTES = 16 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const root = resolve(import.meta.dirname, '../..');

function argument(
  name:
    | '--trade'
    | '--rollback'
    | '--withdraw'
    | '--expected-generation'
    | '--expected-revision'
): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1]?.trim();
  if (!value || value.length > 2_000) {
    throw new TypeError(`${name} requires one bounded value.`);
  }
  return value;
}

function expectedRevisionArgument(): number | null | undefined {
  const value = argument('--expected-revision');
  if (value === null) return undefined;
  if (value === 'none') return null;
  if (!/^\d+$/u.test(value)) {
    throw new TypeError('--expected-revision requires a positive integer or none.');
  }
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new TypeError('--expected-revision requires a positive integer or none.');
  }
  return revision;
}

function localDatabaseUrl(): string {
  const value = process.env.AFL_OUTCOMES_DATABASE_URL?.trim();
  if (!value) throw new TypeError('AFL_OUTCOMES_DATABASE_URL is required.');
  const parsed = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !LOOPBACK_HOSTS.has(parsed.hostname) ||
    parsed.pathname !== '/statly_outcomes_test'
  ) {
    throw new TypeError('Private evaluation lifecycle requires disposable loopback PostgreSQL.');
  }
  return value;
}

async function runtimeNonce(): Promise<string> {
  const value = (
    process.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE ??
    (await readFile(resolve(root, '.statly-local/afl-trade-outcomes-runtime-nonce'), 'utf8'))
  ).trim();
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError('STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE must authenticate the local runtime.');
  }
  return value;
}

if (process.env.NODE_ENV === 'production') {
  throw new TypeError('Private evaluation lifecycle commands are prohibited in production.');
}

const tradeId = argument('--trade');
const rollbackGenerationId = argument('--rollback');
const withdrawalReason = argument('--withdraw');
const expectedGenerationArgument = argument('--expected-generation');
const expectedGenerationId =
  expectedGenerationArgument === null
    ? undefined
    : expectedGenerationArgument === 'none'
      ? null
      : expectedGenerationArgument;
const expectedRevision = expectedRevisionArgument();
const approve = process.argv.includes('--approve');
if (
  tradeId === null ||
  (rollbackGenerationId === null) === (withdrawalReason === null) ||
  !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,239}$/u.test(tradeId)
) {
  throw new TypeError(
    'Provide --trade and exactly one of --rollback <generation-id> or --withdraw <reason>.'
  );
}
if (approve && (expectedGenerationId === undefined || expectedRevision === undefined)) {
  throw new TypeError(
    'Approved transitions require --expected-generation <generation-id|none> and --expected-revision <revision|none> from the reviewed dry run.'
  );
}

const pool = new Pool({
  connectionString: localDatabaseUrl(),
  application_name: 'statly-local-private-trade-evaluation-lifecycle',
  connectionTimeoutMillis: 5_000,
  max: 1,
});
try {
  await assertLocalAflTradeOutcomesRuntimeIdentity(pool, await runtimeNonce());
  const lifecycle = new PostgresLocalPrivateTradeEvaluationLifecycle(
    createPgAflOutcomeSqlClient(pool)
  );
  const before = await lifecycle.loadHead(tradeId);
  const action =
    rollbackGenerationId === null
      ? { kind: 'withdraw' as const, reason: withdrawalReason! }
      : { kind: 'rollback' as const, generationId: rollbackGenerationId };
  if (!approve) {
    process.stdout.write(
      `${JSON.stringify(
        {
          state: 'dry_run',
          tradeId,
          before,
          approvalGuard: {
            expectedGenerationId: before?.generationId ?? null,
            expectedRevision: before?.revision ?? null,
          },
          requestedAction: action,
        },
        null,
        2
      )}\n`
    );
  } else {
    const evaluation = createLocalPrivateTradeEvaluationModule({
      prepare: async () => ({
        state: 'blocked',
        reasons: ['operator_transition_only'],
        evidenceRefs: [],
      }),
      lifecycle,
      artifactRepository: createLocalAflTradePrivateDerivedArtifactRepository({
        rootDirectory: resolve(
          process.env.AFL_TRADE_PRIVATE_ARTIFACT_ROOT?.trim() ??
            resolve(process.cwd(), '.statly-local/afl-trade-private-confirmed-artifacts')
        ),
        repositoryId: 'private-confirmed-valuation-v2',
        maximumObjectBytes: MAXIMUM_ARTIFACT_BYTES,
      }),
      maximumArtifactBytes: MAXIMUM_ARTIFACT_BYTES,
    });
    const result = await evaluation.transition({
      tradeId,
      expectedGenerationId: expectedGenerationId!,
      expectedRevision: expectedRevision!,
      action,
    });
    const after = await lifecycle.loadHead(tradeId);
    process.stdout.write(
      `${JSON.stringify({ state: 'executed', before, result, after }, null, 2)}\n`
    );
    if (
      result.state === 'conflict' ||
      result.state === 'not_found' ||
      result.state === 'invalid_rollback'
    ) {
      process.exitCode = 2;
    }
  }
} finally {
  await pool.end();
}
