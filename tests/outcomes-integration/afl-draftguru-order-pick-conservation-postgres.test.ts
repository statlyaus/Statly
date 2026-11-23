import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  createAflTradeContentAddress as address,
  canonicalizeAflTradeJson as canonical,
  sha256AflTradeCanonicalJson as sha,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createAflTradeExternalEvidenceEnvelope } from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { createAflTradeExternalCaptureExecutionReceipt } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import { AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { createAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import { PostgresAflTradeExternalReconciliationRepository } from '@/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

/**
 * Migration 0293 (owner approval 4 of the 2026 intake): reconciliation carries one `draftOrderPicks`
 * record per Draftguru post-draft order row. A removed pick's row is cited by nothing else, so before
 * 0293 finalization refuses a candidate citing it only on its record; after it the candidate stores.
 */
const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!url) throw new Error('Disposable PostgreSQL required.');
const MIGRATION = '0293_draftguru_order_pick_reconciliation';
const schema = `draftguru_order_pick_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const sql = createPgAflOutcomeSqlClient(pool);
let history: Awaited<ReturnType<typeof deployOutcomesHistoryBefore>>;
const hex = (character: string) => character.repeat(64);

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url);
  scoped.searchParams.set('schema', schema);
  history = await deployOutcomesHistoryBefore(MIGRATION, scoped.toString(), pool);
}, 120000);
afterAll(async () => {
  await history?.cleanup();
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

/** One 2026 order batch staged directly: a selection row and a removed pick's row. */
async function stageOrderBatch() {
  const capture = {
    captureId: `source-capture:${hex('e')}`,
    artifactId: `artifact:${hex('e')}`,
    contentSha256: hex('e'),
    mediaType: 'text/html',
    sourceUrl: 'https://www.draftguru.com.au/years/2026/provisional-draft-order/post-draft',
    capturedAt: '2026-11-23T00:00:00.000Z',
    effectiveAt: '2026-11-23T00:00:00.000Z',
    parserVersion: 'draftguru-post-draft-order/v1',
    fieldManifestSha256: hex('4'),
  };
  const essendon = { nativeId: 'essendon', recordedName: 'Essendon' };
  const carlton = { nativeId: 'carlton', recordedName: 'Carlton' };
  const player = { nativeId: 'synthetic_player/1', recordedName: 'Synthetic Player' };
  const claims: Parameters<typeof createAflTradeExternalEvidenceEnvelope>[0]['claim'][] = [
    {
      kind: 'draft_selection',
      draftYear: 2026,
      draftType: 'national',
      selectionNumber: 2,
      roundNumber: null,
      player,
      selectedByClub: essendon,
    },
    {
      kind: 'draft_order_pick',
      draftYear: 2026,
      draftType: 'national',
      roundNumber: 5,
      pickNumber: null,
      club: carlton,
      origin: { kind: 'entitlement', club: carlton, roundNumber: 5, rank: 8 },
      hops: [],
      bidNotMatchedBy: null,
      outcome: { kind: 'removed', note: 'not enough list spots' },
    },
  ];
  const rows = claims.map((claim, index) =>
    createAflTradeExternalEvidenceEnvelope({
      schemaVersion: 'afl-trade-external-evidence/v1',
      provider: 'draftguru',
      publicationEligible: false,
      capture,
      sourceRow: { ordinal: index + 1, sourceKey: `2026:national:order:${index + 1}` },
      claim,
    })
  );
  const batchId = `external-evidence-batch:${hex('e')}`;
  const receipt = createAflTradeExternalCaptureExecutionReceipt({
    schemaVersion: 'afl-trade-external-capture-execution/v1',
    rightsArtifactId: `source-rights:${hex('2')}`,
    gateDecisionId: `gate-decision:${hex('3')}`,
    gateDecisionKey: 'fixture:draftguru-post-draft-order',
    ledgerRevision: 1,
    evaluatedAt: '2026-11-23T00:00:00.000Z',
    provider: 'draftguru',
    capabilityId: 'draftguru-post-draft-order',
    parserVersion: capture.parserVersion,
    fieldManifestSha256: hex('4'),
    upstreamRate: { requests: 1, perSeconds: 5, burst: 1 },
    cacheSeconds: 3_600,
    rawRetentionDays: 365,
    egressPolicyEvidenceId: `artifact:${hex('5')}`,
  });
  await pool.query(
    `INSERT INTO outcome_competition_season (competition,season_year) VALUES ('AFLM',2026)
      ON CONFLICT DO NOTHING`
  );
  await pool.query(
    `INSERT INTO outcome_artifact_custody (artifact_id,content_sha256,storage_uri,media_type,byte_length,
      artifact_class,environment,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,'text/html',1,'raw_source','test_fixture',
      '2026-11-23T00:00:00.000Z','2026-11-23T00:00:01.000Z','{}'::jsonb)`,
    [capture.artifactId, hex('e'), `artifact://sha256/${hex('e')}`]
  );
  await pool.query(
    `INSERT INTO outcome_source_capture_attempt
      (attempt_id,environment,provider,dataset,capability_id,status,started_at,completed_at,attempt_json)
     VALUES ('attempt-order','test_fixture','draftguru','order','draftguru-post-draft-order',
      'captured','2026-11-23T00:00:00.000Z','2026-11-23T00:00:01.000Z','{}'::jsonb)`
  );
  await pool.query(
    `INSERT INTO outcome_source_capture (capture_id,attempt_id,source_snapshot_id,source_artifact_id,
      environment,provider,dataset,dataset_version,access_mechanism,capability_id,competition,
      anchor_season_year,effective_at,captured_at,status,manifest_json)
     VALUES ($1,'attempt-order',$2,$3,'test_fixture','draftguru','order','2026','automated_web',
      'draftguru-post-draft-order','AFLM',2026,'2026-11-23T00:00:00.000Z',
      '2026-11-23T00:00:01.000Z','approved',$4::jsonb)`,
    [
      capture.captureId,
      `source-snapshot:${hex('e')}`,
      capture.artifactId,
      canonical({ sourceUrl: capture.sourceUrl, executionReceipt: receipt }),
    ]
  );
  await pool.query(
    `INSERT INTO outcome_external_evidence_batch (batch_id,capture_id,provider,evidence_count,issue_count,
      row_set_sha256,issue_set_sha256,status,finalized_at,batch_json)
     VALUES ($1,$2,'draftguru',$3,0,$4,$5,'open',NULL,'{}'::jsonb)`,
    [
      batchId,
      capture.captureId,
      rows.length,
      sha(rows.map(({ evidenceId }) => evidenceId).sort()),
      hex('0'),
    ]
  );
  for (const [index, row] of rows.entries())
    await pool.query(
      `INSERT INTO outcome_external_evidence_row (evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        row.evidenceId,
        batchId,
        index + 1,
        row.content.sourceRow.sourceKey,
        row.content.claim.kind,
        canonical(row),
      ]
    );
  await pool.query(
    `UPDATE outcome_external_evidence_batch SET status='finalized',finalized_at='2026-11-23T00:00:02.000Z'
      WHERE batch_id=$1`,
    [batchId]
  );
  const [selectionRow, orderRow] = rows.map(({ evidenceId }) => evidenceId);
  return createAflTradeExternalReconciliationCandidate({
    schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION,
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2026,
    sourceBatchIds: [batchId],
    identityResolutionIds: [],
    transactions: [],
    transfers: [],
    draftSelections: [
      {
        selectionId: address('external-draft-selection', {
          draftYear: 2026,
          draftType: 'national',
          selectionNumber: 2,
        }),
        draftYear: 2026,
        draftType: 'national',
        selectionNumber: 2,
        roundNumber: null,
        pickId: address('draft-pick', {
          draftYear: 2026,
          draftType: 'national',
          nominalPick: 2,
          nominalRound: null,
        }),
        playerId: 'player-synthetic',
        clubId: 'club-essendon',
        status: 'single_source',
        supportingProviders: ['draftguru'],
        evidenceIds: [selectionRow!],
      },
    ],
    pickCustody: [],
    pickLineage: [],
    draftOrderPicks: [
      {
        orderPickId: address('external-draft-order-pick', { evidenceId: orderRow }),
        draftYear: 2026,
        draftType: 'national',
        roundNumber: 5,
        pickNumber: null,
        clubId: 'club-carlton',
        outcome: 'removed',
        playerId: null,
        asPick: null,
        hopTransferIds: [],
        evidenceIds: [orderRow!],
      },
    ],
    issues: [],
    reconciledAt: '2026-11-23T01:00:00.000Z',
    publicationEligible: false,
  });
}

it('conserves an order row cited only by its record once 0293 is applied', async () => {
  const candidate = await stageOrderBatch();
  const persist = () =>
    new PostgresAflTradeExternalReconciliationRepository(sql).persistCandidate({
      candidate,
      identityResolutions: [],
    });
  await expect(persist()).rejects.toMatchObject({
    code: 'P0001',
    message: 'External reconciliation must conserve the exact source evidence set',
  });
  await pool.query(history.migrationSql);
  await expect(persist()).resolves.toMatchObject({ status: 'finalized' });
});
