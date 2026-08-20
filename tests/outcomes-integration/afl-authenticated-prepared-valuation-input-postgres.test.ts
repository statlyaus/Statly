import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createLocalAflTradeOfficialAfl2026Authority } from '@/server/aflTradeIntelligence/development/localOfficialAfl2026Authority';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { aflTradeSourceRightsProposalSchema } from '@/server/aflTradeIntelligence/source/sourceRights';
import {
  AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V2_SCHEMA_VERSION,
  AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V3_SCHEMA_VERSION,
  createAflTradePreparedValuationInputSet,
} from '@/server/aflTradeIntelligence/valuation/preparedValuationInputSet';
import { PostgresAflTradePreparedValuationInputSetStore } from '@/server/aflTradeIntelligence/valuation/postgresPreparedValuationInputSetStore';
import { createGovernedPrivateEvaluationMaterializationManifest } from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationMaterializationManifest';
import { PostgresGovernedPrivateEvaluationMaterializationManifestRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationMaterializationManifestRepository';
import { PostgresAflTradeValuationSourceQualificationReportStore } from '@/server/aflTradeIntelligence/valuation/postgresValuationSourceQualificationReportStore';
import {
  AFL_TRADE_VALUATION_SOURCE_QUALIFICATION_REPORT_SCHEMA_VERSION,
  createAflTradeValuationSourceQualificationReport,
} from '@/server/aflTradeIntelligence/valuation/valuationSourceQualificationReport';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('AFL_OUTCOMES_TEST_DATABASE_URL must identify disposable PostgreSQL.');
  })();
const schemaName = `afl_authenticated_prepared_inputs_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
});
const digest = (character: string) => character.repeat(64);

function artifact(character: string) {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 1,
    createdAt: '2026-08-15T03:00:00.000Z',
  };
}

const baseRights = createLocalAflTradeOfficialAfl2026Authority().capture.sourceRights;
const allowedRightsContent = {
  ...baseRights.content,
  registerId: 'official-afl-player-stats-prepared-v2-fixture',
  operations: {
    ...baseRights.content.operations,
    model_training: 'allowed' as const,
    derived_feature_creation: 'allowed' as const,
  },
  fields: baseRights.content.fields.map((field) => ({
    ...field,
    uses: {
      ...field.uses,
      model_training: 'allowed' as const,
      derived_feature: 'allowed' as const,
    },
  })),
};
const allowedRights = aflTradeSourceRightsProposalSchema.parse({
  rightsArtifactId: createAflTradeContentAddress('source-rights', allowedRightsContent),
  content: allowedRightsContent,
});
const canonicalMembers = [
  {
    recordKind: 'transaction',
    canonicalRecordId: 'trade-a',
    canonicalRecordSha256: digest('1'),
    ordinal: 1,
  },
  {
    recordKind: 'transaction',
    canonicalRecordId: 'trade-b',
    canonicalRecordSha256: digest('2'),
    ordinal: 2,
  },
];
const releaseManifest = {
  releaseId: `outcome-release:${digest('3')}`,
  content: {
    canonicalMembers,
    sourceCaptures: [{ captureId: 'capture-1', rightsArtifactId: allowedRights.rightsArtifactId }],
  },
};
const qualificationReport = createAflTradeValuationSourceQualificationReport({
  schemaVersion: AFL_TRADE_VALUATION_SOURCE_QUALIFICATION_REPORT_SCHEMA_VERSION,
  environment: 'non_production',
  operation: 'valuation_model_training_and_derived_feature_creation',
  valuationScopeKey: 'afl-men:2026-trades',
  factualReleaseScopeKey: 'public-afl-draft-trade-outcomes',
  factualReleaseId: releaseManifest.releaseId,
  factualReleaseArtifact: createAflTradeCanonicalJsonArtifactRef(
    releaseManifest,
    '2026-08-15T00:00:00.000Z'
  ),
  releaseMembershipArtifact: createAflTradeCanonicalJsonArtifactRef(
    canonicalMembers,
    '2026-08-15T00:00:00.000Z'
  ),
  releaseTradeIds: ['trade-a', 'trade-b'],
  sourceRightsEvidenceRefs: [
    createAflTradeCanonicalJsonArtifactRef(allowedRights, allowedRights.content.proposedAt),
  ],
  decision: { state: 'eligible_for_dataset_admission' },
  evaluatedAt: '2026-08-15T02:00:00.000Z',
  publicationEligible: false,
  limitation:
    'Source qualification only; not dataset admission, model approval, numerical output, publication approval, or activation authority.',
});

async function retainArtifact(reference: ReturnType<typeof artifact>) {
  return pool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,custody_profile_id,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,$4,$5,'derived_private','non_production',NULL,$6,$6,$7::jsonb)`,
    [
      reference.artifactId,
      reference.contentSha256,
      reference.storageUri,
      reference.mediaType,
      reference.byteLength,
      reference.createdAt,
      canonicalizeAflTradeJson({
        content: {
          repositoryAssurance: 'local_non_production_filesystem',
          custodyEnvironment: 'non_production',
          custodyProfileId: null,
          custodyProfile: null,
        },
      }),
    ]
  );
}

const materializationParentCreatedAt = '2026-08-15T03:00:00.000Z';
const materializationManifestCreatedAt = '2026-08-15T03:30:00.000Z';

function retainedJson(value: unknown) {
  return createAflTradeCanonicalJsonArtifactRef(value, materializationParentCreatedAt);
}

function materializationManifest() {
  const calculationInput = { kind: 'calculation-input', tradeId: 'trade-a' };
  const inputTrace = { kind: 'input-trace', tradeId: 'trade-a' };
  const explanationPolicy = { kind: 'explanation-policy', version: 1 };
  const lineageGraph = { kind: 'lineage-graph', tradeId: 'trade-a' };
  const pickBenchmark = { kind: 'pick-benchmark', pick: 12 };
  const playerObservation = { kind: 'player-observation', playerId: 'player-a' };
  return createGovernedPrivateEvaluationMaterializationManifest({
    schemaVersion: 'private-evaluation-materialization-manifest/v1',
    environment: 'non_production',
    selector: { valuationScopeKey: 'afl-men:2026-trades', tradeId: 'trade-a' },
    calculationInputPackageId: createAflTradeContentAddress(
      'valuation-calculation-input',
      calculationInput
    ),
    calculationInputArtifact: retainedJson(calculationInput),
    inputTraceId: createAflTradeContentAddress('private-evaluation-input-trace', inputTrace),
    inputTraceArtifact: retainedJson(inputTrace),
    explanationPolicyId: createAflTradeContentAddress(
      'private-evaluation-explanation-policy',
      explanationPolicy
    ),
    explanationPolicyArtifact: retainedJson(explanationPolicy),
    lineageGraphId: createAflTradeContentAddress('lineage-graph', lineageGraph),
    lineageGraphArtifact: retainedJson(lineageGraph),
    pickBenchmarks: [
      {
        benchmarkId: createAflTradeContentAddress('pick-pav-benchmark', pickBenchmark),
        artifact: retainedJson(pickBenchmark),
      },
    ],
    playerObservations: [
      {
        observationId: createAflTradeContentAddress(
          'player-pav-observation',
          playerObservation
        ),
        artifact: retainedJson(playerObservation),
      },
    ],
    createdAt: materializationManifestCreatedAt,
    publicationEligible: false,
    limitation:
      'Private materialization inputs only; not model, grade, activation, production, or publication authority.',
  });
}

function preparedSetV3() {
  const base = preparedSet().content;
  const manifest = materializationManifest();
  return createAflTradePreparedValuationInputSet({
    ...base,
    schemaVersion: AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V3_SCHEMA_VERSION,
    entries: [
      {
        tradeId: 'trade-a',
        state: 'ready',
        materializationManifestId: manifest.manifestId,
        materializationManifestArtifact: createAflTradeCanonicalJsonArtifactRef(
          manifest,
          materializationManifestCreatedAt
        ),
      },
      base.entries[1]!,
    ],
  });
}

async function registerMaterializationManifest() {
  const manifest = materializationManifest();
  const parentArtifacts = [
    manifest.content.calculationInputArtifact,
    manifest.content.inputTraceArtifact,
    manifest.content.explanationPolicyArtifact,
    manifest.content.lineageGraphArtifact,
    ...manifest.content.pickBenchmarks.map(({ artifact: reference }) => reference),
    ...manifest.content.playerObservations.map(({ artifact: reference }) => reference),
  ];
  const manifestArtifact = createAflTradeCanonicalJsonArtifactRef(
    manifest,
    materializationManifestCreatedAt
  );
  await Promise.all([...parentArtifacts, manifestArtifact].map(retainArtifact));
  const repository = new PostgresGovernedPrivateEvaluationMaterializationManifestRepository(
    createPgAflOutcomeSqlClient(pool)
  );
  await expect(
    repository.register({ manifest, artifact: manifestArtifact })
  ).resolves.toEqual({ manifest, artifact: manifestArtifact });
  await expect(repository.loadExact(manifest.manifestId)).resolves.toEqual({
    manifest,
    artifact: manifestArtifact,
  });
  return { manifest, manifestArtifact };
}

function preparedSet(inputTraceArtifact = artifact('c')) {
  const entries = [
    {
      tradeId: 'trade-a',
      state: 'ready' as const,
      calculationInputPackageId: `valuation-calculation-input:${digest('4')}`,
      calculationInputArtifact: artifact('b'),
      inputTraceId: `private-evaluation-input-trace:${digest('5')}`,
      inputTraceArtifact,
    },
    {
      tradeId: 'trade-b',
      state: 'blocked' as const,
      blockers: [
        {
          code: 'lineage_unresolved' as const,
          subject: { kind: 'lineage' as const, id: 'asset:pick-12' },
          evidenceRefs: [artifact('d')],
        },
      ],
    },
  ];
  return createAflTradePreparedValuationInputSet({
    schemaVersion: AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V2_SCHEMA_VERSION,
    environment: 'non_production',
    scopeKey: 'afl-men:2026-trades',
    factualReleaseScopeKey: 'public-afl-draft-trade-outcomes',
    factualReleaseId: releaseManifest.releaseId,
    factualReleaseArtifact: createAflTradeCanonicalJsonArtifactRef(
      releaseManifest,
      '2026-08-15T00:00:00.000Z'
    ),
    releaseMembershipArtifact: createAflTradeCanonicalJsonArtifactRef(
      canonicalMembers,
      '2026-08-15T00:00:00.000Z'
    ),
    preparationAuthority: 'authenticated_calculation_evidence_snapshot',
    qualificationOperation: 'valuation_model_training_and_derived_feature_creation',
    qualificationReportId: qualificationReport.qualificationReportId,
    qualificationReportArtifact: createAflTradeCanonicalJsonArtifactRef(
      qualificationReport,
      qualificationReport.content.evaluatedAt
    ),
    sourceQualificationEvidenceRefs: qualificationReport.content.sourceRightsEvidenceRefs,
    valuationInputBundleId: `valuation-input-bundle:${digest('6')}`,
    valuationInputBundleArtifact: artifact('a'),
    releaseTradeIds: ['trade-a', 'trade-b'],
    entries,
    tradeCount: 2,
    readyCount: 1,
    blockedCount: 1,
    preparedAt: '2026-08-15T04:00:00.000Z',
    publicationEligible: false,
    limitation:
      'Private preparation evidence only; not a valuation result, publication approval, or activation authority.',
  });
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  await pool.query(
    `INSERT INTO outcome_release_manifest
      (release_id,scope_key,environment,created_at,effective_through,manifest_json)
     VALUES ($1,'public-afl-draft-trade-outcomes','non_production',$2,$3,$4::jsonb)`,
    [
      releaseManifest.releaseId,
      '2026-08-15T00:00:00.000Z',
      '2026-08-14T23:59:59.000Z',
      canonicalizeAflTradeJson(releaseManifest),
    ]
  );
  await pool.query(
    `INSERT INTO outcome_source_rights_proposal
      (rights_artifact_id,provider,dataset,dataset_version,capability_id,proposed_at,content_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      allowedRights.rightsArtifactId,
      allowedRights.content.provider,
      allowedRights.content.dataset,
      allowedRights.content.datasetVersion,
      allowedRights.content.acquisition.kind === 'fitzroy'
        ? allowedRights.content.acquisition.capabilities[0]!.capabilityId
        : null,
      allowedRights.content.proposedAt,
      canonicalizeAflTradeJson(allowedRights),
    ]
  );
  await new PostgresAflTradeValuationSourceQualificationReportStore(
    createPgAflOutcomeSqlClient(pool)
  ).register(qualificationReport);
  await Promise.all(['a', 'b', 'c', 'd'].map((character) => retainArtifact(artifact(character))));
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminPool.end();
});

describe('PostgreSQL authenticated prepared valuation inputs', () => {
  it('persists and exactly replays one ready and one factual blocked trade', async () => {
    const store = new PostgresAflTradePreparedValuationInputSetStore(
      createPgAflOutcomeSqlClient(pool)
    );
    const expected = preparedSet();

    await expect(store.register(expected)).resolves.toEqual(expected);
    await expect(store.loadExact(expected.preparedInputSetId)).resolves.toEqual(expected);
    await expect(
      store.loadTrade({ preparedInputSetId: expected.preparedInputSetId, tradeId: 'trade-a' })
    ).resolves.toMatchObject({ state: 'ready' });
    await expect(
      store.loadTrade({ preparedInputSetId: expected.preparedInputSetId, tradeId: 'trade-b' })
    ).resolves.toMatchObject({ state: 'blocked' });
  });

  it('rolls back the complete set when one ready artifact is absent from custody', async () => {
    const store = new PostgresAflTradePreparedValuationInputSetStore(
      createPgAflOutcomeSqlClient(pool)
    );
    const missing = preparedSet(artifact('e'));

    await expect(store.register(missing)).rejects.toThrow(/not retained exactly/i);
    const retained = await pool.query(
      `SELECT 1 FROM outcome_prepared_valuation_input_set WHERE prepared_input_set_id=$1`,
      [missing.preparedInputSetId]
    );
    expect(retained.rowCount).toBe(0);
  });

  it('retains an append-only materialization manifest and activates only finalized v3 authority by CAS', async () => {
    const { manifest } = await registerMaterializationManifest();
    const store = new PostgresAflTradePreparedValuationInputSetStore(
      createPgAflOutcomeSqlClient(pool)
    );
    const first = preparedSetV3();
    await expect(store.register(first)).resolves.toEqual(first);

    await expect(
      store.activateCurrent({
        scopeKey: first.content.scopeKey,
        preparedInputSetId: first.preparedInputSetId,
        expectedRevision: 0,
      })
    ).resolves.toMatchObject({
      scopeKey: first.content.scopeKey,
      preparedInputSetId: first.preparedInputSetId,
      revision: 1,
    });
    await expect(store.loadCurrent(first.content.scopeKey)).resolves.toMatchObject({
      head: { preparedInputSetId: first.preparedInputSetId, revision: 1 },
      preparedInputSet: first,
    });
    await expect(
      store.loadCurrentTrade({ scopeKey: first.content.scopeKey, tradeId: 'trade-a' })
    ).resolves.toMatchObject({
      head: { revision: 1 },
      preparedInputSet: first,
      entry: {
        state: 'ready',
        materializationManifestId: manifest.manifestId,
      },
    });

    await expect(
      pool.query(
        `UPDATE outcome_private_evaluation_materialization_manifest SET trade_id='tampered'
          WHERE materialization_manifest_id=$1`,
        [manifest.manifestId]
      )
    ).rejects.toThrow(/append-only/i);
    await expect(
      store.activateCurrent({
        scopeKey: first.content.scopeKey,
        preparedInputSetId: first.preparedInputSetId,
        expectedRevision: 0,
      })
    ).rejects.toThrow(/compare-and-swap/i);
    await expect(
      store.activateCurrent({
        scopeKey: 'afl-men:2027-trades',
        preparedInputSetId: first.preparedInputSetId,
        expectedRevision: 0,
      })
    ).rejects.toThrow(/not finalized v3 authority/i);
  });
});
