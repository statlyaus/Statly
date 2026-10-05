import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import {
  createAflTradeCanonicalJsonArtifactRef,
  doAflTradeArtifactRefsExactlyMatch,
} from '../../src/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../../src/server/aflTradeIntelligence/artifacts/contentAddress';
import { createLocalAflTradePrivateDerivedArtifactRepository } from '../../src/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import { assertLocalAflTradeOutcomesRuntimeIdentity } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
import { PostgresLocalWorkbookPickSelectionConfirmationRepository } from '../../src/server/aflTradeIntelligence/development/postgresLocalWorkbookPickSelectionConfirmationRepository';
import { createPgAflOutcomeSqlClient } from '../../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { parseAflTradeWorkbookTransactionReviewDecisionV2 } from '../../src/server/aflTradeIntelligence/source/workbookTransactionReviewDecision';
import { createLocalPrivateTradeEvaluationModule } from '../../src/server/aflTradeIntelligence/valuation/localPrivateTradeEvaluationModule';
import {
  prepareLocalPrivateTradeEvaluationFromConfirmedResult,
  type LocalPrivatePickEvaluationEvidence,
} from '../../src/server/aflTradeIntelligence/valuation/localPrivateTradeEvaluationPreparation';
import { PostgresLocalPrivateTradeEvaluationLifecycle } from '../../src/server/aflTradeIntelligence/valuation/postgresLocalPrivateTradeEvaluationLifecycle';
import { PostgresAflTradePrivateConfirmedValuationLifecycleV2 } from '../../src/server/aflTradeIntelligence/valuation/postgresPrivateConfirmedTradeValuationLifecycle';
import { createPostgresAflTradePrivateConfirmedValuationSnapshotLoader } from '../../src/server/aflTradeIntelligence/valuation/postgresPrivateConfirmedTradeValuationSnapshot';
import { createAflTradePrivateConfirmedValuationConstructionV2 } from '../../src/server/aflTradeIntelligence/valuation/privateConfirmedTradeValuationConstruction';
import { createAflTradePrivateConfirmedValuationConstructionSourceV2 } from '../../src/server/aflTradeIntelligence/valuation/privateConfirmedTradeValuationSource';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const MAXIMUM_ARTIFACT_BYTES = 16 * 1024 * 1024;
const root = resolve(import.meta.dirname, '../..');

function argument(name: '--scope' | '--trade'): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1]?.trim();
  if (!value || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,511}$/u.test(value)) {
    throw new TypeError(`${name} requires one bounded private valuation identifier.`);
  }
  return value;
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
    throw new TypeError(
      'Private confirmed valuation construction requires disposable loopback PostgreSQL.'
    );
  }
  return value;
}

async function runtimeNonce(): Promise<string> {
  const value = (
    process.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE ??
    (await readFile(resolve(root, '.statly-local/afl-trade-outcomes-runtime-nonce'), 'utf8'))
  ).trim();
  if (!value || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError('STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE must authenticate the local runtime.');
  }
  return value;
}

if (process.env.NODE_ENV === 'production') {
  throw new TypeError('Private confirmed valuation construction is prohibited in production.');
}

const databaseUrl = localDatabaseUrl();
const pool = new Pool({
  connectionString: databaseUrl,
  application_name: 'statly-local-private-confirmed-valuation',
  connectionTimeoutMillis: 5_000,
  max: 2,
});
try {
  await assertLocalAflTradeOutcomesRuntimeIdentity(pool, await runtimeNonce());
  const client = createPgAflOutcomeSqlClient(pool);
  const artifactRepository = createLocalAflTradePrivateDerivedArtifactRepository({
    rootDirectory: resolve(
      process.env.AFL_TRADE_PRIVATE_ARTIFACT_ROOT?.trim() ??
        resolve(process.cwd(), '.statly-local/afl-trade-private-confirmed-artifacts')
    ),
    repositoryId: 'private-confirmed-valuation-v2',
    maximumObjectBytes: MAXIMUM_ARTIFACT_BYTES,
  });
  const snapshotLoader = createPostgresAflTradePrivateConfirmedValuationSnapshotLoader(client);
  const source = createAflTradePrivateConfirmedValuationConstructionSourceV2({
    loadSnapshot: snapshotLoader.load,
    artifactRepository,
    maximumArtifactBytes: MAXIMUM_ARTIFACT_BYTES,
  });
  const construction = createAflTradePrivateConfirmedValuationConstructionV2({
    source,
    lifecycle: new PostgresAflTradePrivateConfirmedValuationLifecycleV2(client),
    artifactRepository,
    maximumArtifactBytes: MAXIMUM_ARTIFACT_BYTES,
  });
  const valuationScopeKey = argument('--scope');
  const tradeId = argument('--trade');
  const staged = await construction.stage({
    valuationScopeKey,
    tradeId,
  });
  if (staged.state !== 'planned') {
    process.stdout.write(`${JSON.stringify(staged, null, 2)}\n`);
    process.exitCode = 2;
  } else {
    const assembled = await construction.assemble(staged.plan.planId);
    if (assembled.state !== 'assembled') {
      process.stdout.write(`${JSON.stringify(assembled, null, 2)}\n`);
      process.exitCode = 2;
    } else {
      const parent = await client.query<{
        decision_json: unknown;
        workbook_sha256: string;
      }>(
        `SELECT promotion.decision_json,
                review_set.review_set_json->'content'->>'sourceArtifactSha256'
                  AS workbook_sha256
           FROM outcome_private_workbook_transaction_promotion promotion
           JOIN outcome_workbook_transaction_review_set review_set
             ON review_set.review_set_id=promotion.review_set_id
          WHERE promotion.promotion_id=$1
            AND promotion.workbook_trade_id=$2
            AND promotion.status='active'`,
        [assembled.result.content.transactionPromotionId, tradeId]
      );
      const row = parent.rows[0];
      if (
        parent.rows.length !== 1 ||
        !row ||
        !/^[a-f0-9]{64}$/u.test(row.workbook_sha256)
      ) {
        throw new TypeError('Private evaluation generation requires exact promotion ancestry.');
      }
      const decision = parseAflTradeWorkbookTransactionReviewDecisionV2(row.decision_json);
      const pickConfirmations = await new PostgresLocalWorkbookPickSelectionConfirmationRepository(
        client
      ).loadForTrade(
        row.workbook_sha256,
        valuationScopeKey,
        tradeId,
        assembled.result.content.assets
          .filter(({ assetKind }) => assetKind === 'pick' || assetKind === 'future_pick')
          .map(({ assetId }) => assetId)
      );
      const pickEvidenceByAssetId = new Map<string, LocalPrivatePickEvaluationEvidence>();
      for (const confirmation of pickConfirmations) {
        const reference = createAflTradeCanonicalJsonArtifactRef(
          confirmation,
          confirmation.content.reviewedAt
        );
        const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(confirmation));
        await artifactRepository.putIfAbsent(reference, bytes);
        const retained = await artifactRepository.loadExact(reference, MAXIMUM_ARTIFACT_BYTES);
        if (
          retained === null ||
          !doAflTradeArtifactRefsExactlyMatch(retained.reference, reference) ||
          new TextDecoder().decode(retained.bytes) !== canonicalizeAflTradeJson(confirmation)
        ) {
          throw new TypeError('Pick-selection confirmation failed immutable artifact read-back.');
        }
        pickEvidenceByAssetId.set(confirmation.content.assetId, {
          state: 'selection_confirmed' as const,
          canonicalPlayerId: confirmation.content.canonicalPlayerId,
          evidenceRefs: [retained.reference],
        });
      }
      const preparation = prepareLocalPrivateTradeEvaluationFromConfirmedResult({
        result: assembled.result,
        resultArtifact: assembled.resultArtifact,
        workbookSha256: row.workbook_sha256,
        labelsByAssetId: new Map(
          decision.content.parties.flatMap(({ assets }) =>
            assets.map(({ assetId, sourceAssetText }) => [assetId, sourceAssetText] as const)
          )
        ),
        pickEvidenceByAssetId,
      });
      const evaluation = createLocalPrivateTradeEvaluationModule({
        prepare: async (requestedTradeId) =>
          requestedTradeId === tradeId
            ? { state: 'ready', preparation }
            : { state: 'blocked', reasons: ['transaction_not_confirmed'], evidenceRefs: [] },
        lifecycle: new PostgresLocalPrivateTradeEvaluationLifecycle(client),
        artifactRepository,
        maximumArtifactBytes: MAXIMUM_ARTIFACT_BYTES,
      });
      const refreshed = await evaluation.refresh(tradeId);
      process.stdout.write(
        `${JSON.stringify({ confirmed: assembled, evaluation: refreshed }, null, 2)}\n`
      );
      if (refreshed.state === 'blocked' || refreshed.state === 'conflict') process.exitCode = 2;
    }
  }
} finally {
  await pool.end();
}
