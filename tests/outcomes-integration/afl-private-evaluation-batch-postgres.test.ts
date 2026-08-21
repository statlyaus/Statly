import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  createAutomatedGovernedPrivateEvaluationGeneration,
  parseGovernedPrivateEvaluationGeneration,
} from '@/server/aflTradeIntelligence/valuation/governedPrivateEvaluationGeneration';
import { createPostgresAflTradePrivateEvaluationCohortRunner } from '@/server/aflTradeIntelligence/valuation/postgresCurrentValuationCohortRunner';
import {
  createGovernedPrivateEvaluationBatch,
  createGovernedPrivateEvaluationBatchOperationId,
  createGovernedPrivateEvaluationBatchWithdrawal,
  type GovernedPrivateEvaluationBatch,
} from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationBatch';
import { PostgresGovernedPrivateEvaluationBatchRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationBatchRepository';
import { createPostgresGovernedPrivateEvaluationReadRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationReadRepository';
import { createGovernedPrivateEvaluationNarrativeFixture } from '../testUtils/governedPrivateEvaluationFixture';
import { createGovernedPrivateEvaluationMultiClubNarrativeFixture } from '../testUtils/governedPrivateEvaluationMultiClubFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('AFL_OUTCOMES_TEST_DATABASE_URL must identify disposable PostgreSQL.');
  })();
const schemaName = `afl_private_evaluation_batch_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
});
const scopeKey = 'afl-men:2026-trades';
const preparedInputSetId = `prepared-valuation-input-set:${'1'.repeat(64)}`;
const factualReleaseId = `outcome-release:${'2'.repeat(64)}`;
const modelQualificationId = `model-qualification:${'3'.repeat(64)}`;
const modelQualificationWorkId = `model-qualification-work:${'4'.repeat(64)}`;
const createdAt = '2026-08-20T09:00:00.000Z';

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  const seed = await pool.connect();
  try {
    await seed.query('BEGIN');
    await seed.query(`SET LOCAL session_replication_role='replica'`);
    await seed.query(
      `INSERT INTO outcome_release_manifest
        (release_id,scope_key,environment,created_at,effective_through,manifest_json)
       VALUES ($1,'fixture-release-scope','non_production',$2,$2,'{}'::jsonb)`,
      [factualReleaseId, createdAt]
    );
    await seed.query(
      `INSERT INTO outcome_governed_valuation_model_qualification
        (qualification_id,scope_key,outcome,artifact_id,player_run_id,pick_run_id,
         policy_artifact_id,player_criteria_artifact_id,pick_criteria_artifact_id,
         player_evidence_artifact_id,pick_evidence_artifact_id,evaluated_at,
         content_sha256,content_canonical_json,qualification_json)
       VALUES ($1,$2,'qualified',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'{}','{}'::jsonb)`,
      [
        modelQualificationId,
        scopeKey,
        `artifact:${'5'.repeat(64)}`,
        `model-run:${'6'.repeat(64)}`,
        `model-run:${'7'.repeat(64)}`,
        ...['8', '9', 'a', 'b', 'c'].map((value) => `artifact:${value.repeat(64)}`),
        createdAt,
        '3'.repeat(64),
      ]
    );
    await seed.query(
      `INSERT INTO outcome_governed_model_qualification_work
        (work_id,scope_key,qualification_id,player_gate3_decision_id,
         pick_gate3_decision_id,available_at,status,work_json)
       VALUES ($1,$2,$3,$4,$5,$6,'pending','{}'::jsonb)`,
      [
        modelQualificationWorkId,
        scopeKey,
        modelQualificationId,
        `gate-decision:${'d'.repeat(64)}`,
        `gate-decision:${'e'.repeat(64)}`,
        createdAt,
      ]
    );
    await seed.query(
      `INSERT INTO outcome_prepared_valuation_input_set
        (prepared_input_set_id,content_sha256,schema_version,environment,scope_key,
         factual_release_scope_key,factual_release_id,qualification_report_id,trade_count,
         ready_count,blocked_count,prepared_at,content_canonical_json,
         prepared_set_canonical_json,prepared_set_json,finalized_at)
       VALUES ($1,$2,'afl-trade-prepared-valuation-input-set/v3','non_production',$3,
               'fixture-release-scope',$4,$5,2,0,2,$6,'{}','{}','{}'::jsonb,$6)`,
      [
        preparedInputSetId,
        '1'.repeat(64),
        scopeKey,
        factualReleaseId,
        `valuation-source-qualification:${'f'.repeat(64)}`,
        createdAt,
      ]
    );
    for (const [ordinal, tradeId] of ['trade-a', 'trade-b'].entries()) {
      const evidenceDigest = (ordinal === 0 ? '8' : '9').repeat(64);
      await seed.query(
        `INSERT INTO outcome_prepared_valuation_input_entry
          (prepared_input_set_id,ordinal,trade_id,state,entry_canonical_json,entry_json)
         VALUES ($1,$2,$3,'blocked','{}',$4::jsonb)`,
        [
          preparedInputSetId,
          ordinal + 1,
          tradeId,
          canonicalizeAflTradeJson({
            tradeId,
            state: 'blocked',
            blockers: [
              {
                code: 'component_output_unavailable',
                subject: { kind: 'trade', id: tradeId },
                evidenceRefs: [
                  {
                    artifactId: `artifact:${evidenceDigest}`,
                    contentSha256: evidenceDigest,
                    storageUri: `artifact://sha256/${evidenceDigest}`,
                    mediaType: 'application/json',
                    byteLength: 128,
                    createdAt,
                  },
                ],
              },
            ],
          }),
        ]
      );
    }
    await seed.query(
      `INSERT INTO outcome_active_release(scope_key,release_id,activated_at,revision)
       VALUES ('fixture-release-scope',$1,$2,1)`,
      [factualReleaseId, createdAt]
    );
    await seed.query(
      `INSERT INTO outcome_current_prepared_valuation_input_set
        (scope_key,prepared_input_set_id,revision,activated_at) VALUES ($1,$2,1,$3)`,
      [scopeKey, preparedInputSetId, createdAt]
    );
    await seed.query(
      `INSERT INTO outcome_current_governed_valuation_model_pair
        (scope_key,revision,qualification_id,player_run_id,pick_run_id,
         player_gate3_decision_id,pick_gate3_decision_id,work_id,advanced_at)
       VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        scopeKey,
        modelQualificationId,
        `model-run:${'6'.repeat(64)}`,
        `model-run:${'7'.repeat(64)}`,
        `gate-decision:${'d'.repeat(64)}`,
        `gate-decision:${'e'.repeat(64)}`,
        modelQualificationWorkId,
        createdAt,
      ]
    );
    await seed.query('COMMIT');
  } catch (error) {
    await seed.query('ROLLBACK');
    throw error;
  } finally {
    seed.release();
  }
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminPool.end();
});

beforeEach(async () => {
  await pool.query(`TRUNCATE outcome_private_evaluation_execution_attempt,
    outcome_private_evaluation_execution_work,outcome_private_evaluation_execution_cycle`);
});

function batch(at: string) {
  return createGovernedPrivateEvaluationBatch({
    scopeKey,
    preparedInputSetId,
    preparedInputSetRevision: 1,
    factualReleaseId,
    modelQualificationId,
    modelQualificationWorkId,
    entries: ['trade-a', 'trade-b'].map((tradeId) => ({
      tradeId,
      state: 'unavailable' as const,
      blockers: [{ code: 'engineering_unavailable' as const, message: 'Fixture isolation.' }],
    })),
    createdAt: at,
  });
}

async function insertBatchParent(retained: GovernedPrivateEvaluationBatch) {
  const contentCanonicalJson = canonicalizeAflTradeJson(retained.content);
  await pool.query(
    `INSERT INTO outcome_private_evaluation_batch
      (batch_id,scope_key,prepared_input_set_id,prepared_input_set_revision,
       factual_release_id,model_qualification_id,model_qualification_work_id,
       trade_count,ready_count,unavailable_count,created_at,content_sha256,
       content_canonical_json,batch_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
    [
      retained.batchId,
      retained.content.scopeKey,
      retained.content.preparedInputSetId,
      retained.content.preparedInputSetRevision,
      retained.content.factualReleaseId,
      retained.content.modelQualificationId,
      retained.content.modelQualificationWorkId,
      retained.content.tradeCount,
      retained.content.readyCount,
      retained.content.unavailableCount,
      retained.content.createdAt,
      retained.batchId.slice('private-evaluation-batch:'.length),
      contentCanonicalJson,
      canonicalizeAflTradeJson(retained),
    ]
  );
}

function artifactRef(marker: string, at: string) {
  const digest = createAflTradeContentAddress('fixture-artifact', { marker }).slice(
    'fixture-artifact:'.length
  );
  return {
    artifactId: `artifact:${digest}`,
    contentSha256: digest,
    storageUri: `artifact://sha256/${digest}`,
    mediaType: 'application/json',
    byteLength: 128,
    createdAt: at,
  } as const;
}

function fixtureManifest(tradeId: string) {
  const digest = createAflTradeContentAddress('fixture-manifest', { tradeId }).slice(
    'fixture-manifest:'.length
  );
  return {
    manifestId: `private-evaluation-materialization-manifest:${digest}`,
    manifestArtifact: artifactRef(`${tradeId}-manifest`, createdAt),
  } as const;
}

async function seedBatchOperator(principalId: string, authorizedAt: string) {
  const evidenceId = createAflTradeContentAddress('reviewer-authority-evidence', {
    principalId,
    scopeKey,
  });
  const decisionId = createAflTradeContentAddress('review-decision', {
    evidenceId,
    principalId,
  });
  const artifact = artifactRef(`${principalId}-authority`, authorizedAt);
  const seed = await pool.connect();
  try {
    await seed.query('BEGIN');
    await seed.query(`SET LOCAL session_replication_role='replica'`);
    await seed.query(
      `INSERT INTO outcome_artifact_custody
        (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
         environment,created_at,verified_at,custody_json)
       VALUES ($1,$2,$3,$4,$5,'derived_private','test_fixture',$6,$6,'{}'::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        artifact.artifactId,
        artifact.contentSha256,
        artifact.storageUri,
        artifact.mediaType,
        artifact.byteLength,
        artifact.createdAt,
      ]
    );
    await seed.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
       VALUES ($1,'governed_evidence_reference',$2,'approved','Fixture batch withdrawal proof',
               '{}'::jsonb,'fixture-governance-writer',$3) ON CONFLICT DO NOTHING`,
      [decisionId, evidenceId, authorizedAt]
    );
    await seed.query(
      `INSERT INTO outcome_governed_evidence_reference
        (reference_id,reference_sha256,evidence_kind,artifact_id,environment,status,
         approval_decision_id,created_at,evidence_canonical_json,evidence_json)
       VALUES ($1,$2,'reviewer_authority_evidence',$3,'test_fixture','approved',$4,$5,'{}','{}'::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        evidenceId,
        evidenceId.slice('reviewer-authority-evidence:'.length),
        artifact.artifactId,
        decisionId,
        authorizedAt,
      ]
    );
    await seed.query(
      `INSERT INTO outcome_operational_principal_authority
        (authority_evidence_id,principal_ref,role,scope_key,provider,capability_id,
         competition,valid_from_season,valid_through_season,valid_from,valid_through)
       VALUES ($1,$2,'afl_trade_private_evaluation_operator',$3,'statly_modeling',
               'manage_private_trade_evaluation','AFLM',1897,2200,$4,NULL)
       ON CONFLICT DO NOTHING`,
      [evidenceId, principalId, scopeKey, authorizedAt]
    );
    await seed.query('COMMIT');
  } catch (error) {
    await seed.query('ROLLBACK');
    throw error;
  } finally {
    seed.release();
  }
}

function countingClient(delegate: AflOutcomeSqlClient) {
  let queryCount = 0;
  const wrap = (transaction: AflOutcomeSqlTransaction): AflOutcomeSqlTransaction => ({
    async query<Row>(sql: string, parameters?: readonly unknown[]) {
      queryCount += 1;
      return transaction.query<Row>(sql, parameters);
    },
  });
  const client: AflOutcomeSqlClient = {
    ...wrap(delegate),
    transaction: (work) => delegate.transaction((transaction) => work(wrap(transaction))),
  };
  return { client, queryCount: () => queryCount };
}

async function seedReadyRunnerGeneration(input: {
  readonly tradeId: string;
  readonly operationId: string;
  readonly generatedAt: string;
  readonly preparedInputSetRevision: number;
  readonly factualReleaseRevision: number;
  readonly narrative?: ReturnType<typeof createGovernedPrivateEvaluationNarrativeFixture>;
}) {
  const { manifestId, manifestArtifact } = input.narrative
    ? fixtureManifest(input.tradeId)
    : {
        manifestId: `private-evaluation-materialization-manifest:${(input.tradeId === 'trade-a'
          ? '6'
          : '7'
        ).repeat(64)}`,
        manifestArtifact: artifactRef(input.tradeId === 'trade-a' ? '6' : '7', createdAt),
      };
  const manifestDigest = manifestId.slice('private-evaluation-materialization-manifest:'.length);
  const bundleDigest = createAflTradeContentAddress('fixture-bundle', {
    tradeId: input.tradeId,
  }).slice('fixture-bundle:'.length);
  const bundleArtifact = artifactRef(`${input.tradeId}-bundle`, createdAt);
  const bundleId = `valuation-input-bundle:${bundleDigest}`;
  const component = (
    role: 'player_contribution_and_availability' | 'draft_pick_and_future_pick_distribution',
    index: 0 | 1
  ) => ({
    role,
    runId: `model-run:${(index === 0 ? '6' : '7').repeat(64)}`,
    protocolId: `model-protocol:${(index === 0 ? 'a' : 'b').repeat(64)}`,
    datasetId: `dataset:${(index === 0 ? 'c' : 'd').repeat(64)}`,
    datasetAdmissionId: `dataset-admission:${(index === 0 ? 'e' : 'f').repeat(64)}`,
    datasetAdmissionGateLedgerRevision: index + 1,
    gate3DecisionId: `gate-decision:${(index === 0 ? 'd' : 'e').repeat(64)}`,
    gate3DecisionVersion: 1,
    qualificationId: modelQualificationId,
    qualificationPolicyVersion: 'fixture-policy/v1',
  });
  const calculationAuthority = {
    state: 'ready',
    preparedInputHeadRevision: input.preparedInputSetRevision,
    preparedInputSetId,
    factualRegistryRevision: 1,
    factualReleaseId,
    activeFactualReleaseRevision: input.factualReleaseRevision,
    privateValuationDecisionId: `private-valuation-evaluation-decision:${'a'.repeat(64)}`,
    privateValuationDecisionRevision: 1,
    materializationManifestId: manifestId,
    materializationManifestArtifact: manifestArtifact,
    valuationInputBundleId: bundleId,
    valuationInputBundleArtifact: bundleArtifact,
    gateLedgerRevision: 2,
    components: [
      component('player_contribution_and_availability', 0),
      component('draft_pick_and_future_pick_distribution', 1),
    ],
  } as const;
  const transitionIntentId = createAflTradeContentAddress('private-evaluation-transition-intent', {
    operationId: input.operationId,
    tradeId: input.tradeId,
  });
  const materialization = input.narrative
    ? createAutomatedGovernedPrivateEvaluationGeneration({
        selector: { valuationScopeKey: scopeKey, tradeId: input.tradeId },
        transitionIntentId,
        generatedAt: input.generatedAt,
        constructionAuthority: {
          kind: 'automated_private_calculation_agent',
          principalId: 'system:weekly-valuation-coordinator',
        },
        narrative: input.narrative,
      })
    : null;
  const authorityArtifactId = (kind: string, legacyA: string, legacyB: string) =>
    input.narrative
      ? artifactRef(`${input.tradeId}-${kind}`, createdAt).artifactId
      : `artifact:${(input.tradeId === 'trade-a' ? legacyA : legacyB).repeat(64)}`;
  const generationId =
    materialization?.generation.generationId ??
    createAflTradeContentAddress('local-private-trade-evaluation-generation', {
      operationId: input.operationId,
      tradeId: input.tradeId,
    });
  const generation =
    materialization?.generation ??
    ({
      generationId,
      content: {
        schemaVersion: 'local-private-trade-evaluation-generation/v2',
        environment: 'non_production',
        selector: { valuationScopeKey: scopeKey, tradeId: input.tradeId },
        transitionIntentId,
        narrativeId: `trade-calculation-narrative:${'1'.repeat(64)}`,
        narrativeArtifact: artifactRef(`${input.tradeId}-narrative`, input.generatedAt),
        projectionManifestId: `private-evaluation-projection-manifest:${'3'.repeat(64)}`,
        projectionManifestArtifact: artifactRef(`${input.tradeId}-projection`, input.generatedAt),
        generatedAt: input.generatedAt,
        constructionAuthority: {
          kind: 'automated_private_calculation_agent',
          principalId: 'system:weekly-valuation-coordinator',
        },
        activationReceipt: 'separate_append_only_transition',
        publicationProhibited: true,
      },
    } as const);
  parseGovernedPrivateEvaluationGeneration(generation);
  const existing = await pool.query<{ readonly generation_id: string }>(
    `SELECT generation_id FROM outcome_local_private_trade_evaluation_generation
      WHERE generation_id=$1`,
    [generationId]
  );
  if (existing.rows.length === 1)
    return { generationId, manifestId, manifestArtifact, materialization };
  const seed = await pool.connect();
  try {
    await seed.query('BEGIN');
    await seed.query(`SET LOCAL session_replication_role='replica'`);
    for (const ref of [
      manifestArtifact,
      bundleArtifact,
      ...(materialization?.artifacts.map(({ reference }) => reference) ?? []),
    ]) {
      await seed.query(
        `INSERT INTO outcome_artifact_custody
          (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
           environment,created_at,verified_at,custody_json)
         VALUES ($1,$2,$3,$4,$5,'derived_private','non_production',$6,$6,'{}'::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          ref.artifactId,
          ref.contentSha256,
          ref.storageUri,
          ref.mediaType,
          ref.byteLength,
          ref.createdAt,
        ]
      );
    }
    await seed.query(
      `UPDATE outcome_governed_valuation_model_qualification
          SET qualification_json=jsonb_build_object('content',jsonb_build_object(
            'policy',jsonb_build_object('policyVersion','fixture-policy/v1')))
        WHERE qualification_id=$1`,
      [modelQualificationId]
    );
    for (const [index, authority] of calculationAuthority.components.entries()) {
      await seed.query(
        `INSERT INTO outcome_governed_valuation_component_run
          (run_id,role,native_execution_kind,native_execution_id,artifact_id,
           native_execution_artifact_id,protocol_id,protocol_artifact_id,dataset_id,
           dataset_artifact_id,dataset_admission_id,dataset_admission_artifact_id,
           dataset_admission_gate_ledger_revision,registered_at,content_sha256,
           content_canonical_json,manifest_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'{}','{}'::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          authority.runId,
          authority.role,
          index === 0 ? 'admitted_player_model_run' : 'pick_pav_model_execution',
          index === 0
            ? `model-run:${'5'.repeat(64)}`
            : `pick-pav-model-execution:${'5'.repeat(64)}`,
          `artifact:${(index === 0 ? 'a' : 'b').repeat(64)}`,
          `artifact:${(index === 0 ? 'c' : 'd').repeat(64)}`,
          authority.protocolId,
          `artifact:${(index === 0 ? 'e' : 'f').repeat(64)}`,
          authority.datasetId,
          `artifact:${(index === 0 ? '0' : '1').repeat(64)}`,
          authority.datasetAdmissionId,
          `artifact:${(index === 0 ? '2' : '3').repeat(64)}`,
          authority.datasetAdmissionGateLedgerRevision,
          createdAt,
          authority.runId.slice('model-run:'.length),
        ]
      );
      await seed.query(
        `INSERT INTO outcome_gate_decision
          (decision_id,proposal_id,gate,decision_key,version,environment,state,
           decided_at,effective_at,revalidate_at,supersedes_decision_id,decision_json)
         VALUES ($1,$2,'gate_3_model_approval',$3,1,'non_production','approved',
                 $4,$4,'2099-01-01T00:00:00.000Z',NULL,'{}'::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          authority.gate3DecisionId,
          `gate-proposal:${(index === 0 ? '4' : '5').repeat(64)}`,
          `fixture-ready-${index}`,
          createdAt,
        ]
      );
    }
    await seed.query(
      `INSERT INTO outcome_private_evaluation_materialization_manifest
        (materialization_manifest_id,content_sha256,valuation_scope_key,trade_id,
         artifact_id,created_at,content_canonical_json,manifest_canonical_json,manifest_json)
       VALUES ($1,$2,$3,$4,$5,$6,'{}','{}',$7::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        manifestId,
        manifestDigest,
        scopeKey,
        input.tradeId,
        manifestArtifact.artifactId,
        createdAt,
        canonicalizeAflTradeJson({
          content: {
            valuationInputBundleId: bundleId,
            valuationInputBundleArtifact: bundleArtifact,
          },
        }),
      ]
    );
    const snapshotId = createAflTradeContentAddress('private-evaluation-authority-snapshot', {
      operationId: input.operationId,
      tradeId: input.tradeId,
    });
    await seed.query(
      `INSERT INTO outcome_private_evaluation_authority_snapshot
        (snapshot_id,valuation_scope_key,trade_id,artifact_id,captured_at,valid_through,
         expected_head_status,expected_head_revision,expected_head_generation_id,
         content_sha256,content_canonical_json,snapshot_json)
       VALUES ($1,$2,$3,$4,$5,'2099-01-01T00:00:00.000Z','absent',0,NULL,$6,'{}',$7::jsonb)`,
      [
        snapshotId,
        scopeKey,
        input.tradeId,
        authorityArtifactId('snapshot', '4', '5'),
        createdAt,
        snapshotId.slice('private-evaluation-authority-snapshot:'.length),
        canonicalizeAflTradeJson({ content: { calculationAuthority } }),
      ]
    );
    const inspectionId = createAflTradeContentAddress('private-evaluation-inspection', {
      operationId: input.operationId,
      tradeId: input.tradeId,
    });
    await seed.query(
      `INSERT INTO outcome_private_evaluation_inspection_receipt
        (inspection_id,snapshot_id,valuation_scope_key,trade_id,artifact_id,state,
         inspected_at,valid_through,expected_head_status,expected_head_revision,
         expected_head_generation_id,content_sha256,content_canonical_json,receipt_json)
       VALUES ($1,$2,$3,$4,$5,'ready',$6,'2099-01-01T00:00:00.000Z','absent',0,NULL,$7,'{}','{}'::jsonb)`,
      [
        inspectionId,
        snapshotId,
        scopeKey,
        input.tradeId,
        authorityArtifactId('inspection', '6', '7'),
        createdAt,
        inspectionId.slice('private-evaluation-inspection:'.length),
      ]
    );
    await seed.query(
      `INSERT INTO outcome_private_evaluation_transition_intent
        (transition_intent_id,inspection_id,authority_snapshot_id,operation_id,
         valuation_scope_key,trade_id,artifact_id,action,expected_head_status,
         expected_head_revision,expected_head_generation_id,target_generation_id,
         requested_at,expires_at,content_sha256,content_canonical_json,intent_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'construct_and_activate','absent',0,NULL,NULL,
               $8,'2099-01-01T00:00:00.000Z',$9,'{}','{}'::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        transitionIntentId,
        inspectionId,
        snapshotId,
        input.operationId,
        scopeKey,
        input.tradeId,
        authorityArtifactId('intent', '8', '9'),
        createdAt,
        transitionIntentId.slice('private-evaluation-transition-intent:'.length),
      ]
    );
    await seed.query(
      `INSERT INTO outcome_local_private_trade_evaluation_generation
        (generation_id,valuation_scope_key,trade_id,transition_intent_id,
         generation_artifact_id,narrative_artifact_id,projection_manifest_artifact_id,
         generated_at,content_sha256,content_canonical_json,generation_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}',$10::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        generationId,
        scopeKey,
        input.tradeId,
        transitionIntentId,
        materialization?.artifacts.find(({ kind }) => kind === 'generation')?.reference
          .artifactId ?? generation.content.narrativeArtifact.artifactId,
        generation.content.narrativeArtifact.artifactId,
        generation.content.projectionManifestArtifact.artifactId,
        input.generatedAt,
        generationId.slice('local-private-trade-evaluation-generation:'.length),
        canonicalizeAflTradeJson(generation),
      ]
    );
    const transitionId = createAflTradeContentAddress('private-evaluation-transition', {
      operationId: input.operationId,
      tradeId: input.tradeId,
    });
    await seed.query(
      `INSERT INTO outcome_private_evaluation_transition_receipt
        (transition_id,transition_intent_id,operation_id,valuation_scope_key,trade_id,
         artifact_id,action,from_revision,from_status,from_generation_id,to_revision,
         to_status,to_generation_id,transitioned_at,content_sha256,content_canonical_json,receipt_json)
       VALUES ($1,$2,$3,$4,$5,$6,'construct_and_activate',0,'absent',NULL,1,
               'active',$7,$8,$9,'{}','{}'::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        transitionId,
        transitionIntentId,
        input.operationId,
        scopeKey,
        input.tradeId,
        authorityArtifactId('receipt', 'a', 'b'),
        generationId,
        input.generatedAt,
        transitionId.slice('private-evaluation-transition:'.length),
      ]
    );
    await seed.query('COMMIT');
  } catch (error) {
    await seed.query('ROLLBACK');
    throw error;
  } finally {
    seed.release();
  }
  return { generationId, manifestId, manifestArtifact, materialization };
}

describe('PostgreSQL atomic private evaluation batches', () => {
  it('registers exhaustively, advances by fenced CAS, replays, and rolls back whole batches', async () => {
    const repository = new PostgresGovernedPrivateEvaluationBatchRepository(
      createPgAflOutcomeSqlClient(pool),
      async () => true
    );
    const automaticRunner = createPostgresAflTradePrivateEvaluationCohortRunner({
      client: createPgAflOutcomeSqlClient(pool),
      batchRepository: repository,
      workspace: {
        stageAutomated: async () => {
          throw new Error('Blocked prepared entries must not stage.');
        },
        inspect: async () => {
          throw new Error('Not used by the cohort runner.');
        },
        execute: async () => {
          throw new Error('Not used by the cohort runner.');
        },
        read: async () => {
          throw new Error('Not used by the cohort runner.');
        },
      },
    });
    const automaticallyActivated = await automaticRunner.runCurrent(scopeKey);
    expect(automaticallyActivated).toMatchObject({ state: 'activated', head: { revision: 1 } });
    await expect(automaticRunner.runCurrent(scopeKey)).resolves.toMatchObject({
      state: 'already_current',
      head: { revision: 1 },
    });
    const first = batch(createdAt);
    const second = batch('2026-08-20T09:00:00.001Z');
    await expect(repository.register(first)).resolves.toEqual(first);
    await expect(repository.register(first)).resolves.toEqual(first);
    await repository.register(second);
    const operation = (
      batchId: string,
      expectedRevision: number,
      action: 'activate' | 'rollback'
    ) =>
      createGovernedPrivateEvaluationBatchOperationId({
        scopeKey,
        batchId,
        expectedRevision,
        action,
      });
    const activation = await repository.advance({
      scopeKey,
      batchId: first.batchId,
      expectedRevision: 1,
      operationId: operation(first.batchId, 1, 'activate'),
      action: 'activate',
    });
    expect(activation).toMatchObject({ batchId: first.batchId, revision: 2 });
    await expect(
      repository.advance({
        scopeKey,
        batchId: first.batchId,
        expectedRevision: 1,
        operationId: operation(first.batchId, 1, 'activate'),
        action: 'activate',
      })
    ).resolves.toEqual(activation);
    await expect(
      repository.advance({
        scopeKey,
        batchId: second.batchId,
        expectedRevision: 1,
        operationId: operation(second.batchId, 1, 'activate'),
        action: 'activate',
      })
    ).rejects.toThrow(/compare-and-swap|lost current authority/i);
    const replacement = await repository.advance({
      scopeKey,
      batchId: second.batchId,
      expectedRevision: 2,
      operationId: operation(second.batchId, 2, 'activate'),
      action: 'activate',
    });
    expect(replacement).toMatchObject({ batchId: second.batchId, revision: 3 });
    const authorityShift = await pool.connect();
    try {
      await authorityShift.query('BEGIN');
      await authorityShift.query(`SET LOCAL session_replication_role='replica'`);
      await authorityShift.query(
        `UPDATE outcome_current_prepared_valuation_input_set
            SET prepared_input_set_id=$2,revision=2 WHERE scope_key=$1`,
        [scopeKey, `prepared-valuation-input-set:${'a'.repeat(64)}`]
      );
      await authorityShift.query(
        `UPDATE outcome_current_governed_valuation_model_pair
            SET qualification_id=$2,work_id=$3,revision=2 WHERE scope_key=$1`,
        [
          scopeKey,
          `model-qualification:${'b'.repeat(64)}`,
          `model-qualification-work:${'c'.repeat(64)}`,
        ]
      );
      await authorityShift.query(
        `UPDATE outcome_active_release SET release_id=$2,revision=2 WHERE scope_key=$1`,
        ['fixture-release-scope', `outcome-release:${'d'.repeat(64)}`]
      );
      await authorityShift.query('COMMIT');
    } finally {
      authorityShift.release();
    }
    await expect(
      repository.advance({
        scopeKey,
        batchId: second.batchId,
        expectedRevision: 2,
        operationId: operation(second.batchId, 2, 'activate'),
        action: 'activate',
      })
    ).resolves.toEqual(replacement);
    await expect(
      repository.advance({
        scopeKey,
        batchId: first.batchId,
        expectedRevision: 3,
        operationId: operation(first.batchId, 3, 'rollback'),
        action: 'rollback',
      })
    ).resolves.toMatchObject({ batchId: first.batchId, revision: 4 });
    const authorityRestore = await pool.connect();
    try {
      await authorityRestore.query('BEGIN');
      await authorityRestore.query(`SET LOCAL session_replication_role='replica'`);
      await authorityRestore.query(
        `UPDATE outcome_current_prepared_valuation_input_set
            SET prepared_input_set_id=$2,revision=1 WHERE scope_key=$1`,
        [scopeKey, preparedInputSetId]
      );
      await authorityRestore.query(
        `UPDATE outcome_current_governed_valuation_model_pair
            SET qualification_id=$2,work_id=$3,revision=1 WHERE scope_key=$1`,
        [scopeKey, modelQualificationId, modelQualificationWorkId]
      );
      await authorityRestore.query(
        `UPDATE outcome_active_release SET release_id=$2,revision=1 WHERE scope_key=$1`,
        ['fixture-release-scope', factualReleaseId]
      );
      await authorityRestore.query('COMMIT');
    } finally {
      authorityRestore.release();
    }
    const neverActivated = batch('2026-08-20T09:00:00.002Z');
    await repository.register(neverActivated);
    await expect(
      repository.advance({
        scopeKey,
        batchId: neverActivated.batchId,
        expectedRevision: 4,
        operationId: operation(neverActivated.batchId, 4, 'rollback'),
        action: 'rollback',
      })
    ).rejects.toThrow(/compare-and-swap|lost current authority/i);
    await expect(
      pool.query(
        `SELECT * FROM advance_outcome_current_private_evaluation_batch($1,$2,$3,$4,$5,$6)`,
        [
          scopeKey,
          second.batchId,
          4,
          operation(second.batchId, 4, 'activate'),
          'activate',
          'system:unauthorized-coordinator',
        ]
      )
    ).rejects.toThrow(/invalid/i);
    await expect(
      pool.query(`DELETE FROM outcome_private_evaluation_batch WHERE batch_id=$1`, [first.batchId])
    ).rejects.toThrow(/append-only/i);
  });

  it('rejects a relational entry that disagrees with its authenticated batch envelope', async () => {
    const retained = batch('2026-08-20T09:00:00.003Z');
    await insertBatchParent(retained);
    await expect(
      pool.query(
        `INSERT INTO outcome_private_evaluation_batch_entry
          (batch_id,ordinal,trade_id,state,generation_id,entry_json)
         VALUES ($1,0,'trade-a','unavailable',NULL,$2::jsonb)`,
        [
          retained.batchId,
          canonicalizeAflTradeJson({
            tradeId: 'trade-a',
            state: 'unavailable',
            blockers: [{ code: 'engineering_unavailable', message: 'Different explanation.' }],
          }),
        ]
      )
    ).rejects.toThrow(/does not match/i);
  });

  it('rejects noncanonical ordering and forged blocker evidence at direct SQL custody', async () => {
    const retained = batch('2026-08-20T09:00:00.004Z');
    const unsortedContent = {
      ...retained.content,
      entries: [...retained.content.entries].reverse(),
    };
    const unsorted = {
      batchId: createAflTradeContentAddress('private-evaluation-batch', unsortedContent),
      content: unsortedContent,
    } as GovernedPrivateEvaluationBatch;
    await expect(insertBatchParent(unsorted)).rejects.toThrow(/identity|ancestry/i);

    const forgedContent = {
      ...retained.content,
      entries: retained.content.entries.map((entry, index) =>
        index === 0 && entry.state === 'unavailable'
          ? { ...entry, blockers: [{ code: 'invented_blocker', message: 'Forged.' }] }
          : entry
      ),
    };
    const forged = {
      batchId: createAflTradeContentAddress('private-evaluation-batch', forgedContent),
      content: forgedContent,
    } as unknown as GovernedPrivateEvaluationBatch;
    await expect(insertBatchParent(forged)).rejects.toThrow(/identity|ancestry/i);
  });

  it('retains unexpected runner diagnostics and preserves the current batch', async () => {
    const manifestDigest = '7'.repeat(64);
    const readyEntry = {
      tradeId: 'trade-a',
      state: 'ready' as const,
      materializationManifestId: `private-evaluation-materialization-manifest:${manifestDigest}`,
      materializationManifestArtifact: {
        artifactId: `artifact:${manifestDigest}`,
        contentSha256: manifestDigest,
        storageUri: `artifact://sha256/${manifestDigest}`,
        mediaType: 'application/json',
        byteLength: 128,
        createdAt,
      },
    };
    const mutation = await pool.connect();
    try {
      await mutation.query('BEGIN');
      await mutation.query(`SET LOCAL session_replication_role='replica'`);
      await mutation.query(
        `UPDATE outcome_prepared_valuation_input_entry
            SET state='ready',entry_canonical_json=$2::text,entry_json=$2::jsonb
          WHERE prepared_input_set_id=$1 AND trade_id='trade-a'`,
        [preparedInputSetId, canonicalizeAflTradeJson(readyEntry)]
      );
      await mutation.query(
        `UPDATE outcome_current_prepared_valuation_input_set SET revision=2 WHERE scope_key=$1`,
        [scopeKey]
      );
      await mutation.query('COMMIT');
    } finally {
      mutation.release();
    }
    const repository = new PostgresGovernedPrivateEvaluationBatchRepository(
      createPgAflOutcomeSqlClient(pool),
      async () => true
    );
    const runner = createPostgresAflTradePrivateEvaluationCohortRunner({
      client: createPgAflOutcomeSqlClient(pool),
      batchRepository: repository,
      workspace: {
        stageAutomated: async () => {
          throw new TypeError('exact retained ancestry failure');
        },
        inspect: async () => {
          throw new Error('Not used by the cohort runner.');
        },
        execute: async () => {
          throw new Error('Not used by the cohort runner.');
        },
        read: async () => {
          throw new Error('Not used by the cohort runner.');
        },
      },
    });

    await expect(runner.runCurrent(scopeKey)).resolves.toMatchObject({
      state: 'unexpected_failure',
      diagnostics: [{ tradeId: 'trade-a', message: 'exact retained ancestry failure' }],
    });
    const conflictingReplay = createPostgresAflTradePrivateEvaluationCohortRunner({
      client: createPgAflOutcomeSqlClient(pool),
      batchRepository: repository,
      workspace: {
        stageAutomated: async () => {
          throw new TypeError('different retry failure');
        },
        inspect: async () => {
          throw new Error('Not used by the cohort runner.');
        },
        execute: async () => {
          throw new Error('Not used by the cohort runner.');
        },
        read: async () => {
          throw new Error('Not used by the cohort runner.');
        },
      },
    });
    await expect(conflictingReplay.runCurrent(scopeKey)).resolves.toEqual({
      state: 'exhausted',
      exhaustedTradeIds: ['trade-a'],
    });
    await expect(
      pool.query(`SELECT diagnostic_json FROM outcome_private_evaluation_cohort_failure`)
    ).resolves.toMatchObject({
      rows: [{ diagnostic_json: { content: { diagnostics: [{ tradeId: 'trade-a' }] } } }],
    });
    await expect(repository.loadCurrent(scopeKey)).resolves.toMatchObject({
      head: { revision: 4 },
    });
  });

  it('retains exact diagnostics when another trade detects stale authority mid-run', async () => {
    const manifestDigest = '6'.repeat(64);
    const readyEntry = {
      tradeId: 'trade-b',
      state: 'ready' as const,
      materializationManifestId: `private-evaluation-materialization-manifest:${manifestDigest}`,
      materializationManifestArtifact: {
        artifactId: `artifact:${manifestDigest}`,
        contentSha256: manifestDigest,
        storageUri: `artifact://sha256/${manifestDigest}`,
        mediaType: 'application/json',
        byteLength: 128,
        createdAt,
      },
    };
    const setup = await pool.connect();
    try {
      await setup.query('BEGIN');
      await setup.query(`SET LOCAL session_replication_role='replica'`);
      await setup.query(
        `UPDATE outcome_prepared_valuation_input_entry
            SET state='ready',entry_canonical_json=$2::text,entry_json=$2::jsonb
          WHERE prepared_input_set_id=$1 AND trade_id='trade-b'`,
        [preparedInputSetId, canonicalizeAflTradeJson(readyEntry)]
      );
      await setup.query(
        `UPDATE outcome_current_prepared_valuation_input_set SET revision=3 WHERE scope_key=$1`,
        [scopeKey]
      );
      await setup.query('COMMIT');
    } finally {
      setup.release();
    }
    const repository = new PostgresGovernedPrivateEvaluationBatchRepository(
      createPgAflOutcomeSqlClient(pool),
      async () => true
    );
    const runner = createPostgresAflTradePrivateEvaluationCohortRunner({
      client: createPgAflOutcomeSqlClient(pool),
      batchRepository: repository,
      workspace: {
        stageAutomated: async ({ selector }) => {
          if (selector.tradeId === 'trade-a') {
            throw new TypeError('retained despite the authority race');
          }
          const shift = await pool.connect();
          try {
            await shift.query('BEGIN');
            await shift.query(`SET LOCAL session_replication_role='replica'`);
            await shift.query(
              `UPDATE outcome_current_prepared_valuation_input_set
                  SET revision=4 WHERE scope_key=$1`,
              [scopeKey]
            );
            await shift.query('COMMIT');
          } finally {
            shift.release();
          }
          return { state: 'stale_authority' as const };
        },
        inspect: async () => {
          throw new Error('Not used by the cohort runner.');
        },
        execute: async () => {
          throw new Error('Not used by the cohort runner.');
        },
        read: async () => {
          throw new Error('Not used by the cohort runner.');
        },
      },
    });

    await expect(runner.runCurrent(scopeKey)).resolves.toMatchObject({
      state: 'unexpected_failure',
      diagnostics: [{ tradeId: 'trade-a', message: 'retained despite the authority race' }],
    });
    await expect(repository.loadCurrent(scopeKey)).resolves.toMatchObject({
      head: { revision: 4 },
    });
  });

  it('classifies PostgreSQL serialization failures and resumes attempts two and three after restart', async () => {
    const manifestDigest = '5'.repeat(64);
    const readyEntry = {
      tradeId: 'trade-a',
      state: 'ready' as const,
      materializationManifestId: `private-evaluation-materialization-manifest:${manifestDigest}`,
      materializationManifestArtifact: artifactRef('5', createdAt),
    };
    const setup = await pool.connect();
    try {
      await setup.query('BEGIN');
      await setup.query(`SET LOCAL session_replication_role='replica'`);
      await setup.query(
        `UPDATE outcome_prepared_valuation_input_entry
            SET state='ready',entry_canonical_json=$2::text,entry_json=$2::jsonb
          WHERE prepared_input_set_id=$1 AND trade_id='trade-a'`,
        [preparedInputSetId, canonicalizeAflTradeJson(readyEntry)]
      );
      await setup.query(
        `UPDATE outcome_current_prepared_valuation_input_set SET revision=5 WHERE scope_key=$1`,
        [scopeKey]
      );
      await setup.query('COMMIT');
    } finally {
      setup.release();
    }
    const createRunner = () =>
      createPostgresAflTradePrivateEvaluationCohortRunner({
        client: createPgAflOutcomeSqlClient(pool),
        batchRepository: new PostgresGovernedPrivateEvaluationBatchRepository(
          createPgAflOutcomeSqlClient(pool),
          async () => true
        ),
        workspace: {
          stageAutomated: async ({ selector }) => {
            if (selector.tradeId === 'trade-a') {
              throw Object.assign(new Error('serialization conflict'), { code: '40001' });
            }
            return {
              state: 'unavailable' as const,
              blockers: [{ code: 'insufficient_data', message: 'No retained observations.' }],
            };
          },
          inspect: async () => {
            throw new Error('Not used by the cohort runner.');
          },
          execute: async () => {
            throw new Error('Not used by the cohort runner.');
          },
          read: async () => {
            throw new Error('Not used by the cohort runner.');
          },
        },
      });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await createRunner().runCurrent(scopeKey);
      expect(result).toEqual(
        attempt < 3
          ? { state: 'retry_pending', pendingTradeIds: ['trade-a'] }
          : { state: 'exhausted', exhaustedTradeIds: ['trade-a'] }
      );
      if (attempt < 3) {
        const due = await pool.connect();
        try {
          await due.query('BEGIN');
          await due.query(`SET LOCAL session_replication_role='replica'`);
          await due.query(
            `UPDATE outcome_private_evaluation_execution_work
                SET available_at=transaction_timestamp()-interval '1 second'
              WHERE trade_id='trade-a' AND status='retry_wait'`
          );
          await due.query('COMMIT');
        } finally {
          due.release();
        }
      }
    }
    await expect(
      pool.query(
        `SELECT attempt_number,outcome,cause_json FROM outcome_private_evaluation_execution_attempt
          WHERE trade_id='trade-a' ORDER BY attempt_number`
      )
    ).resolves.toMatchObject({
      rows: [
        { attempt_number: 1, outcome: 'transient_failure', cause_json: { code: 'postgres_40001' } },
        { attempt_number: 2, outcome: 'transient_failure', cause_json: { code: 'postgres_40001' } },
        { attempt_number: 3, outcome: 'transient_failure', cause_json: { code: 'postgres_40001' } },
      ],
    });
    const repairRunner = createRunner();
    const repairOperationId = `cohort-execution-repair:${'5'.repeat(64)}`;
    const repairReason = 'The retained serialization outage was corrected by the backend operator.';
    const repaired = await repairRunner.repairCurrent(scopeKey, repairReason, repairOperationId);
    expect(repaired).toMatchObject({
      content: {
        repairSequence: 1,
        openingPrincipalId: 'system:weekly-valuation-coordinator',
        repairReason,
      },
    });
    await expect(repairRunner.runCurrent(scopeKey)).resolves.toEqual({
      state: 'retry_pending',
      pendingTradeIds: ['trade-a'],
    });
    const shifted = await pool.connect();
    try {
      await shifted.query('BEGIN');
      await shifted.query(`SET LOCAL session_replication_role='replica'`);
      await shifted.query(
        `UPDATE outcome_current_prepared_valuation_input_set SET revision=6 WHERE scope_key=$1`,
        [scopeKey]
      );
      await shifted.query('COMMIT');
    } finally {
      shifted.release();
    }
    await expect(
      repairRunner.repairCurrent(scopeKey, repairReason, repairOperationId)
    ).resolves.toEqual(repaired);
  });

  it.each(['factual release', 'model pair'] as const)(
    'rejects final activation when the %s revision advances mid-run',
    async (authorityKind) => {
      const repository = new PostgresGovernedPrivateEvaluationBatchRepository(
        createPgAflOutcomeSqlClient(pool),
        async () => true
      );
      let shifted = false;
      const runner = createPostgresAflTradePrivateEvaluationCohortRunner({
        client: createPgAflOutcomeSqlClient(pool),
        batchRepository: repository,
        workspace: {
          stageAutomated: async ({ selector }) => {
            if (!shifted && selector.tradeId === 'trade-a') {
              shifted = true;
              const authority = await pool.connect();
              try {
                await authority.query('BEGIN');
                await authority.query(`SET LOCAL session_replication_role='replica'`);
                await authority.query(
                  authorityKind === 'factual release'
                    ? `UPDATE outcome_active_release SET revision=revision+1
                        WHERE scope_key='fixture-release-scope'`
                    : `UPDATE outcome_current_governed_valuation_model_pair
                          SET revision=revision+1 WHERE scope_key=$1`,
                  authorityKind === 'factual release' ? [] : [scopeKey]
                );
                await authority.query('COMMIT');
              } finally {
                authority.release();
              }
            }
            return {
              state: 'unavailable' as const,
              blockers: [
                {
                  code: 'engineering_unavailable',
                  message: 'Fixture completes without a generation.',
                },
              ],
            };
          },
          inspect: async () => {
            throw new Error('Not used by the cohort runner.');
          },
          execute: async () => {
            throw new Error('Not used by the cohort runner.');
          },
          read: async () => {
            throw new Error('Not used by the cohort runner.');
          },
        },
      });

      await expect(runner.runCurrent(scopeKey)).resolves.toEqual({ state: 'stale_authority' });
      await expect(repository.loadCurrent(scopeKey)).resolves.toMatchObject({
        head: { revision: 4 },
      });
    }
  );

  it('reconstructs and activates the same bound batch after interruption before CAS', async () => {
    const interruptedRepository = new PostgresGovernedPrivateEvaluationBatchRepository(
      createPgAflOutcomeSqlClient(pool),
      async () => true
    );
    interruptedRepository.advance = async () => {
      throw new Error('simulated interruption before batch CAS');
    };
    const workspace = {
      stageAutomated: async () => ({
        state: 'unavailable' as const,
        blockers: [
          {
            code: 'engineering_unavailable',
            message: 'Fixture completes without a generation.',
          },
        ],
      }),
      inspect: async () => {
        throw new Error('Not used by the cohort runner.');
      },
      execute: async () => {
        throw new Error('Not used by the cohort runner.');
      },
      read: async () => {
        throw new Error('Not used by the cohort runner.');
      },
    };
    const interrupted = createPostgresAflTradePrivateEvaluationCohortRunner({
      client: createPgAflOutcomeSqlClient(pool),
      batchRepository: interruptedRepository,
      workspace,
    });
    await expect(interrupted.runCurrent(scopeKey)).rejects.toThrow(
      'simulated interruption before batch CAS'
    );
    const bound = await pool.query<{ readonly batch_id: string; readonly operation_id: string }>(
      `SELECT binding.batch_id,binding.operation_id
         FROM outcome_private_evaluation_cohort_batch binding
         JOIN outcome_private_evaluation_cohort_capture capture
           ON capture.operation_id=binding.operation_id
         JOIN outcome_current_governed_valuation_model_pair model_head
           ON model_head.scope_key=capture.scope_key
          AND model_head.revision=capture.model_pair_revision
         JOIN outcome_prepared_valuation_input_set prepared
           ON prepared.prepared_input_set_id=capture.prepared_input_set_id
         JOIN outcome_active_release active_release
           ON active_release.scope_key=prepared.factual_release_scope_key
          AND active_release.revision=capture.factual_release_revision
        WHERE capture.expected_batch_revision=4
        ORDER BY capture.captured_at DESC LIMIT 1`
    );
    expect(bound.rows).toHaveLength(1);

    const replayRepository = new PostgresGovernedPrivateEvaluationBatchRepository(
      createPgAflOutcomeSqlClient(pool),
      async () => true
    );
    const replay = createPostgresAflTradePrivateEvaluationCohortRunner({
      client: createPgAflOutcomeSqlClient(pool),
      batchRepository: replayRepository,
      workspace,
    });
    await expect(replay.runCurrent(scopeKey)).resolves.toMatchObject({
      state: 'activated',
      batch: { batchId: bound.rows[0]!.batch_id },
      head: { revision: 5 },
    });
    await expect(
      pool.query(
        `SELECT count(*)::int AS count FROM outcome_private_evaluation_cohort_batch
          WHERE operation_id=$1`,
        [bound.rows[0]!.operation_id]
      )
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('replays real ready generations into the identical post-generation batch', async () => {
    const authority = await pool.query<{
      readonly prepared_revision: number;
      readonly factual_revision: number;
      readonly head_revision: number;
    }>(
      `SELECT prepared_head.revision AS prepared_revision,
              active_release.revision AS factual_revision,
              batch_head.revision AS head_revision
         FROM outcome_current_prepared_valuation_input_set prepared_head
         JOIN outcome_prepared_valuation_input_set prepared
           ON prepared.prepared_input_set_id=prepared_head.prepared_input_set_id
         JOIN outcome_active_release active_release
           ON active_release.scope_key=prepared.factual_release_scope_key
         JOIN outcome_current_private_evaluation_batch batch_head
           ON batch_head.scope_key=prepared_head.scope_key
        WHERE prepared_head.scope_key=$1`,
      [scopeKey]
    );
    const current = authority.rows[0]!;
    const ready = await pool.connect();
    try {
      await ready.query('BEGIN');
      await ready.query(`SET LOCAL session_replication_role='replica'`);
      for (const tradeId of ['trade-a', 'trade-b']) {
        const marker = tradeId === 'trade-a' ? '6' : '7';
        const manifestDigest = marker.repeat(64);
        const entry = {
          tradeId,
          state: 'ready',
          materializationManifestId: `private-evaluation-materialization-manifest:${manifestDigest}`,
          materializationManifestArtifact: artifactRef(marker, createdAt),
        } as const;
        await ready.query(
          `UPDATE outcome_prepared_valuation_input_entry
              SET state='ready',entry_canonical_json=$3::text,entry_json=$3::jsonb
            WHERE prepared_input_set_id=$1 AND trade_id=$2`,
          [preparedInputSetId, tradeId, canonicalizeAflTradeJson(entry)]
        );
      }
      await ready.query(
        `UPDATE outcome_current_prepared_valuation_input_set
            SET revision=$2 WHERE scope_key=$1`,
        [scopeKey, current.prepared_revision + 1]
      );
      await ready.query('COMMIT');
    } catch (error) {
      await ready.query('ROLLBACK');
      throw error;
    } finally {
      ready.release();
    }
    const stageAutomated = async (input: {
      readonly selector: { readonly valuationScopeKey: string; readonly tradeId: string };
      readonly operationId: string;
    }) => {
      const capture = await pool.query<{
        readonly captured_at: Date;
        readonly trusted_at: Date;
        readonly prepared_input_set_revision: number;
        readonly factual_release_revision: number;
      }>(
        `SELECT captured_at,date_trunc('milliseconds',transaction_timestamp()) AS trusted_at,
                prepared_input_set_revision,factual_release_revision
           FROM outcome_private_evaluation_cohort_capture
          WHERE scope_key=$1 ORDER BY captured_at DESC LIMIT 1`,
        [scopeKey]
      );
      const retainedCapture = capture.rows[0]!;
      const generatedAt = retainedCapture.trusted_at.toISOString();
      const generation = await seedReadyRunnerGeneration({
        tradeId: input.selector.tradeId,
        operationId: input.operationId,
        generatedAt,
        preparedInputSetRevision: retainedCapture.prepared_input_set_revision,
        factualReleaseRevision: retainedCapture.factual_release_revision,
      });
      return { state: 'activated' as const, generationId: generation.generationId };
    };
    const workspace = {
      stageAutomated,
      inspect: async () => {
        throw new Error('Not used by the cohort runner.');
      },
      execute: async () => {
        throw new Error('Not used by the cohort runner.');
      },
      read: async () => {
        throw new Error('Not used by the cohort runner.');
      },
    };
    const interruptedRepository = new PostgresGovernedPrivateEvaluationBatchRepository(
      createPgAflOutcomeSqlClient(pool),
      async () => true
    );
    interruptedRepository.advance = async () => {
      throw new Error('simulated ready interruption before batch CAS');
    };
    const interrupted = createPostgresAflTradePrivateEvaluationCohortRunner({
      client: createPgAflOutcomeSqlClient(pool),
      batchRepository: interruptedRepository,
      workspace,
    });
    await expect(interrupted.runCurrent(scopeKey)).rejects.toThrow(
      'simulated ready interruption before batch CAS'
    );
    const bound = await pool.query<{
      readonly batch_id: string;
      readonly operation_id: string;
      readonly created_at: Date;
      readonly captured_at: Date;
      readonly maximum_generated_at: Date;
    }>(
      `SELECT binding.batch_id,binding.operation_id,batch.created_at,capture.captured_at,
              max(generation.generated_at) AS maximum_generated_at
         FROM outcome_private_evaluation_cohort_batch binding
         JOIN outcome_private_evaluation_cohort_capture capture
           ON capture.operation_id=binding.operation_id
         JOIN outcome_private_evaluation_batch batch ON batch.batch_id=binding.batch_id
         JOIN outcome_private_evaluation_batch_entry entry ON entry.batch_id=batch.batch_id
         JOIN outcome_local_private_trade_evaluation_generation generation
           ON generation.generation_id=entry.generation_id
        WHERE capture.expected_batch_revision=$1
        GROUP BY binding.batch_id,binding.operation_id,batch.created_at,capture.captured_at`,
      [current.head_revision]
    );
    expect(bound.rows).toHaveLength(1);
    expect(bound.rows[0]!.created_at.toISOString()).toBe(
      bound.rows[0]!.maximum_generated_at.toISOString()
    );
    expect(bound.rows[0]!.created_at.getTime()).toBeGreaterThan(
      bound.rows[0]!.captured_at.getTime()
    );

    const replayRepository = new PostgresGovernedPrivateEvaluationBatchRepository(
      createPgAflOutcomeSqlClient(pool),
      async () => true
    );
    const replay = createPostgresAflTradePrivateEvaluationCohortRunner({
      client: createPgAflOutcomeSqlClient(pool),
      batchRepository: replayRepository,
      workspace,
    });
    await expect(replay.runCurrent(scopeKey)).resolves.toMatchObject({
      state: 'activated',
      batch: { batchId: bound.rows[0]!.batch_id, content: { readyCount: 2 } },
      head: { revision: current.head_revision + 1 },
    });
    await expect(
      pool.query(
        `SELECT count(*)::int AS count FROM outcome_private_evaluation_cohort_batch
          WHERE operation_id=$1`,
        [bound.rows[0]!.operation_id]
      )
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('constructs one 2/3/4-club PostgreSQL cohort and keeps every reader pinned through withdrawal', async () => {
    const narratives = [
      createGovernedPrivateEvaluationNarrativeFixture(),
      createGovernedPrivateEvaluationMultiClubNarrativeFixture(3),
      createGovernedPrivateEvaluationMultiClubNarrativeFixture(4),
    ];
    const byTradeId = new Map(
      narratives.map((narrative) => [narrative.content.tradeId, narrative])
    );
    const current = await pool.query<{ readonly prepared_revision: number }>(
      `SELECT revision AS prepared_revision
         FROM outcome_current_prepared_valuation_input_set WHERE scope_key=$1`,
      [scopeKey]
    );
    const nextPreparedRevision = current.rows[0]!.prepared_revision + 1;
    const seed = await pool.connect();
    try {
      await seed.query('BEGIN');
      await seed.query(`SET LOCAL session_replication_role='replica'`);
      await seed.query(
        `DELETE FROM outcome_prepared_valuation_input_entry WHERE prepared_input_set_id=$1`,
        [preparedInputSetId]
      );
      for (const [ordinal, narrative] of narratives.entries()) {
        const manifest = fixtureManifest(narrative.content.tradeId);
        const entry = {
          tradeId: narrative.content.tradeId,
          state: 'ready',
          materializationManifestId: manifest.manifestId,
          materializationManifestArtifact: manifest.manifestArtifact,
        } as const;
        await seed.query(
          `INSERT INTO outcome_prepared_valuation_input_entry
            (prepared_input_set_id,ordinal,trade_id,state,entry_canonical_json,entry_json)
           VALUES ($1,$2,$3,'ready',$4::text,$4::jsonb)`,
          [
            preparedInputSetId,
            ordinal + 1,
            narrative.content.tradeId,
            canonicalizeAflTradeJson(entry),
          ]
        );
      }
      await seed.query(
        `UPDATE outcome_prepared_valuation_input_set
            SET trade_count=3,ready_count=3,blocked_count=0
          WHERE prepared_input_set_id=$1`,
        [preparedInputSetId]
      );
      await seed.query(
        `UPDATE outcome_current_prepared_valuation_input_set SET revision=$2 WHERE scope_key=$1`,
        [scopeKey, nextPreparedRevision]
      );
      await seed.query('COMMIT');
    } catch (error) {
      await seed.query('ROLLBACK');
      throw error;
    } finally {
      seed.release();
    }

    const artifacts = createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' });
    const materializations = new Map<
      string,
      NonNullable<Awaited<ReturnType<typeof seedReadyRunnerGeneration>>['materialization']>
    >();
    const workspace = {
      stageAutomated: async (input: {
        readonly selector: { readonly valuationScopeKey: string; readonly tradeId: string };
        readonly operationId: string;
      }) => {
        const capture = await pool.query<{
          readonly captured_at: Date;
          readonly trusted_at: Date;
          readonly prepared_input_set_revision: number;
          readonly factual_release_revision: number;
        }>(
          `SELECT captured_at,date_trunc('milliseconds',transaction_timestamp()) AS trusted_at,
                  prepared_input_set_revision,factual_release_revision
             FROM outcome_private_evaluation_cohort_capture
            WHERE scope_key=$1 ORDER BY captured_at DESC LIMIT 1`,
          [scopeKey]
        );
        const retained = capture.rows[0]!;
        const narrative = byTradeId.get(input.selector.tradeId);
        if (narrative === undefined) throw new Error('Missing deterministic multi-club fixture.');
        const staged = await seedReadyRunnerGeneration({
          tradeId: input.selector.tradeId,
          operationId: input.operationId,
          generatedAt: retained.trusted_at.toISOString(),
          preparedInputSetRevision: retained.prepared_input_set_revision,
          factualReleaseRevision: retained.factual_release_revision,
          narrative,
        });
        if (staged.materialization === null)
          throw new Error('Missing retained projection fixture.');
        materializations.set(input.selector.tradeId, staged.materialization);
        for (const artifact of staged.materialization.artifacts) {
          await artifacts.putIfAbsent(artifact.reference, artifact.bytes);
        }
        return { state: 'activated' as const, generationId: staged.generationId };
      },
      inspect: async () => {
        throw new Error('Not used by the cohort runner.');
      },
      execute: async () => {
        throw new Error('Not used by the cohort runner.');
      },
      read: async () => {
        throw new Error('Not used by the cohort runner.');
      },
    };
    const repository = new PostgresGovernedPrivateEvaluationBatchRepository(
      createPgAflOutcomeSqlClient(pool),
      async () => true
    );
    const runner = createPostgresAflTradePrivateEvaluationCohortRunner({
      client: createPgAflOutcomeSqlClient(pool),
      batchRepository: repository,
      workspace,
    });
    const result = await runner.runCurrent(scopeKey);
    if (result.state === 'unexpected_failure') {
      throw new Error(canonicalizeAflTradeJson(result.diagnostics));
    }
    expect(result).toMatchObject({ state: 'activated', batch: { content: { readyCount: 3 } } });
    if (result.state !== 'activated') throw new Error('Expected an activated multi-club batch.');
    expect(narratives.map((narrative) => narrative.content.views[0]!.clubs.length)).toEqual([
      2, 3, 4,
    ]);

    const reader = createPostgresGovernedPrivateEvaluationReadRepository({
      client: createPgAflOutcomeSqlClient(pool),
      artifactRepository: artifacts,
      maximumArtifactBytes: 4 * 1024 * 1024,
      principalId: 'firebase:fixture-reader',
      authorizeReader: async () => true,
    });
    for (const narrative of narratives) {
      const selection = {
        valuationScopeKey: scopeKey,
        tradeId: narrative.content.tradeId,
      };
      const reads = await Promise.all(
        (['archive_summary', 'detail', 'reader_api', 'json_export'] as const).map((kind) =>
          reader.read({ selector: selection, selection: { kind: 'current' }, document: { kind } })
        )
      );
      expect(reads.every(({ state }) => state === 'available')).toBe(true);
      expect(
        new Set(reads.map((read) => (read.state === 'available' ? read.generationId : null)))
      ).toEqual(
        new Set([materializations.get(narrative.content.tradeId)!.generation.generationId])
      );
    }

    const principalId = 'firebase:fixture-batch-operator';
    await seedBatchOperator(principalId, createdAt);
    const withdrawnNarrative = narratives[1]!;
    const withdrawnGeneration = materializations.get(
      withdrawnNarrative.content.tradeId
    )!.generation;
    const trusted = await pool.query<{ readonly now: Date }>(
      `SELECT date_trunc('milliseconds',transaction_timestamp()) AS now`
    );
    const withdrawal = createGovernedPrivateEvaluationBatchWithdrawal({
      scopeKey,
      batchId: result.batch.batchId,
      tradeId: withdrawnNarrative.content.tradeId,
      generationId: withdrawnGeneration.generationId,
      principalId,
      reason: 'Fixture emergency withdrawal proves there is no per-trade fallback.',
      withdrawnAt: trusted.rows[0]!.now.toISOString(),
    });
    await expect(repository.withdraw(withdrawal)).resolves.toEqual(withdrawal);
    await expect(repository.withdraw(withdrawal)).resolves.toEqual(withdrawal);
    await expect(
      reader.read({
        selector: { valuationScopeKey: scopeKey, tradeId: withdrawnNarrative.content.tradeId },
        selection: { kind: 'current' },
        document: { kind: 'detail' },
      })
    ).resolves.toMatchObject({ state: 'unavailable', reason: 'withdrawn' });
    await expect(
      reader.read({
        selector: { valuationScopeKey: scopeKey, tradeId: narratives[0]!.content.tradeId },
        selection: { kind: 'current' },
        document: { kind: 'detail' },
      })
    ).resolves.toMatchObject({
      state: 'available',
      generationId: materializations.get(narratives[0]!.content.tradeId)!.generation.generationId,
    });
    await expect(
      reader.read({
        selector: { valuationScopeKey: scopeKey, tradeId: withdrawnNarrative.content.tradeId },
        selection: { kind: 'generation', generationId: withdrawnGeneration.generationId },
        document: { kind: 'json_export' },
      })
    ).resolves.toMatchObject({ state: 'available', lifecycle: { status: 'withdrawn' } });
  });

  it('persists an exhaustive 783-trade cohort with bounded SQL work and exact unchanged replay', async () => {
    const before = await pool.query<{
      readonly prepared_revision: number;
      readonly batch_count: number;
      readonly generation_count: number;
    }>(
      `SELECT prepared_head.revision AS prepared_revision,
              (SELECT count(*)::int FROM outcome_private_evaluation_batch) AS batch_count,
              (SELECT count(*)::int FROM outcome_local_private_trade_evaluation_generation)
                AS generation_count
         FROM outcome_current_prepared_valuation_input_set prepared_head
        WHERE prepared_head.scope_key=$1`,
      [scopeKey]
    );
    const starting = before.rows[0]!;
    const tradeIds = Array.from(
      { length: 783 },
      (_, index) => `trade:volume-${index.toString().padStart(3, '0')}`
    );
    const seed = await pool.connect();
    try {
      await seed.query('BEGIN');
      await seed.query(`SET LOCAL session_replication_role='replica'`);
      await seed.query(
        `DELETE FROM outcome_prepared_valuation_input_entry WHERE prepared_input_set_id=$1`,
        [preparedInputSetId]
      );
      for (const [ordinal, tradeId] of tradeIds.entries()) {
        const evidence = artifactRef(`${tradeId}-blocked`, createdAt);
        const entry = {
          tradeId,
          state: 'blocked',
          blockers: [
            {
              code: 'component_output_unavailable',
              subject: { kind: 'trade', id: tradeId },
              evidenceRefs: [evidence],
            },
          ],
        } as const;
        await seed.query(
          `INSERT INTO outcome_prepared_valuation_input_entry
            (prepared_input_set_id,ordinal,trade_id,state,entry_canonical_json,entry_json)
           VALUES ($1,$2,$3,'blocked',$4::text,$4::jsonb)`,
          [preparedInputSetId, ordinal + 1, tradeId, canonicalizeAflTradeJson(entry)]
        );
      }
      await seed.query(
        `UPDATE outcome_prepared_valuation_input_set
            SET trade_count=783,ready_count=0,blocked_count=783
          WHERE prepared_input_set_id=$1`,
        [preparedInputSetId]
      );
      await seed.query(
        `UPDATE outcome_current_prepared_valuation_input_set SET revision=$2 WHERE scope_key=$1`,
        [scopeKey, starting.prepared_revision + 1]
      );
      await seed.query('COMMIT');
    } catch (error) {
      await seed.query('ROLLBACK');
      throw error;
    } finally {
      seed.release();
    }

    const counted = countingClient(createPgAflOutcomeSqlClient(pool));
    const repository = new PostgresGovernedPrivateEvaluationBatchRepository(
      counted.client,
      async () => true
    );
    const runner = createPostgresAflTradePrivateEvaluationCohortRunner({
      client: counted.client,
      batchRepository: repository,
      workspace: {
        stageAutomated: async () => {
          throw new Error('Blocked prepared entries must not stage.');
        },
        inspect: async () => {
          throw new Error('Not used by the cohort runner.');
        },
        execute: async () => {
          throw new Error('Not used by the cohort runner.');
        },
        read: async () => {
          throw new Error('Not used by the cohort runner.');
        },
      },
    });
    const activated = await runner.runCurrent(scopeKey);
    expect(activated).toMatchObject({
      state: 'activated',
      batch: { content: { tradeCount: 783, readyCount: 0, unavailableCount: 783 } },
    });
    expect(counted.queryCount()).toBeLessThanOrEqual(800);
    const queriesAfterActivation = counted.queryCount();
    await expect(runner.runCurrent(scopeKey)).resolves.toMatchObject({
      state: 'already_current',
      batch: { batchId: activated.state === 'activated' ? activated.batch.batchId : '' },
    });
    expect(counted.queryCount() - queriesAfterActivation).toBeLessThanOrEqual(5);

    await expect(
      pool.query(
        `SELECT
           (SELECT count(*)::int FROM outcome_private_evaluation_batch) AS batch_count,
           (SELECT count(*)::int FROM outcome_local_private_trade_evaluation_generation)
             AS generation_count,
           (SELECT count(*)::int FROM outcome_private_evaluation_batch_entry
             WHERE batch_id=$1) AS member_count`,
        [activated.state === 'activated' ? activated.batch.batchId : '']
      )
    ).resolves.toMatchObject({
      rows: [
        {
          batch_count: starting.batch_count + 1,
          generation_count: starting.generation_count,
          member_count: 783,
        },
      ],
    });
  });
});
