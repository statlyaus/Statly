import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeModelRunOperationalAuthorization } from '@/server/aflTradeIntelligence/modeling/admittedModelRunAuthority';
import { PostgresAflTradeAdmittedModelRunAuthority } from '@/server/aflTradeIntelligence/modeling/postgresAdmittedModelRunAuthority';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_model_run_authority_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const outcomesPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});

const hash = (character: string) => character.repeat(64);

function artifact(character: string, createdAt: string) {
  return {
    artifactId: `artifact:${hash(character)}`,
    contentSha256: hash(character),
    mediaType: 'application/json',
    byteLength: 1,
    createdAt,
  };
}

function gateDocuments(input: {
  gate: 'gate_0a_permission_to_evaluate' | 'gate_2_corpus_lineage';
  decisionKey: string;
  proposalId: string;
  decisionId: string;
  occurredAt: string;
  affectedArtifacts?: Array<{ kind: string; artifactId: string }>;
}) {
  const common = {
    gate: input.gate,
    decisionKey: input.decisionKey,
    version: 1,
    environment: 'test_fixture',
  };
  return {
    proposal: {
      proposalId: input.proposalId,
      content: {
        schemaVersion: 'afl-trade-gate-proposal/v1',
        ...common,
        scope: {
          scopeKey: 'model-run-fixture',
          dimensions: [
            { name: 'competition', values: ['AFLM'] },
            { name: 'scope', values: ['model-run-fixture'] },
          ],
        },
        proposedAt: input.occurredAt,
      },
    },
    decision: {
      decisionId: input.decisionId,
      content: {
        schemaVersion: 'afl-trade-gate-decision/v1',
        proposalId: input.proposalId,
        ...common,
        scope: {
          scopeKey: 'model-run-fixture',
          dimensions: [
            { name: 'competition', values: ['AFLM'] },
            { name: 'scope', values: ['model-run-fixture'] },
          ],
        },
        state: 'approved',
        decidedAt: input.occurredAt,
        effectiveAt: input.occurredAt,
        revalidateAt: '2099-01-01T00:00:00.000Z',
        supersedesDecisionId: null,
        affectedArtifacts: input.affectedArtifacts ?? [],
      },
    },
  };
}

function scopedDatabaseUrl(targetSchema: string) {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', targetSchema);
  return scoped.toString();
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA ${schemaName}`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
    databaseUrl: scopedDatabaseUrl(schemaName),
  });
});

afterAll(async () => {
  await outcomesPool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await adminPool.end();
});

describe('durable PostgreSQL model-run authority', () => {
  it('uses database time and enforces one authorization, one consumption, and one immutable run', async () => {
    const sql = createPgAflOutcomeSqlClient(outcomesPool);
    const adapter = new PostgresAflTradeAdmittedModelRunAuthority({
      sql,
      gateDecisionLedgerRepository: {
        load: async () => {
          throw new Error('not used by this migration-level probe');
        },
        append: async () => {
          throw new Error('not used by this migration-level probe');
        },
        appendDecision: async () => {
          throw new Error('not used by this migration-level probe');
        },
        appendBatch: async () => {
          throw new Error('not used by this migration-level probe');
        },
        resolveAuthorization: async () => {
          throw new Error('not used by this migration-level probe');
        },
      },
      artifactRepository: {
        loadExactWithObservation: async () => {
          throw new Error('not used by this migration-level probe');
        },
      },
    });
    const databaseNow = await adapter.now();
    expect(Number.isFinite(Date.parse(databaseNow))).toBe(true);

    const datasetId = `dataset:${hash('1')}`;
    const admissionId = `dataset-admission:${hash('2')}`;
    const authorityReceiptId = `architecture-operation-receipt:${hash('3')}`;
    const gate0ProposalId = `gate-proposal:${hash('c')}`;
    const gate0DecisionId = `gate-decision:${hash('d')}`;
    const gate2ProposalId = `gate-proposal:${hash('e')}`;
    const gate2DecisionId = `gate-decision:${hash('a')}`;
    const rightsArtifactId = `source-rights:${hash('f')}`;
    const runStartReceiptId = `gate0a-evaluation:${hash('0')}`;
    const admissionReceiptId = `gate0a-evaluation:${hash('b')}`;
    const operatorAuthorityEvidenceId = `reviewer-authority-evidence:${hash('e')}`;
    const factualReleaseId = `outcome-release:${hash('4')}`;
    const factualCandidateId = `factual-release-candidate:${hash('5')}`;
    const corpusId = `corpus:${hash('6')}`;
    const lineageId = `corpus-factual-lineage:${hash('7')}`;
    const admittedAt = new Date(Date.parse(databaseNow) - 1_000).toISOString();
    const startedAt = databaseNow;
    const validThrough = new Date(Date.parse(databaseNow) + 30_000).toISOString();
    const gate0 = gateDocuments({
      gate: 'gate_0a_permission_to_evaluate',
      decisionKey: 'model-run-gate0-fixture',
      proposalId: gate0ProposalId,
      decisionId: gate0DecisionId,
      occurredAt: admittedAt,
    });
    const gate2 = gateDocuments({
      gate: 'gate_2_corpus_lineage',
      decisionKey: 'model-run-gate2-fixture',
      proposalId: gate2ProposalId,
      decisionId: gate2DecisionId,
      occurredAt: admittedAt,
      affectedArtifacts: [
        { kind: 'corpus_manifest', artifactId: corpusId },
        { kind: 'corpus_factual_lineage', artifactId: lineageId },
        { kind: 'factual_release', artifactId: factualReleaseId },
        { kind: 'factual_release_candidate', artifactId: factualCandidateId },
      ],
    });

    const seedClient = await outcomesPool.connect();
    await seedClient.query('BEGIN');
    try {
      await seedClient.query(`SET LOCAL session_replication_role='replica'`);
      await seedClient.query(
        `UPDATE outcome_gate_ledger_head SET revision=2,updated_at=$1 WHERE singleton_id=1`,
        [admittedAt]
      );
      for (const record of [gate0, gate2]) {
        await seedClient.query(
          `INSERT INTO outcome_gate_proposal
            (proposal_id,gate,decision_key,version,environment,scope_key,proposed_at,proposal_json)
           VALUES ($1,$2,$3,1,'test_fixture','model-run-fixture',$4,$5::jsonb)`,
          [
            record.proposal.proposalId,
            record.proposal.content.gate,
            record.proposal.content.decisionKey,
            admittedAt,
            canonicalizeAflTradeJson(record.proposal),
          ]
        );
        await seedClient.query(
          `INSERT INTO outcome_gate_decision
            (decision_id,proposal_id,gate,decision_key,version,environment,state,decided_at,
             effective_at,revalidate_at,supersedes_decision_id,decision_json)
           VALUES ($1,$2,$3,$4,1,'test_fixture','approved',$5,$5,
                   '2099-01-01T00:00:00.000Z',NULL,$6::jsonb)`,
          [
            record.decision.decisionId,
            record.proposal.proposalId,
            record.decision.content.gate,
            record.decision.content.decisionKey,
            admittedAt,
            canonicalizeAflTradeJson(record.decision),
          ]
        );
      }
      const rights = {
        rightsArtifactId,
        content: {
          schemaVersion: 'afl-trade-source-rights/v2',
          provider: 'fixture-provider',
          dataset: 'fixture-dataset',
          datasetVersion: 'fixture-v1',
          proposedAt: admittedAt,
          termsExpireAt: '2099-01-01T00:00:00.000Z',
          acquisition: { kind: 'provided_artifact' },
        },
      };
      const gate0Request = (evaluatedAt: string) => ({
        rightsArtifactId,
        environment: 'test_fixture',
        operations: ['model_training'],
        fieldUses: [{ sourceField: 'fixture_metric', use: 'model_training' }],
        evaluatedAt,
      });
      await seedClient.query(
        `INSERT INTO outcome_source_rights_proposal
          (rights_artifact_id,provider,dataset,dataset_version,capability_id,proposed_at,content_json)
         VALUES ($1,'fixture-provider','fixture-dataset','fixture-v1',NULL,$2,$3::jsonb)`,
        [rightsArtifactId, admittedAt, canonicalizeAflTradeJson(rights)]
      );
      for (const [receiptId, evaluatedAt] of [
        [admissionReceiptId, admittedAt],
        [runStartReceiptId, startedAt],
      ] as const) {
        const receipt = {
          receiptId,
          content: {
            schemaVersion: 'afl-trade-gate0a-evaluation/v2',
            request: gate0Request(evaluatedAt),
            result: { status: 'mechanically_eligible', decisionId: gate0DecisionId },
            recordedAt: evaluatedAt,
          },
        };
        await seedClient.query(
          `INSERT INTO outcome_valuation_dataset_gate0_evaluation
            (receipt_id,rights_artifact_id,decision_id,environment,evaluated_at,recorded_at,
             operation_kind,receipt_canonical_json,receipt_json)
           VALUES ($1,$2,$3,'test_fixture',$4,$4,'model_training',$5,$6::jsonb)`,
          [
            receiptId,
            rightsArtifactId,
            gate0DecisionId,
            evaluatedAt,
            canonicalizeAflTradeJson(receipt.content),
            canonicalizeAflTradeJson(receipt),
          ]
        );
      }
      await seedClient.query(
        `INSERT INTO outcome_valuation_dataset_candidate
          (dataset_id,environment,scope_key,competition,created_at,knowledge_cutoff_at,
           factual_release_id,factual_candidate_id,corpus_id,lineage_id,source_member_set_sha256,
           row_count,row_set_sha256,row_set_canonical_json,artifact_count,status,
           dataset_canonical_json,dataset_json,finalized_at)
         VALUES ($1,'test_fixture','model-run-fixture','AFLM',$2,$2,$3,$4,$5,$6,$7,1,$8,'[]',10,
                 'finalized','{}','{}'::jsonb,$2)`,
        [
          datasetId,
          admittedAt,
          factualReleaseId,
          factualCandidateId,
          corpusId,
          lineageId,
          hash('8'),
          hash('9'),
        ]
      );
      await seedClient.query(
        `INSERT INTO outcome_valuation_dataset_operation_authority
          (receipt_id,authority_kind,environment,scope_key,dataset_id,factual_release_id,
           factual_candidate_id,authorized_at,valid_through,principal_ref,
           receipt_canonical_json,receipt_json)
         VALUES ($1,'analytical_authority','test_fixture','model-run-fixture',$2,$3,$4,$5,$6,
                 'fixture-principal','{}','{}'::jsonb)`,
        [
          authorityReceiptId,
          datasetId,
          factualReleaseId,
          factualCandidateId,
          admittedAt,
          '2099-01-01T00:00:00.000Z',
        ]
      );
      await seedClient.query(
        `INSERT INTO outcome_valuation_dataset_admission
          (admission_id,dataset_id,environment,admitted_at,gate2_decision_id,
           gate_ledger_revision,analytical_authority_receipt_id,
           operational_authorization_receipt_id,source_count,status,
           admission_canonical_json,admission_json,finalized_at)
         VALUES ($1,$2,'test_fixture',$3,$4,2,$5,$6,1,'finalized','{}',$7::jsonb,$3)`,
        [
          admissionId,
          datasetId,
          admittedAt,
          gate2DecisionId,
          authorityReceiptId,
          `architecture-operation-receipt:${hash('b')}`,
          canonicalizeAflTradeJson({
            admissionId,
            content: {
              corpusId,
              corpusToCandidateLineageId: lineageId,
              factualReleaseId,
              factualCandidateId,
              sourceRightsEvaluations: [
                { proposalId: rightsArtifactId, admissionEvaluationReceiptId: admissionReceiptId },
              ],
            },
          }),
        ]
      );
      await seedClient.query(
        `INSERT INTO outcome_governed_evidence_reference
          (reference_id,reference_sha256,evidence_kind,artifact_id,environment,status,
           approval_decision_id,created_at,evidence_canonical_json,evidence_json)
         VALUES ($1,$2,'reviewer_authority_evidence',$3,'test_fixture','approved',$4,$5,'{}',$6::jsonb)`,
        [
          operatorAuthorityEvidenceId,
          hash('e'),
          `artifact:${hash('e')}`,
          `review-decision:${hash('e')}`,
          admittedAt,
          canonicalizeAflTradeJson({
            principalRef: 'fixture-model-run-operator',
            role: 'afl_trade_model_run_operator',
            scopeKey: 'model-run-fixture',
            provider: 'statly_modeling',
            capabilityId: 'execute_model_run',
            competition: 'AFLM',
            validFromSeason: 1897,
            validThroughSeason: 2200,
            validFrom: admittedAt,
            validThrough: '2099-01-01T00:00:00.000Z',
          }),
        ]
      );
      await seedClient.query(
        `INSERT INTO outcome_operational_principal_authority
          (authority_evidence_id,principal_ref,role,scope_key,provider,capability_id,
           competition,valid_from_season,valid_through_season,valid_from,valid_through)
         VALUES ($1,'fixture-model-run-operator','afl_trade_model_run_operator',
                 'model-run-fixture','statly_modeling','execute_model_run','AFLM',1897,2200,$2,$3)`,
        [operatorAuthorityEvidenceId, admittedAt, '2099-01-01T00:00:00.000Z']
      );
      await seedClient.query('COMMIT');
    } catch (error) {
      await seedClient.query('ROLLBACK');
      throw error;
    } finally {
      seedClient.release();
    }

    const protocolContent = {
      schemaVersion: 'afl-trade-model-protocol/v2',
      environment: 'test_fixture',
      datasetId,
      datasetAdmission: { admissionId, admittedAt },
      preparedAt: startedAt,
    };
    const protocolId = createAflTradeContentAddress('model-protocol', protocolContent);
    const protocol = { protocolId, content: protocolContent };
    await outcomesPool.query(
      `INSERT INTO outcome_valuation_model_protocol
        (protocol_id,environment,dataset_id,admission_id,analytical_authority_receipt_id,
         prepared_at,protocol_canonical_json,protocol_json)
       VALUES ($1,'test_fixture',$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        protocolId,
        datasetId,
        admissionId,
        authorityReceiptId,
        startedAt,
        canonicalizeAflTradeJson(protocolContent),
        canonicalizeAflTradeJson(protocol),
      ]
    );

    const observationContent = {
      schemaVersion: 'afl-trade-player-observation-set/v2',
      datasetId,
      datasetAdmissionId: admissionId,
      modelProtocolId: protocolId,
      datasetRowSetSha256: hash('9'),
      observations: [{}],
    };
    const observationSetId = createAflTradeContentAddress(
      'player-observation-set',
      observationContent
    );
    await outcomesPool.query(
      `INSERT INTO outcome_valuation_player_observation_set
        (observation_set_id,environment,dataset_id,admission_id,protocol_id,
         dataset_row_set_sha256,observation_count,observation_canonical_json,
         observation_json,created_at)
       VALUES ($1,'test_fixture',$2,$3,$4,$5,1,$6,$7::jsonb,$8)`,
      [
        observationSetId,
        datasetId,
        admissionId,
        protocolId,
        hash('9'),
        canonicalizeAflTradeJson(observationContent),
        canonicalizeAflTradeJson({ observationSetId, content: observationContent }),
        startedAt,
      ]
    );

    const intentContent = {
      schemaVersion: 'afl-trade-model-run-intent/v1',
      authorityBoundary: 'pre_execution_model_intent_no_fit_grade_publication_or_fantasy_ownership',
      publicationEligible: false,
      environment: 'test_fixture',
      modelId: 'fixture-player-model',
      modelVersion: 'fixture-v1',
      datasetId,
      datasetAdmissionId: admissionId,
      modelProtocolId: protocolId,
      observationSetId,
      codeCommitSha: hash('1').slice(0, 40),
      cleanWorktree: true,
      seed: 17,
      job: {
        jobId: 'fixture-job',
        attempt: 1,
        initiatedBy: 'fixture-operator',
        workerIdentity: 'fixture-worker',
      },
      startedAt,
      windows: {
        train: { from: admittedAt, to: startedAt },
        calibration: { from: admittedAt, to: startedAt },
        validation: { from: admittedAt, to: startedAt },
        finalTest: { from: admittedAt, to: startedAt },
        embargoDays: 0,
      },
      sourceCodeArtifact: artifact('1', admittedAt),
      dependencyLockArtifact: artifact('2', admittedAt),
      runtimeArtifact: artifact('3', admittedAt),
      containerArtifact: artifact('4', admittedAt),
      configurationArtifact: artifact('5', admittedAt),
      environmentArtifact: artifact('6', admittedAt),
      featureDefinitionArtifacts: [artifact('7', admittedAt)],
      modelTrainingEvaluationReceiptIds: [runStartReceiptId],
    };
    const intentId = createAflTradeContentAddress('model-run-intent', intentContent);
    const intent = { intentId, content: intentContent };
    await outcomesPool.query(
      `INSERT INTO outcome_valuation_model_run_intent
        (intent_id,environment,dataset_id,admission_id,protocol_id,observation_set_id,
         started_at,intent_canonical_json,intent_json)
       VALUES ($1,'test_fixture',$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        intentId,
        datasetId,
        admissionId,
        protocolId,
        observationSetId,
        startedAt,
        canonicalizeAflTradeJson(intentContent),
        canonicalizeAflTradeJson(intent),
      ]
    );

    const operationalAuthorization = createAflTradeModelRunOperationalAuthorization({
      environment: 'test_fixture',
      runIntentId: intentId,
      datasetId,
      datasetAdmissionId: admissionId,
      modelProtocolId: protocolId,
      observationSetId,
      authorizedAt: startedAt,
      validThrough,
      principalRef: 'fixture-model-run-operator',
      role: 'afl_trade_model_run_operator',
      authorityEvidence: { id: operatorAuthorityEvidenceId, sha256: hash('e') },
    });
    await outcomesPool.query(
      `INSERT INTO outcome_valuation_model_run_operational_authorization
        (receipt_id,intent_id,environment,dataset_id,admission_id,protocol_id,observation_set_id,
         authorized_at,valid_through,principal_ref,authority_evidence_id,
         receipt_canonical_json,receipt_json)
       VALUES ($1,$2,'test_fixture',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
      [
        operationalAuthorization.receiptId,
        intentId,
        datasetId,
        admissionId,
        protocolId,
        observationSetId,
        startedAt,
        validThrough,
        operationalAuthorization.content.principalRef,
        operationalAuthorization.content.authorityEvidence.id,
        canonicalizeAflTradeJson(operationalAuthorization.content),
        canonicalizeAflTradeJson(operationalAuthorization),
      ]
    );

    const authorizationContent = {
      schemaVersion: 'afl-trade-model-run-authorization/v1',
      authorityBoundary: 'model_run_start_authority_no_grade_publication_or_fantasy_ownership',
      publicationEligible: false,
      environment: 'test_fixture',
      runIntentId: intentId,
      datasetId,
      datasetAdmissionId: admissionId,
      datasetRowSetSha256: hash('9'),
      modelProtocolId: protocolId,
      observationSetId,
      operationalAuthorizationReceiptId: operationalAuthorization.receiptId,
      gate2DecisionId,
      gateLedgerRevision: 2,
      authorizedAt: startedAt,
      validThrough,
      modelTrainingEvaluationReceiptIds: [runStartReceiptId],
    };
    const authorizationId = createAflTradeContentAddress(
      'model-run-authorization',
      authorizationContent
    );
    const revokedClient = await outcomesPool.connect();
    try {
      await revokedClient.query('BEGIN');
      await revokedClient.query(`SET LOCAL session_replication_role='replica'`);
      await revokedClient.query(
        `INSERT INTO outcome_review_decision
          (decision_id,subject_type,subject_id,decision,supersedes_decision_id,rationale,
           evidence_json,decided_by,decided_at)
         VALUES ($1,'governed_evidence_reference',$2,'rejected',$3,'fixture withdrawal',
                 '{}'::jsonb,'fixture-governance-writer',$4)`,
        [
          `review-decision:${hash('f')}`,
          operatorAuthorityEvidenceId,
          `review-decision:${hash('e')}`,
          startedAt,
        ]
      );
      await revokedClient.query(`SET LOCAL session_replication_role='origin'`);
      await expect(
        revokedClient.query(
          `INSERT INTO outcome_valuation_model_run_authorization
            (authorization_id,intent_id,operational_authorization_receipt_id,gate_ledger_revision,
             authorized_at,valid_through,authorization_canonical_json,authorization_json)
           VALUES ($1,$2,$3,2,$4,$5,$6,$7::jsonb)`,
          [
            authorizationId,
            intentId,
            operationalAuthorization.receiptId,
            startedAt,
            validThrough,
            canonicalizeAflTradeJson(authorizationContent),
            canonicalizeAflTradeJson({ authorizationId, content: authorizationContent }),
          ]
        )
      ).rejects.toThrow(/invalid, stale, or misbound/i);
      await revokedClient.query('ROLLBACK');
    } finally {
      revokedClient.release();
    }
    await outcomesPool.query(
      `INSERT INTO outcome_valuation_model_run_authorization
        (authorization_id,intent_id,operational_authorization_receipt_id,gate_ledger_revision,
         authorized_at,valid_through,
         authorization_canonical_json,authorization_json)
       VALUES ($1,$2,$3,2,$4,$5,$6,$7::jsonb)`,
      [
        authorizationId,
        intentId,
        operationalAuthorization.receiptId,
        startedAt,
        validThrough,
        canonicalizeAflTradeJson(authorizationContent),
        canonicalizeAflTradeJson({ authorizationId, content: authorizationContent }),
      ]
    );

    await expect(
      outcomesPool.query(
        `INSERT INTO outcome_valuation_model_run_authorization
          (authorization_id,intent_id,operational_authorization_receipt_id,gate_ledger_revision,
           authorized_at,valid_through,
           authorization_canonical_json,authorization_json)
         VALUES ($1,$2,$3,1,$4,$5,$6,$7::jsonb)`,
        [
          createAflTradeContentAddress('model-run-authorization', {
            ...authorizationContent,
            gateLedgerRevision: 1,
          }),
          intentId,
          operationalAuthorization.receiptId,
          startedAt,
          validThrough,
          canonicalizeAflTradeJson({ ...authorizationContent, gateLedgerRevision: 1 }),
          canonicalizeAflTradeJson({
            authorizationId: createAflTradeContentAddress('model-run-authorization', {
              ...authorizationContent,
              gateLedgerRevision: 1,
            }),
            content: { ...authorizationContent, gateLedgerRevision: 1 },
          }),
        ]
      )
    ).rejects.toThrow();

    const firstConsumption = await outcomesPool.query(
      `UPDATE outcome_valuation_model_run_authorization
          SET consumed_at=$2
        WHERE authorization_id=$1 AND consumed_at IS NULL
      RETURNING consumed_at`,
      [authorizationId, startedAt]
    );
    expect(firstConsumption.rowCount).toBe(1);
    expect(
      await outcomesPool.query(
        `UPDATE outcome_valuation_model_run_authorization SET consumed_at=$2
        WHERE authorization_id=$1 AND consumed_at IS NULL`,
        [authorizationId, startedAt]
      )
    ).toMatchObject({ rowCount: 0 });

    const runContent = {
      schemaVersion: 'afl-trade-model-run/v3',
      environment: intentContent.environment,
      modelId: intentContent.modelId,
      modelVersion: intentContent.modelVersion,
      datasetId: intentContent.datasetId,
      datasetAdmissionId: intentContent.datasetAdmissionId,
      modelProtocolId: intentContent.modelProtocolId,
      runIntentId: intentId,
      runAuthorizationId: authorizationId,
      observationSetId: intentContent.observationSetId,
      modelTrainingEvaluationReceiptIds: intentContent.modelTrainingEvaluationReceiptIds,
      codeCommitSha: intentContent.codeCommitSha,
      cleanWorktree: intentContent.cleanWorktree,
      seed: intentContent.seed,
      job: intentContent.job,
      startedAt,
      candidateLockedAt: null,
      finalTestEvaluatedAt: null,
      finishedAt: startedAt,
      windows: intentContent.windows,
      sourceCodeArtifact: intentContent.sourceCodeArtifact,
      dependencyLockArtifact: intentContent.dependencyLockArtifact,
      runtimeArtifact: intentContent.runtimeArtifact,
      containerArtifact: intentContent.containerArtifact,
      configurationArtifact: intentContent.configurationArtifact,
      environmentArtifact: intentContent.environmentArtifact,
      featureDefinitionArtifacts: intentContent.featureDefinitionArtifacts,
      outcome: {
        status: 'failed',
        failureClassification: 'training_failure',
        failureArtifact: artifact('8', startedAt),
        diagnosticsArtifact: artifact('9', startedAt),
      },
    };

    const alteredStartedAt = new Date(Date.parse(startedAt) + 1_000).toISOString();
    const alteredRunContent = {
      ...runContent,
      startedAt: alteredStartedAt,
      finishedAt: alteredStartedAt,
    };
    const alteredRunId = createAflTradeContentAddress('model-run', alteredRunContent);
    await expect(
      outcomesPool.query(
        `INSERT INTO outcome_valuation_model_run
          (run_id,intent_id,authorization_id,status,started_at,finished_at,
           run_canonical_json,run_json)
         VALUES ($1,$2,$3,'failed',$4,$4,$5,$6::jsonb)`,
        [
          alteredRunId,
          intentId,
          authorizationId,
          alteredStartedAt,
          canonicalizeAflTradeJson(alteredRunContent),
          canonicalizeAflTradeJson({ runId: alteredRunId, content: alteredRunContent }),
        ]
      )
    ).rejects.toThrow(/consumed authorization/i);

    const runId = createAflTradeContentAddress('model-run', runContent);
    await outcomesPool.query(
      `INSERT INTO outcome_valuation_model_run
        (run_id,intent_id,authorization_id,status,started_at,finished_at,
         run_canonical_json,run_json)
       VALUES ($1,$2,$3,'failed',$4,$4,$5,$6::jsonb)`,
      [
        runId,
        intentId,
        authorizationId,
        startedAt,
        canonicalizeAflTradeJson(runContent),
        canonicalizeAflTradeJson({ runId, content: runContent }),
      ]
    );

    await expect(
      outcomesPool.query(`UPDATE outcome_valuation_model_run SET status='cancelled'`)
    ).rejects.toThrow(/append-only/i);
  });
});
