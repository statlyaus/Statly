import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { prepareLocalAflTradeFitzRoyFactualReleaseCandidate } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsal';
import {
  hasCurrentAflTradeValuationDatasetDomainProvenance,
  PostgresAflTradeValuationDatasetFactualLineageRepository,
} from '@/server/aflTradeIntelligence/modeling/postgresValuationDatasetFactualLineageRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradePrivateFactualPreparation } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationFactualPreparation';

import {
  persistPrivateValuationFactualCandidateFixture,
  seedPrivateValuationAcquisitionSpellFixture,
  stageAcceptedPrivateValuationCaptureFixture,
} from '../testUtils/privateValuationFactualPreparationFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});
const client = createPgAflOutcomeSqlClient(pool);
const restrictedPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName} -c role=afl_trade_private_evaluation_coordinator`,
  max: 2,
});
const restrictedClient = createPgAflOutcomeSqlClient(restrictedPool);
let rehearsalCandidateId: string | undefined;
let rehearsalSpellVersionId: string | undefined;
let rehearsalCaptureId: string | undefined;

function scopedDatabaseUrl(): string {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  return scoped.toString();
}

async function seedEventOnlyPromotion(input: {
  spellVersionId: string;
  captureId: string;
  fixtureKey: string;
}) {
  const ancestry = await pool.query<{
    event_version_id: string;
    source_import_row_id: string;
    import_run_id: string;
  }>(
    `SELECT spell.start_event_version_id AS event_version_id,
            event.source_import_row_id,row.import_run_id
       FROM outcome_acquisition_spell_version spell
       JOIN outcome_event_version event
         ON event.event_version_id=spell.start_event_version_id
       JOIN outcome_import_row row ON row.import_row_id=event.source_import_row_id
      WHERE spell.spell_version_id=$1`,
    [input.spellVersionId]
  );
  const row = ancestry.rows[0];
  if (!row) throw new Error('The mixed-provenance regression is missing its event ancestry.');

  const candidateId = createAflTradeContentAddress('external-reconciliation-candidate', {
    fixtureKey: input.fixtureKey,
  });
  const approvalDecisionId = createAflTradeContentAddress('review-decision', {
    fixtureKey: input.fixtureKey,
  });
  const proposalContent = { publicationEligible: false, fixtureKey: input.fixtureKey };
  const proposalId = createAflTradeContentAddress(
    'external-canonical-promotion-proposal',
    proposalContent
  );
  const receiptContent = { candidateId, proposalId, approvalDecisionId };
  const promotionId = createAflTradeContentAddress('external-canonical-promotion', receiptContent);
  const proposal = { proposalId, content: proposalContent };
  const receipt = { promotionId, content: receiptContent };
  const record = { eventVersionId: row.event_version_id };
  const recordedAt = '2026-08-12T00:06:15.000Z';

  const connection = await pool.connect();
  await connection.query('BEGIN');
  try {
    await connection.query(`SET LOCAL session_replication_role='replica'`);
    await connection.query(
      `UPDATE outcome_import_run SET import_kind='external_canonical_promotion'
        WHERE import_run_id=$1`,
      [row.import_run_id]
    );
    await connection.query(
      `INSERT INTO outcome_external_canonical_promotion
        (promotion_id,candidate_id,proposal_id,approval_decision_id,import_run_count,
         environment,competition,anchor_season_year,transaction_count,transfer_count,
         draft_selection_count,draft_player_asset_count,pick_custody_count,
         pick_realization_count,promotion_record_count,promoted_at,status,finalized_at,
         proposal_sha256,proposal_canonical_json,proposal_json,receipt_sha256,
         receipt_canonical_json,receipt_json)
       VALUES ($1,$2,$3,$4,1,'non_production','AFLM',2026,0,0,0,0,0,0,1,$5,
               'finalized',$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb)`,
      [
        promotionId,
        candidateId,
        proposalId,
        approvalDecisionId,
        recordedAt,
        proposalId.split(':')[1],
        canonicalizeAflTradeJson(proposalContent),
        canonicalizeAflTradeJson(proposal),
        promotionId.split(':')[1],
        canonicalizeAflTradeJson(receiptContent),
        canonicalizeAflTradeJson(receipt),
      ]
    );
    await connection.query(
      `INSERT INTO outcome_external_canonical_promotion_import_run
        (promotion_id,ordinal,import_run_id,capture_id) VALUES ($1,1,$2,$3)`,
      [promotionId, row.import_run_id, input.captureId]
    );
    await connection.query(
      `INSERT INTO outcome_external_canonical_promotion_record
        (promotion_id,ordinal,record_kind,source_record_id,canonical_record_id,
         source_import_row_id,record_sha256,record_canonical_json,evidence_ids,record_json)
       VALUES ($1,1,'draft_event',$2,$3,$4,$5,$6,'[]'::jsonb,$7::jsonb)`,
      [
        promotionId,
        `event-only:${input.fixtureKey}`,
        row.event_version_id,
        row.source_import_row_id,
        sha256AflTradeCanonicalJson(record),
        canonicalizeAflTradeJson(record),
        canonicalizeAflTradeJson(record),
      ]
    );
    await connection.query(
      `INSERT INTO outcome_external_canonical_promotion_review_head
        (candidate_id,revision,decision_id,proposal_id,status,updated_at)
       VALUES ($1,1,$2,$3,'approved',$4)`,
      [candidateId, approvalDecisionId, proposalId, recordedAt]
    );
    await connection.query('COMMIT');
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
}

beforeAll(async () => {
  await adminPool.query(`DO $role$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='afl_trade_nonproduction_spell_metric_policy_reviewer') THEN
      CREATE ROLE afl_trade_nonproduction_spell_metric_policy_reviewer NOLOGIN;
    END IF;
  END $role$`);
  await adminPool.query(
    'GRANT afl_trade_nonproduction_spell_metric_policy_reviewer TO statly_test'
  );
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scopedDatabaseUrl() });
  await adminPool.query(
    `GRANT USAGE ON SCHEMA "${schemaName}" TO afl_trade_nonproduction_spell_metric_policy_reviewer`
  );
  await adminPool.query(
    `GRANT SELECT,INSERT ON "${schemaName}".outcome_review_decision TO afl_trade_nonproduction_spell_metric_policy_reviewer`
  );
});

afterAll(async () => {
  await restrictedPool.end();
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminPool.end();
});

describe.sequential('genuine admitted-player PostgreSQL tracer', () => {
  it('pins the reviewed-training admission definer to its owning schema', async () => {
    await expect(
      pool.query<{ configuration: string }>(
        `SELECT array_to_string(procedure.proconfig, ',') AS configuration
           FROM pg_proc procedure
           JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
          WHERE namespace.nspname=current_schema()
            AND procedure.proname='admit_outcome_reviewed_training_source_capture'`
      )
    ).resolves.toMatchObject({
      rows: [
        {
          configuration: `search_path=${schemaName}, pg_catalog, pg_temp`,
        },
      ],
    });
  });

  it('coalesces concurrent and replayed admitted-player dispatches by stable operation key', async () => {
    const datasetId = `dataset:${'1'.repeat(64)}`;
    const admissionId = `dataset-admission:${'2'.repeat(64)}`;
    const scopeKey = 'AFLM:issue-574-dispatch-replay';
    const operationKey = 'issue-574-stable-operation';
    const retainedAt = '2026-08-12T00:00:00.000Z';
    const connection = await pool.connect();
    await connection.query('BEGIN');
    try {
      await connection.query(`SET LOCAL session_replication_role='replica'`);
      await connection.query(
        `INSERT INTO outcome_valuation_dataset_candidate
          (dataset_id,environment,scope_key,competition,created_at,knowledge_cutoff_at,
           factual_release_id,factual_candidate_id,corpus_id,lineage_id,
           source_member_set_sha256,row_count,row_set_sha256,row_set_canonical_json,
           artifact_count,status,dataset_canonical_json,dataset_json,finalized_at)
         VALUES ($1,'non_production',$2,'AFLM',$3,$3,$4,$5,$6,$7,$8,1,$9,'{}',10,
                 'finalized','{}','{}'::jsonb,$3)`,
        [
          datasetId,
          scopeKey,
          retainedAt,
          `outcome-release:${'3'.repeat(64)}`,
          `factual-release-candidate:${'4'.repeat(64)}`,
          `corpus:${'5'.repeat(64)}`,
          `corpus-factual-lineage:${'6'.repeat(64)}`,
          '7'.repeat(64),
          '8'.repeat(64),
        ]
      );
      await connection.query(
        `INSERT INTO outcome_valuation_dataset_admission
          (admission_id,dataset_id,environment,admitted_at,gate2_decision_id,
           gate_ledger_revision,analytical_authority_receipt_id,
           operational_authorization_receipt_id,source_count,status,
           admission_canonical_json,admission_json,finalized_at)
         VALUES ($1,$2,'non_production',$3,$4,1,$5,$6,1,'finalized','{}','{}'::jsonb,$3)`,
        [
          admissionId,
          datasetId,
          retainedAt,
          `gate-decision:${'9'.repeat(64)}`,
          `architecture-operation-receipt:${'a'.repeat(64)}`,
          `architecture-operation-receipt:${'b'.repeat(64)}`,
        ]
      );
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }

    const enqueue = () =>
      restrictedPool.query<{ request_id: string; request_json: unknown }>(
        'SELECT * FROM enqueue_outcome_admitted_player_dispatch($1,$2,$3)',
        [datasetId, admissionId, operationKey]
      );
    const [first, concurrent] = await Promise.all([enqueue(), enqueue()]);
    const replay = await enqueue();

    expect(first.rows).toHaveLength(1);
    expect(concurrent.rows).toEqual(first.rows);
    expect(replay.rows).toEqual(first.rows);
    await expect(
      pool.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM outcome_private_valuation_dispatch_request
          WHERE scope_key=$1 AND trigger_kind='ad_hoc' AND authority_key=$2`,
        [scopeKey, operationKey]
      )
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('rejects locally fabricated rehearsal lineage before dataset admission or model execution', async () => {
    const staged = await stageAcceptedPrivateValuationCaptureFixture(
      client,
      'genuine-admitted-player-rehearsal-rejection'
    );
    rehearsalCaptureId = staged.binding.content.sourceCaptureId;
    let source!: Awaited<ReturnType<typeof prepareLocalAflTradeFitzRoyFactualReleaseCandidate>>;
    let candidateId: string | undefined;
    await new PostgresAflTradePrivateFactualPreparation(client, {
      prepareSourceEvidence: async () => {
        source = await prepareLocalAflTradeFitzRoyFactualReleaseCandidate(client);
      },
      prepareCandidate: async () => {
        const spell = await seedPrivateValuationAcquisitionSpellFixture(
          client,
          staged.binding.content.sourceCaptureId,
          source.candidate,
          'genuine-admitted-player-rehearsal-rejection'
        );
        const candidate = await persistPrivateValuationFactualCandidateFixture(
          client,
          source.candidate,
          spell,
          staged.claim.request.scopeKey
        );
        candidateId = candidate.candidateId;
        rehearsalCandidateId = candidate.candidateId;
        rehearsalSpellVersionId = spell.spellVersionId;
        return { candidateId: candidate.candidateId };
      },
    }).prepare({
      requestId: staged.requestId,
      claim: { claimId: staged.claim.claimId, leaseToken: staged.claim.leaseToken },
    });
    if (candidateId === undefined) throw new Error('The rehearsal candidate was not retained.');

    let rejection: unknown;
    try {
      await new PostgresAflTradeValuationDatasetFactualLineageRepository(client).stage({
        factualCandidateId: candidateId,
        createdAt: '2026-08-12T00:06:30.000Z',
      });
    } catch (cause) {
      rejection = cause;
    }
    expect(rejection).toMatchObject({
      code: 'CANDIDATE_UNAVAILABLE',
    });
    expect((rejection as Error).message).toBe(
      'Domain lineage lacks an authenticated finalized canonical promotion.'
    );
    await expect(
      pool.query('SELECT count(*)::integer AS count FROM outcome_valuation_dataset_factual_lineage')
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await expect(
      pool.query('SELECT count(*)::integer AS count FROM outcome_valuation_model_run')
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await expect(
      restrictedPool.query<{ select_ok: boolean; update_ok: boolean }>(
        `SELECT
           bool_and(has_column_privilege(
             current_user,relation_name,select_column,'SELECT')) AS select_ok,
           bool_and(CASE WHEN update_column IS NULL THEN true
                         ELSE has_column_privilege(
                           current_user,relation_name,update_column,'UPDATE') END) AS update_ok
           FROM (VALUES
             ('outcome_valuation_dataset_factual_lineage','lineage_json','lineage_id'),
             ('outcome_valuation_dataset_factual_lineage','lineage_id',NULL),
             ('outcome_valuation_dataset_factual_lineage','candidate_id',NULL),
             ('outcome_corpus_factual_lineage','lineage_json','lineage_id'),
             ('outcome_corpus_factual_lineage','lineage_id',NULL),
             ('outcome_corpus_factual_lineage','candidate_id',NULL),
             ('outcome_factual_release_candidate','candidate_json','candidate_id'),
             ('outcome_factual_release_candidate','candidate_id',NULL),
             ('outcome_factual_release_candidate','candidate_sha256',NULL),
             ('outcome_factual_release_candidate','status',NULL),
             ('outcome_factual_release_candidate','finalized_at',NULL),
             ('outcome_acquisition_spell_version','start_event_version_id',NULL),
             ('outcome_acquisition_spell_version','start_asset_version_id',NULL),
             ('outcome_acquisition_spell_version','spell_version_id',NULL),
             ('outcome_acquisition_spell_version','spell_id',NULL),
             ('outcome_acquisition_spell_version','player_id',NULL),
             ('outcome_acquisition_spell_version','club_id',NULL),
             ('outcome_event_version','source_import_row_id',NULL),
             ('outcome_event_version','event_version_id',NULL),
             ('outcome_event_version','event_id',NULL),
             ('outcome_event_version','status',NULL),
             ('outcome_event','competition',NULL),
             ('outcome_event','event_id',NULL),
             ('outcome_event','season_year',NULL),
             ('outcome_event_asset','asset_version_id',NULL),
             ('outcome_event_asset','event_version_id',NULL),
             ('outcome_event_asset','player_id',NULL),
             ('outcome_event_asset','to_club_id',NULL),
             ('outcome_event_asset','source_import_row_id',NULL),
             ('outcome_event_asset','status',NULL),
             ('outcome_import_row','parse_status',NULL),
             ('outcome_import_row','import_row_id',NULL),
             ('outcome_import_row','import_run_id',NULL),
             ('outcome_import_run','import_kind',NULL),
             ('outcome_import_run','import_run_id',NULL),
             ('outcome_import_run','capture_id',NULL),
             ('outcome_import_run','status',NULL),
             ('outcome_external_canonical_promotion_import_run','capture_id',NULL),
             ('outcome_external_canonical_promotion_import_run','import_run_id',NULL),
             ('outcome_external_canonical_promotion_import_run','promotion_id',NULL),
             ('outcome_external_canonical_promotion','environment','promotion_id'),
             ('outcome_external_canonical_promotion','promotion_id',NULL),
             ('outcome_external_canonical_promotion','candidate_id',NULL),
             ('outcome_external_canonical_promotion','approval_decision_id',NULL),
             ('outcome_external_canonical_promotion','competition',NULL),
             ('outcome_external_canonical_promotion','status',NULL),
             ('outcome_external_canonical_promotion','finalized_at',NULL),
             ('outcome_external_canonical_promotion_record','canonical_record_id',NULL),
             ('outcome_external_canonical_promotion_record','promotion_id',NULL),
             ('outcome_external_canonical_promotion_record','source_import_row_id',NULL),
             ('outcome_external_canonical_promotion_record','record_kind',NULL),
             ('outcome_external_canonical_promotion_review_head','status','candidate_id'),
             ('outcome_external_canonical_promotion_review_head','candidate_id',NULL),
             ('outcome_external_canonical_promotion_review_head','decision_id',NULL),
             ('outcome_pick_lineage_edge','edge_id',NULL),
             ('outcome_pick_lineage_edge','event_id',NULL)
           ) privilege(relation_name,select_column,update_column)`
      )
    ).resolves.toMatchObject({ rows: [{ select_ok: true, update_ok: true }] });
    await expect(
      restrictedPool.query<{ exposed: boolean }>(
        `SELECT bool_or(has_column_privilege(
           current_user,relation_name,column_name,'SELECT')) AS exposed
         FROM (VALUES
           ('outcome_import_row','raw_payload'),
           ('outcome_import_run','manifest_json'),
           ('outcome_external_canonical_promotion','proposal_json'),
           ('outcome_external_canonical_promotion','receipt_json'),
           ('outcome_external_canonical_promotion_record','record_json')
         ) sensitive(relation_name,column_name)`
      )
    ).resolves.toMatchObject({ rows: [{ exposed: false }] });
    await expect(
      hasCurrentAflTradeValuationDatasetDomainProvenance(restrictedClient, {
        factualCandidateId: candidateId,
        lineageId: 'corpus-factual-lineage:' + '0'.repeat(64),
      })
    ).resolves.toBe(false);
  });

  it('rejects a promoted event whose player asset has no record in the same promotion', async () => {
    const fixtureKey = 'promoted-event-unpromoted-asset';
    if (!rehearsalCandidateId || !rehearsalSpellVersionId || !rehearsalCaptureId) {
      throw new Error('The prior rehearsal did not retain its mixed-provenance inputs.');
    }
    await seedEventOnlyPromotion({
      spellVersionId: rehearsalSpellVersionId,
      captureId: rehearsalCaptureId,
      fixtureKey,
    });

    await expect(
      new PostgresAflTradeValuationDatasetFactualLineageRepository(client).stage({
        factualCandidateId: rehearsalCandidateId,
        createdAt: '2026-08-12T00:06:30.000Z',
      })
    ).rejects.toMatchObject({
      code: 'CANDIDATE_UNAVAILABLE',
      message: 'Domain lineage lacks an authenticated finalized canonical promotion.',
    });
    await expect(
      pool.query('SELECT count(*)::integer AS count FROM outcome_valuation_dataset_factual_lineage')
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });
});
