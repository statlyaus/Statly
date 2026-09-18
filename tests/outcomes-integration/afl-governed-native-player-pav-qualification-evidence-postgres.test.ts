import { Pool } from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createGovernedNativePlayerPavQualificationCriteria } from '@/server/aflTradeIntelligence/valuation/internal/governedNativePlayerPavQualification';
import { PostgresGovernedNativePlayerPavQualificationEvidenceRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedNativePlayerPavQualificationEvidenceRepository';
import { PostgresGovernedValuationComponentRunRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedValuationComponentRunRepository';

import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
import { governedNativePlayerPavComponentFixture } from '../testUtils/governedNativePlayerPavComponentFixture';
import { nativePavModelRunSqlFixture } from '../testUtils/nativePavModelRunSqlFixture';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const adminPool = new Pool({ connectionString: databaseUrl });

function scopedDatabaseUrl(schemaName: string) {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  return scoped.toString();
}

async function withDatabase<T>(name: string, work: (pool: Pool) => Promise<T>): Promise<T> {
  const schemaName = `afl_native_pav_qualification_${name}_${process.pid}_${Date.now()}`;
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schemaName}`,
    max: 1,
  });
  try {
    runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
      databaseUrl: scopedDatabaseUrl(schemaName),
    });
    return await work(pool);
  } finally {
    await pool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  }
}

afterAll(async () => {
  await adminPool.end();
});

async function registerCustody(
  pool: Pool,
  reference: AflTradeArtifactRef,
  createdAt = reference.createdAt
) {
  await pool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,custody_profile_id,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,$4,$5,'derived_private','non_production',NULL,$6,$6,$7::jsonb)
     ON CONFLICT (artifact_id) DO NOTHING`,
    [
      reference.artifactId,
      reference.contentSha256,
      reference.storageUri,
      reference.mediaType,
      reference.byteLength,
      createdAt,
      canonicalizeAflTradeJson({ assurance: 'disposable_native_pav_qualification_test' }),
    ]
  );
}

async function authoritySnapshot(pool: Pool) {
  const result = await pool.query<{ snapshot: unknown }>(
    `SELECT jsonb_build_object(
      'qualifications',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')
        FROM outcome_governed_valuation_model_qualification t),
      'work',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')
        FROM outcome_governed_model_qualification_work t),
      'currentPairs',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')
        FROM outcome_current_governed_valuation_model_pair t),
      'proposals',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')
        FROM outcome_gate_proposal t),
      'decisions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')
        FROM outcome_gate_decision t),
      'ledgerHead',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')
        FROM outcome_gate_ledger_head t)
    ) AS snapshot`
  );
  return result.rows[0]!.snapshot;
}

async function setup(pool: Pool, tamperFinalEvidenceCustody = false) {
  const client = createPgAflOutcomeSqlClient(pool);
  const artifacts = createAflTradeFixtureArtifactRepository({
    artifactClass: 'derived_private',
  });
  const source = await nativePavModelRunSqlFixture();
  const native = await governedNativePlayerPavComponentFixture({
    manifestVersion: 'v5',
    finalEvidenceVersion: 'v2',
    source,
    artifactRepository: artifacts,
  });
  const calibrationConfigurationArtifact =
    native.finalEvidence.content.calibrationConfigurationArtifact;
  const calibrationConfiguration = source.evidence.executableArtifacts.find(
    ({ artifactId }) => artifactId === calibrationConfigurationArtifact.artifactId
  );
  if (calibrationConfiguration === undefined) {
    throw new Error('Expected retained calibration configuration bytes.');
  }
  await artifacts.putIfAbsent(calibrationConfigurationArtifact, calibrationConfiguration.bytes);
  for (const reference of [
    native.componentArtifact,
    native.component.content.nativeExecution.artifact,
    native.component.content.protocolArtifact,
    native.component.content.datasetArtifact,
    native.component.content.datasetAdmissionArtifact,
  ]) {
    await registerCustody(pool, reference);
  }
  await new PostgresGovernedValuationComponentRunRepository({
    client,
    artifactRepository: artifacts,
    maximumArtifactBytes: 16 * 1024 * 1024,
  }).register({ manifest: native.component, artifact: native.componentArtifact });

  const baseline = native.finalEvidence.content.baselineComparisons[0]!;
  const criteria = createGovernedNativePlayerPavQualificationCriteria({
    selectedBaselineDefinitionArtifact: baseline.definitionArtifact,
  });
  const criteriaAt = new Date(
    Date.parse(native.component.content.registeredAt) + 1_000
  ).toISOString();
  const recordedAt = new Date(Date.parse(criteriaAt) + 1_000).toISOString();
  const criteriaArtifact = createAflTradeCanonicalJsonArtifactRef(criteria, criteriaAt);
  await artifacts.putIfAbsent(
    criteriaArtifact,
    new TextEncoder().encode(canonicalizeAflTradeJson(criteria))
  );
  await registerCustody(pool, criteriaArtifact);
  await registerCustody(
    pool,
    native.finalEvidenceArtifact,
    tamperFinalEvidenceCustody
      ? new Date(Date.parse(native.finalEvidenceArtifact.createdAt) + 1_000).toISOString()
      : native.finalEvidenceArtifact.createdAt
  );
  await registerCustody(pool, calibrationConfigurationArtifact);

  const retainArtifact = vi.fn(async (input: { document: unknown; createdAt: string }) => {
    const reference = createAflTradeCanonicalJsonArtifactRef(input.document, input.createdAt);
    const retained = await artifacts.putIfAbsent(
      reference,
      new TextEncoder().encode(canonicalizeAflTradeJson(input.document))
    );
    await registerCustody(pool, retained.reference);
    return retained.reference;
  });
  const makeRepository = (
    retain: (input: { document: unknown; createdAt: string }) => Promise<AflTradeArtifactRef>
  ) =>
    new PostgresGovernedNativePlayerPavQualificationEvidenceRepository({
      client,
      artifactRepository: artifacts,
      maximumArtifactBytes: 16 * 1024 * 1024,
      retainArtifact: retain,
    });
  return {
    artifacts,
    criteriaArtifact,
    makeRepository,
    native,
    recordedAt,
    repository: makeRepository(retainArtifact),
    retainArtifact,
  };
}

describe('governed native player-PAV qualification evidence PostgreSQL repository', () => {
  it('retains exact inconclusive evidence, replays without another artifact, and is append-only', () =>
    withDatabase('retain', async (pool) => {
      const fixture = await setup(pool);
      const before = await authoritySnapshot(pool);
      const retained = await fixture.repository.retain({
        componentRunId: fixture.native.component.runId,
        criteriaArtifact: fixture.criteriaArtifact,
        recordedAt: fixture.recordedAt,
      });

      expect(retained.idempotentReplay).toBe(false);
      expect(retained.evidence.content.assessment.status).toBe('inconclusive');
      expect(retained.evidence.content.qualificationGranted).toBe(false);
      expect(fixture.retainArtifact).toHaveBeenCalledTimes(1);
      const row = await pool.query<{
        content_canonical_json: string;
        qualification_granted: boolean;
      }>(
        `SELECT content_canonical_json,qualification_granted
           FROM outcome_governed_native_player_pav_qualification_evidence
          WHERE evidence_id=$1`,
        [retained.evidence.evidenceId]
      );
      expect(row.rows[0]).toEqual({
        content_canonical_json: canonicalizeAflTradeJson(retained.evidence.content),
        qualification_granted: false,
      });

      const artifactCountBeforeReplay = await pool.query<{ count: number }>(
        'SELECT count(*)::integer AS count FROM outcome_artifact_custody'
      );
      const replay = await fixture.repository.retain({
        componentRunId: fixture.native.component.runId,
        criteriaArtifact: fixture.criteriaArtifact,
        recordedAt: new Date(Date.parse(fixture.recordedAt) + 60_000).toISOString(),
      });
      expect(replay.idempotentReplay).toBe(true);
      expect(replay.recordedAt).toBe(fixture.recordedAt);
      expect(replay.evidenceArtifact).toEqual(retained.evidenceArtifact);
      expect(fixture.retainArtifact).toHaveBeenCalledTimes(1);
      await expect(
        pool.query('SELECT count(*)::integer AS count FROM outcome_artifact_custody')
      ).resolves.toMatchObject({ rows: artifactCountBeforeReplay.rows });
      await expect(
        fixture.repository.loadExact(retained.evidence.evidenceId)
      ).resolves.toMatchObject({
        evidence: retained.evidence,
        evidenceArtifact: retained.evidenceArtifact,
      });
      expect(await authoritySnapshot(pool)).toEqual(before);

      const conflictingContent = structuredClone(retained.evidence.content);
      conflictingContent.selectedBaseline.definitionKey += '-conflict';
      const conflictingEvidence = {
        evidenceId: createAflTradeContentAddress(
          'native-player-pav-qualification-evidence',
          conflictingContent
        ),
        content: conflictingContent,
      };
      const conflictingArtifact = createAflTradeCanonicalJsonArtifactRef(
        conflictingEvidence,
        new Date(Date.parse(fixture.recordedAt) + 120_000).toISOString()
      );
      await fixture.artifacts.putIfAbsent(
        conflictingArtifact,
        new TextEncoder().encode(canonicalizeAflTradeJson(conflictingEvidence))
      );
      await registerCustody(pool, conflictingArtifact);
      await expect(
        pool.query(
          `INSERT INTO outcome_governed_native_player_pav_qualification_evidence
            (evidence_id,run_id,final_evaluation_id,final_evidence_artifact_id,
             criteria_id,criteria_artifact_id,calibration_configuration_artifact_id,
             evidence_artifact_id,support_status,assessment_status,qualification_granted,
             content_sha256,content_canonical_json,evidence_json,recorded_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE,$11,$12,$13::jsonb,$14)`,
          [
            conflictingEvidence.evidenceId,
            fixture.native.component.runId,
            conflictingContent.finalEvaluationId,
            conflictingContent.finalEvidenceArtifact.artifactId,
            conflictingContent.criteriaId,
            conflictingContent.criteriaArtifact.artifactId,
            conflictingContent.calibrationConfigurationArtifact.artifactId,
            conflictingArtifact.artifactId,
            conflictingContent.support.status,
            conflictingContent.assessment.status,
            conflictingEvidence.evidenceId.slice(
              'native-player-pav-qualification-evidence:'.length
            ),
            canonicalizeAflTradeJson(conflictingContent),
            canonicalizeAflTradeJson(conflictingEvidence),
            conflictingArtifact.createdAt,
          ]
        )
      ).rejects.toThrow(/outcome_native_player_pav_qualification_run_criteria_key/u);

      await expect(
        pool.query(
          `UPDATE outcome_governed_native_player_pav_qualification_evidence
              SET recorded_at=recorded_at WHERE evidence_id=$1`,
          [retained.evidence.evidenceId]
        )
      ).rejects.toThrow();
      await expect(
        pool.query(
          `DELETE FROM outcome_governed_native_player_pav_qualification_evidence
            WHERE evidence_id=$1`,
          [retained.evidence.evidenceId]
        )
      ).rejects.toThrow();
      await expect(
        pool.query('TRUNCATE outcome_governed_native_player_pav_qualification_evidence')
      ).rejects.toThrow();
    }));

  it('rejects SQL custody that differs from the authenticated final evidence', () =>
    withDatabase('custody', async (pool) => {
      const fixture = await setup(pool, true);
      const before = await authoritySnapshot(pool);
      await expect(
        fixture.repository.retain({
          componentRunId: fixture.native.component.runId,
          criteriaArtifact: fixture.criteriaArtifact,
          recordedAt: fixture.recordedAt,
        })
      ).rejects.toThrow(/SQL custody differs/u);
      const rows = await pool.query(
        'SELECT 1 FROM outcome_governed_native_player_pav_qualification_evidence'
      );
      expect(rows.rowCount).toBe(0);
      expect(await authoritySnapshot(pool)).toEqual(before);
    }));

  it('serializes concurrent retains with a single PostgreSQL connection', () =>
    withDatabase('concurrent', async (pool) => {
      const fixture = await setup(pool);
      const results = await Promise.all([
        fixture.repository.retain({
          componentRunId: fixture.native.component.runId,
          criteriaArtifact: fixture.criteriaArtifact,
          recordedAt: fixture.recordedAt,
        }),
        fixture.repository.retain({
          componentRunId: fixture.native.component.runId,
          criteriaArtifact: fixture.criteriaArtifact,
          recordedAt: fixture.recordedAt,
        }),
      ]);
      expect(results.map(({ idempotentReplay }) => idempotentReplay).sort()).toEqual([false, true]);
      expect(results[0]!.evidenceArtifact).toEqual(results[1]!.evidenceArtifact);
      const rows = await pool.query(
        'SELECT 1 FROM outcome_governed_native_player_pav_qualification_evidence'
      );
      expect(rows.rowCount).toBe(1);
    }));

  it('adopts an authenticated artifact retained before an interrupted insert', () =>
    withDatabase('interrupted', async (pool) => {
      const fixture = await setup(pool);
      let interrupt = true;
      const interruptedRetain = vi.fn(async (input: { document: unknown; createdAt: string }) => {
        const retained = await fixture.retainArtifact(input);
        if (interrupt) {
          interrupt = false;
          throw new Error('synthetic interruption after immutable artifact retention');
        }
        return retained;
      });
      const repository = fixture.makeRepository(interruptedRetain);
      await expect(
        repository.retain({
          componentRunId: fixture.native.component.runId,
          criteriaArtifact: fixture.criteriaArtifact,
          recordedAt: fixture.recordedAt,
        })
      ).rejects.toThrow(/synthetic interruption/u);
      const absent = await pool.query(
        'SELECT 1 FROM outcome_governed_native_player_pav_qualification_evidence'
      );
      expect(absent.rowCount).toBe(0);

      const replayedAt = new Date(Date.parse(fixture.recordedAt) + 60_000).toISOString();
      const recovered = await repository.retain({
        componentRunId: fixture.native.component.runId,
        criteriaArtifact: fixture.criteriaArtifact,
        recordedAt: replayedAt,
      });
      expect(recovered.idempotentReplay).toBe(false);
      expect(recovered.recordedAt).toBe(fixture.recordedAt);
      expect(interruptedRetain).toHaveBeenCalledTimes(2);
      const retained = await pool.query(
        'SELECT 1 FROM outcome_governed_native_player_pav_qualification_evidence'
      );
      expect(retained.rowCount).toBe(1);
    }));

  it('rejects missing physical evidence before appending its row', () =>
    withDatabase('physical', async (pool) => {
      const fixture = await setup(pool);
      const missingPhysicalRetain = vi.fn(
        async (input: { document: unknown; createdAt: string }) => {
          const reference = createAflTradeCanonicalJsonArtifactRef(input.document, input.createdAt);
          await registerCustody(pool, reference);
          return reference;
        }
      );
      const repository = fixture.makeRepository(missingPhysicalRetain);
      await expect(
        repository.retain({
          componentRunId: fixture.native.component.runId,
          criteriaArtifact: fixture.criteriaArtifact,
          recordedAt: fixture.recordedAt,
        })
      ).rejects.toThrow(/artifact custody failed/u);
      const retained = await pool.query(
        'SELECT 1 FROM outcome_governed_native_player_pav_qualification_evidence'
      );
      expect(retained.rowCount).toBe(0);
    }));
});
