import { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  PostgresAflTradeValuationDatasetRepository,
  requireOrInsertAflTradeValuationDatasetFieldSet,
} from '@/server/aflTradeIntelligence/modeling/postgresValuationDatasetRepository';
import { fullPlayerPavDatasetAdmissionFixture } from '../testUtils/playerPavDatasetAdmissionFixture';
import { seedSyntheticPavDatasetSqlParents } from '../testUtils/syntheticPavDatasetSqlParents';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
import {
  createAflTradeValuationDatasetCandidate,
  createAflTradeValuationDatasetRow,
  createAflTradeValuationDatasetSpecification,
  createAflTradeValuationDatasetAdmissionReceipt,
  createAflTradeConsumedFieldSet,
} from '@/server/aflTradeIntelligence/artifacts/valuationDatasetAdmissionContracts';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { AflTradeValuationDatasetAdmissionService } from '@/server/aflTradeIntelligence/modeling/valuationDatasetAdmission';
import type { AflTradeValuationDatasetAdmissionReceipt } from '@/server/aflTradeIntelligence/artifacts/valuationDatasetAdmissionContracts';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable test database is required.');
const schemaName = `pav_synthetic_parents_${process.pid}_${Date.now()}`;
const legacyRole = `${schemaName}_writer`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });
const client = createPgAflOutcomeSqlClient(pool);
let fixture: Awaited<ReturnType<typeof fullPlayerPavDatasetAdmissionFixture>>;

/** Direct writer exercises target SQL only; it is not the full private repository workflow. */
async function persistAdmissionSql(receipt: AflTradeValuationDatasetAdmissionReceipt) {
  return client.transaction(async (transaction) => {
    const content = receipt.content;
    const result = await transaction.query(
      `INSERT INTO outcome_valuation_dataset_admission
      (admission_id,dataset_id,environment,admitted_at,gate2_decision_id,gate_ledger_revision,
       analytical_authority_receipt_id,operational_authorization_receipt_id,source_count,status,
       admission_canonical_json,admission_json,finalized_at)
      VALUES($1,$2,'test_fixture',$3,$4,1,$5,$6,$7,'staged',$8,$9::jsonb,NULL)
      ON CONFLICT(admission_id) DO NOTHING RETURNING admission_id`,
      [
        receipt.admissionId,
        content.datasetId,
        content.admittedAt,
        content.gate2Decision.decisionId,
        content.analyticalAuthorityReceiptId,
        content.operationalAuthorizationReceiptId,
        content.sourceRightsEvaluations.length,
        canonicalizeAflTradeJson(content),
        canonicalizeAflTradeJson(receipt),
      ]
    );
    if (result.rowCount === 0) return false;
    for (const [index, source] of content.sourceRightsEvaluations.entries())
      await transaction.query(
        `INSERT INTO outcome_valuation_dataset_admission_source
      (admission_id,ordinal,capture_id,source_snapshot_id,consumed_field_set_id,rights_artifact_id,
       derivation_decision_id,derivation_receipt_id,admission_decision_id,admission_receipt_id,source_json)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
        [
          receipt.admissionId,
          index + 1,
          source.captureId,
          source.sourceSnapshotId,
          source.consumedFieldSetId,
          source.proposalId,
          source.derivationDecisionId,
          source.derivationEvaluationReceiptId,
          source.admissionDecisionId,
          source.admissionEvaluationReceiptId,
          canonicalizeAflTradeJson(source),
        ]
      );
    await transaction.query(
      "UPDATE outcome_valuation_dataset_admission SET status='finalized',finalized_at=$2 WHERE admission_id=$1",
      [receipt.admissionId, content.admittedAt]
    );
    return true;
  });
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  await admin.query(`CREATE ROLE "${legacyRole}" NOLOGIN`);
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: url.toString() });
  fixture = await fullPlayerPavDatasetAdmissionFixture();
  await seedSyntheticPavDatasetSqlParents(client, fixture);
  const disabled = await client.query<{
    count: string;
  }>(`SELECT count(*)::text count FROM pg_trigger trigger
    JOIN pg_class relation ON relation.oid=trigger.tgrelid JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname=current_schema() AND trigger.tgenabled='D'`);
  expect(disabled.rows[0]!.count).toBe('0');
}, 120_000);
afterAll(async () => {
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin.query(`DROP ROLE IF EXISTS "${legacyRole}"`);
  } finally {
    await admin.end();
  }
});

describe.sequential('PAV target validators with explicitly synthetic upstream parents', () => {
  it('persists and replays the exact original16-to-selected4 candidate with target guards enabled', async () => {
    const repository = new PostgresAflTradeValuationDatasetRepository(client);
    expect(fixture.evidence.pavObservationSet.content.observations).toHaveLength(16);
    expect(fixture.dataset.content.rows).toHaveLength(4);
    expect(await repository.persistCandidate(fixture.dataset)).toEqual({
      datasetId: fixture.dataset.datasetId,
      idempotentReplay: false,
    });
    expect(await repository.persistCandidate(fixture.dataset)).toEqual({
      datasetId: fixture.dataset.datasetId,
      idempotentReplay: true,
    });
  });
  it.each(['recordSha256', 'headRevision'] as const)(
    'rejects a coherently re-addressed measurement %s through the actual candidate insert guard',
    async (field) => {
      const rows = fixture.dataset.content.rows.map((row, index) =>
        index === 0
          ? createAflTradeValuationDatasetRow({
              ...row.content,
              featureInputs: row.content.featureInputs.map((input, ordinal) =>
                ordinal === 0
                  ? {
                      ...input,
                      ...(field === 'recordSha256'
                        ? { recordSha256: 'f'.repeat(64) }
                        : { headRevision: input.headRevision + 1 }),
                    }
                  : input
              ),
            })
          : row
      );
      const candidate = createAflTradeValuationDatasetCandidate({
        ...fixture.dataset.content,
        rows,
        datasetArtifact: createAflTradeCanonicalJsonArtifactRef(
          rows,
          fixture.dataset.content.createdAt
        ),
      });
      await expect(
        new PostgresAflTradeValuationDatasetRepository(client).persistCandidate(candidate)
      ).rejects.toThrow('PAV dataset measurement references differ from original finalized values');
    }
  );
  it.each(['inclusionPolicy', 'exclusionReport'] as const)(
    'rejects a re-addressed %s through the actual candidate guard',
    async (role) => {
      const reference = createAflTradeCanonicalJsonArtifactRef(
        { deliberatelyWrongSelection: true },
        fixture.dataset.content.createdAt
      );
      const candidate = createAflTradeValuationDatasetCandidate({
        ...fixture.dataset.content,
        ...(role === 'inclusionPolicy'
          ? {
              specification: createAflTradeValuationDatasetSpecification({
                ...fixture.dataset.content.specification.content,
                inclusionPolicy: reference,
              }),
            }
          : { exclusionReport: reference }),
      });
      await expect(
        new PostgresAflTradeValuationDatasetRepository(client).persistCandidate(candidate)
      ).rejects.toThrow(
        'PAV dataset original/selection artifact does not bind exact canonical content'
      );
    }
  );
  it('finalizes and replays admission with all54 league-source receipts through enabled target guards', async () => {
    const evidence = fixture.evidence;
    await new PostgresAflTradeValuationDatasetRepository(client).persistEvidence(fixture.dataset, {
      gateLedgerRevision: 1,
      analyticalAuthority: evidence.analyticalAuthority,
      operationalAuthorization: evidence.operationalAuthorization,
      consumedFieldSets: evidence.consumedFieldSets,
      sourceRights: evidence.sourceRights.map((proof) => ({
        ...proof,
        rightsArtifactId: proof.rightsProposal.rightsArtifactId,
      })),
    });
    const result = await new AflTradeValuationDatasetAdmissionService({
      authenticate: async () => evidence,
    }).admit({ dataset: fixture.dataset, admittedAt: evidence.authenticatedAt });
    if (result.status !== 'admitted') throw new Error(JSON.stringify(result));
    expect(result.receipt.content.sourceRightsEvaluations).toHaveLength(54);
    const omitted = createAflTradeValuationDatasetAdmissionReceipt({
      ...result.receipt.content,
      sourceRightsEvaluations: result.receipt.content.sourceRightsEvaluations.slice(1),
    });
    await expect(persistAdmissionSql(omitted)).rejects.toThrow(
      'PAV dataset requires training and derivation source evidence for the entire original league universe'
    );
    const originalFields = evidence.consumedFieldSets[0]!;
    const narrowed = createAflTradeConsumedFieldSet({
      ...originalFields.content,
      fields: originalFields.content.fields.slice(1),
    });
    await client.transaction((transaction) =>
      requireOrInsertAflTradeValuationDatasetFieldSet(transaction, narrowed)
    );
    const omittedField = createAflTradeValuationDatasetAdmissionReceipt({
      ...result.receipt.content,
      sourceRightsEvaluations: result.receipt.content.sourceRightsEvaluations.map((source) =>
        source.captureId === narrowed.content.captureId
          ? {
              ...source,
              consumedFieldSetId: narrowed.fieldSetId,
              consumedFieldSetSha256: narrowed.content.fieldSetSha256,
            }
          : source
      ),
    });
    await expect(persistAdmissionSql(omittedField)).rejects.toThrow(
      'PAV dataset requires training and derivation source evidence for the entire original league universe'
    );
    expect(await persistAdmissionSql(result.receipt)).toBe(true);
    expect(await persistAdmissionSql(result.receipt)).toBe(false);
  });
  it('preserves legacy v4 candidate writes for a non-owner with no new-helper execution privilege', async () => {
    const rows = fixture.dataset.content.rows.map(({ content }) => {
      const { pavObservationId: _pavObservationId, ...legacy } = content;
      const scalarInputs = (inputs: typeof content.featureInputs) =>
        inputs
          .map((input) => ({
            kind: 'acquisition_spell_metric' as const,
            state: 'complete' as const,
            metricCode: 'games' as const,
            memberId: createAflTradeContentAddress('spell-metric', {
              syntheticLegacyInput: input.memberId,
            }),
            recordSha256: input.recordSha256,
            headRevision: input.headRevision,
            effectiveFrom: input.effectiveFrom,
            effectiveThrough: input.effectiveThrough,
            recordedAt: input.recordedAt,
            playerId: content.identity.playerId,
            clubId: content.identity.clubId,
            spellVersionId: content.lineage.acquisitionSpellVersionId,
          }))
          .sort((a, b) => a.memberId.localeCompare(b.memberId));
      return createAflTradeValuationDatasetRow({
        ...legacy,
        schemaVersion: 'afl-trade-valuation-dataset-row/v3',
        featureInputs: scalarInputs(content.featureInputs),
        targetInputs: scalarInputs(content.targetInputs),
      });
    });
    const { pavObservationSet: _pavObservationSet, ...legacyContent } = fixture.dataset.content;
    const candidate = createAflTradeValuationDatasetCandidate({
      ...legacyContent,
      schemaVersion: 'afl-trade-valuation-dataset/v4',
      rows,
      datasetArtifact: createAflTradeCanonicalJsonArtifactRef(rows, legacyContent.createdAt),
    });
    await seedSyntheticPavDatasetSqlParents(client, { ...fixture, dataset: candidate });
    await client.query(`GRANT USAGE ON SCHEMA "${schemaName}" TO "${legacyRole}"`);
    await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schemaName}" TO "${legacyRole}"`);
    // PostgreSQL's existing parent FOR KEY SHARE reads also require UPDATE privilege.
    await client.query(`GRANT UPDATE ON outcome_factual_release_candidate,outcome_corpus_factual_lineage,
      outcome_valuation_dataset_factual_lineage,outcome_release_manifest,outcome_artifact_custody TO "${legacyRole}"`);
    await client.query(`GRANT INSERT,UPDATE ON outcome_valuation_dataset_candidate,outcome_valuation_dataset_row,
      outcome_valuation_dataset_artifact_member TO "${legacyRole}"`);
    const writer = {
      query: client.query.bind(client),
      transaction: <T>(work: Parameters<typeof client.transaction<T>>[0]) =>
        client.transaction(async (transaction) => {
          await transaction.query(`SET LOCAL ROLE "${legacyRole}"`);
          return work(transaction);
        }),
    };
    const privileges = await client.query<{ allowed: boolean }>(
      `SELECT has_function_privilege($1,
      'validate_outcome_player_pav_dataset(jsonb)','EXECUTE') allowed`,
      [legacyRole]
    );
    expect(privileges.rows[0]!.allowed).toBe(false);
    expect(
      await new PostgresAflTradeValuationDatasetRepository(writer).persistCandidate(candidate)
    ).toEqual({ datasetId: candidate.datasetId, idempotentReplay: false });
  });
});
