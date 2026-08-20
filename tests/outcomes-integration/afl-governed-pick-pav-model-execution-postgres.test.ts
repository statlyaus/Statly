import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { PostgresGovernedPickPavModelExecutionRepository } from '@/server/aflTradeIntelligence/modeling/postgresGovernedPickPavModelExecutionRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';

import { createGovernedPickPavModelExecutionFixture } from '../testUtils/governedPickPavModelExecutionFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_governed_pick_execution_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
});

function scopedDatabaseUrl(targetSchema: string) {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', targetSchema);
  return scoped.toString();
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
    databaseUrl: scopedDatabaseUrl(schemaName),
  });
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminPool.end();
});

describe('governed pick-PAV native execution PostgreSQL custody', () => {
  it('registers, exactly replays, and prevents mutation of one non-production execution', async () => {
    const value = createGovernedPickPavModelExecutionFixture();
    const artifacts = createAflTradeFixtureArtifactRepository({
      artifactClass: 'derived_private',
    });
    const authorityReferences = [
      value.execution.content.datasetArtifact,
      value.execution.content.datasetAdmissionArtifact,
      value.execution.content.protocolArtifact,
    ];
    for (const [index, document] of value.authorityDocuments.entries()) {
      const reference = authorityReferences[index]!;
      await artifacts.putIfAbsent(
        reference,
        new TextEncoder().encode(canonicalizeAflTradeJson(document))
      );
    }
    const executionArtifact = createAflTradeCanonicalJsonArtifactRef(
      value.execution,
      value.execution.content.completedAt
    );
    await artifacts.putIfAbsent(
      executionArtifact,
      new TextEncoder().encode(canonicalizeAflTradeJson(value.execution))
    );

    const seed = await pool.connect();
    await seed.query('BEGIN');
    try {
      await seed.query(`SET LOCAL session_replication_role='replica'`);
      for (const reference of [...authorityReferences, executionArtifact]) {
        await seed.query(
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
              assurance: 'isolated_postgres_governed_pick_execution_test',
            }),
          ]
        );
      }
      const content = value.execution.content;
      const [datasetDocument, admissionDocument, protocolDocument] =
        value.authorityDocuments;
      const observationSet = content.observationSet;
      await seed.query(
        `INSERT INTO outcome_pick_pav_observation_set
          (observation_set_id,observation_set_sha256,environment,competition,release_id,
           policy_id,created_at,knowledge_cutoff_at,status,calculation_count,
           draft_class_count,observation_count,observation_set_canonical_json,
           observation_set_json,finalized_at)
         VALUES ($1,$2,'non_production',$3,$4,$5,$6,$7,'finalized',$8,$9,$10,$11,$12::jsonb,$6)`,
        [
          content.observationSetId,
          content.observationSetId.slice('pick-pav-observation-set:'.length),
          content.competition,
          content.releaseId,
          content.policyId,
          observationSet.content.createdAt,
          observationSet.content.knowledgeCutoffAt,
          observationSet.content.calculations.length,
          observationSet.content.draftClasses.length,
          observationSet.content.observations.length,
          canonicalizeAflTradeJson(observationSet),
          canonicalizeAflTradeJson(observationSet),
        ]
      );
      await seed.query(
        `INSERT INTO outcome_valuation_dataset_candidate
          (dataset_id,environment,scope_key,competition,created_at,knowledge_cutoff_at,
           factual_release_id,factual_candidate_id,corpus_id,lineage_id,
           source_member_set_sha256,row_count,row_set_sha256,row_set_canonical_json,
           artifact_count,status,dataset_canonical_json,dataset_json,finalized_at)
         VALUES ($1,'non_production','governed-pick-test',$2,$3,$3,$4,$5,$6,$7,$8,1,$8,
                 '[]',10,'finalized',$9,$10::jsonb,$3)`,
        [
          content.datasetId,
          content.competition,
          content.datasetArtifact.createdAt,
          content.releaseId,
          `factual-release-candidate:${'1'.repeat(64)}`,
          `corpus:${'2'.repeat(64)}`,
          `corpus-factual-lineage:${'3'.repeat(64)}`,
          '4'.repeat(64),
          canonicalizeAflTradeJson(datasetDocument),
          canonicalizeAflTradeJson(datasetDocument),
        ]
      );
      await seed.query(
        `INSERT INTO outcome_valuation_dataset_admission
          (admission_id,dataset_id,environment,admitted_at,gate2_decision_id,
           gate_ledger_revision,analytical_authority_receipt_id,
           operational_authorization_receipt_id,source_count,status,
           admission_canonical_json,admission_json,finalized_at)
         VALUES ($1,$2,'non_production',$3,$4,$5,$6,$7,1,'finalized',$8,$9::jsonb,$3)`,
        [
          content.datasetAdmissionId,
          content.datasetId,
          content.datasetAdmissionArtifact.createdAt,
          `gate-decision:${'5'.repeat(64)}`,
          content.datasetAdmissionGateLedgerRevision,
          `architecture-operation-receipt:${'6'.repeat(64)}`,
          `architecture-operation-receipt:${'7'.repeat(64)}`,
          canonicalizeAflTradeJson(admissionDocument),
          canonicalizeAflTradeJson(admissionDocument),
        ]
      );
      await seed.query(
        `INSERT INTO outcome_valuation_model_protocol
          (protocol_id,environment,dataset_id,admission_id,analytical_authority_receipt_id,
           prepared_at,protocol_canonical_json,protocol_json)
         VALUES ($1,'non_production',$2,$3,$4,$5,$6,$7::jsonb)`,
        [
          content.protocolId,
          content.datasetId,
          content.datasetAdmissionId,
          `architecture-operation-receipt:${'6'.repeat(64)}`,
          content.protocolArtifact.createdAt,
          canonicalizeAflTradeJson(protocolDocument.content),
          canonicalizeAflTradeJson(protocolDocument),
        ]
      );
      await seed.query('COMMIT');
    } catch (error) {
      await seed.query('ROLLBACK');
      throw error;
    } finally {
      seed.release();
    }

    const repository = new PostgresGovernedPickPavModelExecutionRepository({
      client: createPgAflOutcomeSqlClient(pool),
      artifactRepository: artifacts,
      maximumArtifactBytes: 1024 * 1024,
    });
    await expect(
      repository.register({ execution: value.execution, artifact: executionArtifact })
    ).resolves.toEqual({ execution: value.execution, artifact: executionArtifact });
    await expect(repository.loadExact(value.execution.executionId)).resolves.toEqual({
      execution: value.execution,
      artifact: executionArtifact,
    });
    await expect(
      repository.register({ execution: value.execution, artifact: executionArtifact })
    ).resolves.toEqual({ execution: value.execution, artifact: executionArtifact });

    await expect(
      pool.query(
        `UPDATE outcome_governed_pick_pav_model_execution SET dataset_id=$2
          WHERE execution_id=$1`,
        [value.execution.executionId, `dataset:${'8'.repeat(64)}`]
      )
    ).rejects.toThrow(/append-only/i);
  });
});
