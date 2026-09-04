import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type {
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createPostgresGovernedPrivateEvaluationCalculationAuthorityCapture } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationCalculationAuthority';
import { createAflTradePreparedValuationInputSet } from '@/server/aflTradeIntelligence/valuation/preparedValuationInputSet';
import {
  AflTradePreparedValuationInputCohortCache,
  loadCurrentAflTradePreparedValuationInputTradeFromTransaction,
} from '@/server/aflTradeIntelligence/valuation/postgresPreparedValuationInputSetStore';

import { createGovernedPrivateEvaluationAuthenticatedCalculationFixture } from '../testUtils/governedPrivateEvaluationAuthenticatedCalculationFixture';

class NoPreparedAuthorityTransaction implements AflOutcomeSqlTransaction {
  readonly calls: { sql: string; parameters: readonly unknown[] }[] = [];

  async query<Row>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    this.calls.push({ sql, parameters });
    if (sql.includes('FROM outcome_current_prepared_valuation_input_set')) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

function readyPreparedFixture() {
  const calculation = createGovernedPrivateEvaluationAuthenticatedCalculationFixture();
  const createdAt = '2026-08-19T11:00:00.000Z';
  const evidence = (label: string) =>
    createAflTradeCanonicalJsonArtifactRef({ fixture: label }, '2026-08-19T08:00:00.000Z');
  const prepared = createAflTradePreparedValuationInputSet({
    schemaVersion: 'afl-trade-prepared-valuation-input-set/v3',
    environment: 'non_production',
    scopeKey: calculation.trace.content.selector.valuationScopeKey,
    factualReleaseScopeKey: 'public-afl-draft-trade-outcomes',
    factualReleaseId: calculation.trace.content.factualReleaseId,
    factualReleaseArtifact: evidence('release'),
    releaseMembershipArtifact: evidence('membership'),
    preparationAuthority: 'authenticated_calculation_evidence_snapshot',
    qualificationOperation: 'valuation_model_training_and_derived_feature_creation',
    qualificationReportId: createAflTradeContentAddress('valuation-source-qualification', {
      fixture: 'qualification',
    }),
    qualificationReportArtifact: evidence('qualification'),
    sourceQualificationEvidenceRefs: [evidence('source')],
    valuationInputBundleId: calculation.trace.content.valuationInputBundleId,
    valuationInputBundleArtifact: evidence('valuation-input-bundle'),
    releaseTradeIds: [calculation.trace.content.selector.tradeId],
    entries: [
      {
        tradeId: calculation.trace.content.selector.tradeId,
        state: 'ready',
        materializationManifestId: calculation.materializationManifest.manifestId,
        materializationManifestArtifact: createAflTradeCanonicalJsonArtifactRef(
          calculation.materializationManifest,
          calculation.materializationManifest.content.createdAt
        ),
      },
    ],
    tradeCount: 1,
    readyCount: 1,
    blockedCount: 0,
    preparedAt: createdAt,
    publicationEligible: false,
    limitation:
      'Private preparation evidence only; not a valuation result, publication approval, or activation authority.',
  });
  return { calculation, prepared };
}

class ReadyPreparedAuthorityTransaction implements AflOutcomeSqlTransaction {
  readonly calls: { sql: string; parameters: readonly unknown[] }[] = [];
  readonly fixture = readyPreparedFixture();

  constructor(private readonly retainManifestRow = false) {}

  async query<Row>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    this.calls.push({ sql, parameters });
    const { prepared } = this.fixture;
    const preparedContent = prepared.content;
    if (
      preparedContent.preparationAuthority !==
      'authenticated_calculation_evidence_snapshot'
    ) {
      throw new Error('Expected authenticated prepared valuation input fixture.');
    }
    if (sql.includes('FROM outcome_current_prepared_valuation_input_set')) {
      return {
        rows: [
          {
            scope_key: prepared.content.scopeKey,
            prepared_input_set_id: prepared.preparedInputSetId,
            revision: 3,
            activated_at: prepared.content.preparedAt,
          },
        ] as Row[],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM outcome_prepared_valuation_input_set prepared')) {
      return {
        rows: [
          {
            content_sha256: prepared.preparedInputSetId.split(':')[1],
            schema_version: prepared.content.schemaVersion,
            environment: prepared.content.environment,
            scope_key: prepared.content.scopeKey,
            factual_release_scope_key: prepared.content.factualReleaseScopeKey,
            factual_release_id: prepared.content.factualReleaseId,
            qualification_report_id: preparedContent.qualificationReportId,
            prepared_at: prepared.content.preparedAt,
            prepared_set_json: prepared,
            content_canonical_json: canonicalizeAflTradeJson(prepared.content),
            prepared_set_canonical_json: canonicalizeAflTradeJson(prepared),
            finalized_at: prepared.content.preparedAt,
            trade_count: 1,
            ready_count: 1,
            blocked_count: 0,
            actual_count: 1,
            actual_ready_count: 1,
            actual_blocked_count: 0,
          },
        ] as Row[],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM outcome_prepared_valuation_input_entry')) {
      const entry = prepared.content.entries[0]!;
      return {
        rows: [
          {
            ordinal: 1,
            trade_id: entry.tradeId,
            state: entry.state,
            entry_canonical_json: canonicalizeAflTradeJson(entry),
            entry_json: entry,
          },
        ] as Row[],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM outcome_private_evaluation_materialization_manifest')) {
      if (this.retainManifestRow) {
        const manifest = this.fixture.calculation.materializationManifest;
        const artifact =
          prepared.content.entries[0]!.state === 'ready'
            ? prepared.content.entries[0]!.materializationManifestArtifact
            : undefined;
        if (artifact === undefined) throw new Error('Expected ready manifest artifact.');
        return {
          rows: [
            {
              materialization_manifest_id: manifest.manifestId,
              content_sha256: manifest.manifestId.split(':')[1],
              valuation_scope_key: manifest.content.selector.valuationScopeKey,
              trade_id: manifest.content.selector.tradeId,
              created_at: manifest.content.createdAt,
              content_canonical_json: canonicalizeAflTradeJson(manifest.content),
              manifest_canonical_json: canonicalizeAflTradeJson(manifest),
              manifest_json: manifest,
              artifact_id: artifact.artifactId,
              artifact_content_sha256: artifact.contentSha256,
              storage_uri: artifact.storageUri,
              media_type: artifact.mediaType,
              byte_length: artifact.byteLength,
              artifact_created_at: artifact.createdAt,
              artifact_environment: 'non_production',
              artifact_class: 'derived_private',
            },
          ] as Row[],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

async function retainReadyFixtureArtifacts(
  transaction: ReadyPreparedAuthorityTransaction,
  repository: ReturnType<typeof createAflTradeFixtureArtifactRepository>
) {
  const { calculation, prepared } = transaction.fixture;
  const preparedContent = prepared.content;
  if (
    preparedContent.preparationAuthority !==
    'authenticated_calculation_evidence_snapshot'
  ) {
    throw new Error('Expected authenticated prepared valuation input fixture.');
  }
  const readyEntry = prepared.content.entries[0];
  if (readyEntry?.state !== 'ready') throw new Error('Expected ready fixture entry.');
  const documents = [
    [readyEntry.materializationManifestArtifact, calculation.materializationManifest],
    [prepared.content.factualReleaseArtifact, { fixture: 'release' }],
    [prepared.content.releaseMembershipArtifact, { fixture: 'membership' }],
    [preparedContent.qualificationReportArtifact, { fixture: 'qualification' }],
    [preparedContent.sourceQualificationEvidenceRefs[0]!, { fixture: 'source' }],
    [preparedContent.valuationInputBundleArtifact, { fixture: 'valuation-input-bundle' }],
    [
      calculation.materializationManifest.content.calculationInputArtifact,
      calculation.calculationInputPackage,
    ],
    [calculation.materializationManifest.content.inputTraceArtifact, calculation.trace],
    [
      calculation.materializationManifest.content.explanationPolicyArtifact,
      calculation.explanationPolicy,
    ],
    [calculation.materializationManifest.content.lineageGraphArtifact, calculation.lineageGraph],
    [
      calculation.materializationManifest.content.pickBenchmarks[0]!.artifact,
      calculation.pickBenchmarks[0],
    ],
  ] as const;
  for (const [reference, document] of documents) {
    await repository.putIfAbsent(
      reference,
      new TextEncoder().encode(canonicalizeAflTradeJson(document))
    );
  }
}

describe('PostgreSQL governed calculation-authority capture', () => {
  it('authenticates shared prepared parents once and uses one targeted lookup per trade', async () => {
    const transaction = new ReadyPreparedAuthorityTransaction();
    const cache = new AflTradePreparedValuationInputCohortCache();
    const selector = transaction.fixture.calculation.trace.content.selector;

    await loadCurrentAflTradePreparedValuationInputTradeFromTransaction(
      transaction,
      { scopeKey: selector.valuationScopeKey, tradeId: selector.tradeId },
      cache
    );
    await loadCurrentAflTradePreparedValuationInputTradeFromTransaction(
      transaction,
      { scopeKey: selector.valuationScopeKey, tradeId: selector.tradeId },
      cache
    );

    expect(
      transaction.calls.filter(({ sql }) =>
        sql.includes('FROM outcome_prepared_valuation_input_set prepared')
      )
    ).toHaveLength(1);
    expect(
      transaction.calls.filter(({ sql }) =>
        sql.includes('WHERE prepared_input_set_id=$1 AND trade_id=$2')
      )
    ).toHaveLength(2);
  });

  it('fails closed when no current authenticated v3 prepared trade exists', async () => {
    const transaction = new NoPreparedAuthorityTransaction();
    const capture = createPostgresGovernedPrivateEvaluationCalculationAuthorityCapture({
      artifactRepository: createAflTradeFixtureArtifactRepository({
        artifactClass: 'derived_private',
      }),
      maximumArtifactBytes: 1024 * 1024,
    });

    await expect(
      capture({
        transaction,
        selector: {
          valuationScopeKey: 'afl-men:2026-trades',
          tradeId: 'trade:fixture',
        },
        capturedAt: '2026-08-20T10:00:00.000Z',
      })
    ).resolves.toEqual({
      state: 'unavailable',
      blockers: [
        {
          code: 'insufficient_data',
          message: 'No current authenticated v3 prepared calculation inputs cover this trade.',
        },
      ],
    });
    expect(transaction.calls[0]?.parameters).toEqual(['afl-men:2026-trades']);
  });

  it('refuses a ready prepared entry whose retained materialization manifest is absent', async () => {
    const transaction = new ReadyPreparedAuthorityTransaction();
    const capture = createPostgresGovernedPrivateEvaluationCalculationAuthorityCapture({
      artifactRepository: createAflTradeFixtureArtifactRepository({
        artifactClass: 'derived_private',
      }),
      maximumArtifactBytes: 1024 * 1024,
    });

    await expect(
      capture({
        transaction,
        selector: transaction.fixture.calculation.trace.content.selector,
        capturedAt: '2026-08-20T10:00:00.000Z',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses SQL manifest custody when the exact retained object bytes are absent', async () => {
    const transaction = new ReadyPreparedAuthorityTransaction(true);
    const capture = createPostgresGovernedPrivateEvaluationCalculationAuthorityCapture({
      artifactRepository: createAflTradeFixtureArtifactRepository({
        artifactClass: 'derived_private',
      }),
      maximumArtifactBytes: 1024 * 1024,
    });

    await expect(
      capture({
        transaction,
        selector: transaction.fixture.calculation.trace.content.selector,
        capturedAt: '2026-08-20T10:00:00.000Z',
      })
    ).rejects.toMatchObject({ code: 'READBACK_MISMATCH' });
  });

  it('refuses a retained manifest when any bounded derivation parent is absent', async () => {
    const transaction = new ReadyPreparedAuthorityTransaction(true);
    const artifactRepository = createAflTradeFixtureArtifactRepository({
      artifactClass: 'derived_private',
    });
    const manifest = transaction.fixture.calculation.materializationManifest;
    const reference = createAflTradeCanonicalJsonArtifactRef(manifest, manifest.content.createdAt);
    await artifactRepository.putIfAbsent(
      reference,
      new TextEncoder().encode(canonicalizeAflTradeJson(manifest))
    );
    const capture = createPostgresGovernedPrivateEvaluationCalculationAuthorityCapture({
      artifactRepository,
      maximumArtifactBytes: 1024 * 1024,
    });

    await expect(
      capture({
        transaction,
        selector: manifest.content.selector,
        capturedAt: '2026-08-20T10:00:00.000Z',
      })
    ).rejects.toMatchObject({ code: 'READBACK_MISMATCH' });
  });

  it('rejects SHA-valid JSON that is not the authenticated valuation input bundle contract', async () => {
    const transaction = new ReadyPreparedAuthorityTransaction(true);
    const artifactRepository = createAflTradeFixtureArtifactRepository({
      artifactClass: 'derived_private',
    });
    await retainReadyFixtureArtifacts(transaction, artifactRepository);
    const capture = createPostgresGovernedPrivateEvaluationCalculationAuthorityCapture({
      artifactRepository,
      maximumArtifactBytes: 1024 * 1024,
    });

    await expect(
      capture({
        transaction,
        selector: transaction.fixture.calculation.trace.content.selector,
        capturedAt: '2026-08-20T10:00:00.000Z',
      })
    ).rejects.toThrow('Retained valuation input bundle failed exact contract authentication.');
  });
});
