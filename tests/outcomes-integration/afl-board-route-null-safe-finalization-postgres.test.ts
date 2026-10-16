import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress as address,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createAflTradeExternalEvidenceEnvelope } from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { createAflTradeExternalCaptureExecutionReceipt } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import { AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { createAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import { PostgresAflTradeExternalReconciliationRepository } from '@/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

/**
 * Migration 0286 (statlyaus/Statly#853): pick-identity rule 5 (migration 0273) skips a Footyinfo
 * board pick whose route did not resolve (`routeClubIds` JSON null) instead of failing finalization
 * with 22023 "cannot get array length of a scalar", and still refuses an unrecorded off-route
 * transfer when the route is an array. A hand-built candidate citing one retained source row, as in
 * the 0273 suite, so only the rule under test can refuse it.
 */
const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!url) throw new Error('Disposable PostgreSQL required.');
const MIGRATION = '0286_board_route_null_safe_finalization';
const schema = `board_route_null_safe_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const sql = createPgAflOutcomeSqlClient(pool);
let history: Awaited<ReturnType<typeof deployOutcomesHistoryBefore>>;

const digest = (character: string) => character.repeat(64);
const batchId = `external-evidence-batch:${digest('b')}`;
const captureId = `source-capture:${digest('c')}`;
const evidence = createAflTradeExternalEvidenceEnvelope({
  schemaVersion: 'afl-trade-external-evidence/v1',
  provider: 'draftguru',
  publicationEligible: false,
  capture: {
    captureId,
    artifactId: `artifact:${digest('1')}`,
    contentSha256: digest('1'),
    mediaType: 'text/html',
    sourceUrl: 'https://www.draftguru.com.au/trades/board-route-fixture',
    capturedAt: '2025-11-01T00:00:00.000Z',
    effectiveAt: '2025-11-01T00:00:00.000Z',
    parserVersion: 'draftguru/v1',
    fieldManifestSha256: digest('4'),
  },
  sourceRow: { ordinal: 1, sourceKey: 'fixture-trade' },
  claim: {
    kind: 'transaction',
    nativeEventId: 'board-route-fixture',
    seasonYear: 2025,
    occurredOn: null,
    transactionType: 'trade',
    title: null,
  },
});
const cited = [evidence.evidenceId];
const club = (name: string) => `club-${name}`;
const pickId = address('draft-pick', {
  draftYear: 2025,
  draftType: 'national',
  eventualSelection: { provider: 'draftguru', playerNativeId: 'board-route' },
});

/**
 * Port Adelaide trades the pick to Gold Coast, which selects at 11; the board states the selection
 * with `route` (null: a route club had no reviewed resolution).
 */
function candidate(route: string[] | null) {
  const transactionId = address('external-transaction', {
    provider: 'draftguru',
    nativeEventId: 'board-route',
  });
  const transferId = address('external-transfer', { transactionId, nativeTransferId: 'a' });
  return createAflTradeExternalReconciliationCandidate({
    schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION,
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    sourceBatchIds: [batchId],
    identityResolutionIds: [],
    transactions: [
      {
        transactionId,
        providerEventId: 'board-route',
        seasonYear: 2025,
        occurredOn: null,
        transactionType: 'trade' as const,
        title: null,
        parties: [club('gold-coast'), club('port-adelaide')],
        transferIds: [transferId],
        status: 'single_source' as const,
        evidenceIds: cited,
      },
    ],
    transfers: [
      {
        transferId,
        transactionId,
        fromClubId: club('port-adelaide'),
        toClubId: club('gold-coast'),
        asset: {
          kind: 'pick_entitlement' as const,
          pickId,
          draftYear: 2025,
          draftType: 'national',
          nominalRound: null,
          nominalPick: 11,
          originalClubId: null,
          recordedLabel: null,
        },
        status: 'single_source' as const,
        evidenceIds: cited,
      },
    ],
    draftSelections: [
      {
        selectionId: address('external-draft-selection', {
          draftYear: 2025,
          draftType: 'national',
          selectionNumber: 11,
        }),
        draftYear: 2025,
        draftType: 'national',
        selectionNumber: 11,
        roundNumber: null,
        pickId,
        playerId: 'player-11',
        clubId: club('gold-coast'),
        status: 'single_source' as const,
        supportingProviders: ['draftguru'] as ['draftguru'],
        evidenceIds: cited,
      },
    ],
    pickCustody: [],
    pickLineage: [],
    draftBoardPicks: [
      {
        boardPickId: address('external-draft-board-pick', { fixture: 11 }),
        draftYear: 2025,
        draftType: 'national',
        roundNumber: 1,
        recordedPickNumber: 11,
        status: 'selected' as const,
        clubId: club('gold-coast'),
        routeClubIds: route === null ? null : route.map(club),
        evidenceIds: cited,
      },
    ],
    issues: [],
    reconciledAt: '2026-10-16T00:00:00.000Z',
    publicationEligible: false,
  });
}

const persist = (record: ReturnType<typeof candidate>) =>
  new PostgresAflTradeExternalReconciliationRepository(sql).persistCandidate({
    candidate: record,
    identityResolutions: [],
  });

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url);
  scoped.searchParams.set('schema', schema);
  history = await deployOutcomesHistoryBefore(MIGRATION, scoped.toString(), pool);
  const receipt = createAflTradeExternalCaptureExecutionReceipt({
    schemaVersion: 'afl-trade-external-capture-execution/v1',
    rightsArtifactId: `source-rights:${digest('2')}`,
    gateDecisionId: `gate-decision:${digest('3')}`,
    gateDecisionKey: 'fixture:draftguru-trade-detail',
    ledgerRevision: 1,
    evaluatedAt: '2025-11-01T00:00:00.000Z',
    provider: 'draftguru',
    capabilityId: 'draftguru-trade-detail',
    parserVersion: 'draftguru/v1',
    fieldManifestSha256: digest('4'),
    upstreamRate: { requests: 1, perSeconds: 3, burst: 1 },
    cacheSeconds: 86_400,
    rawRetentionDays: 365,
    egressPolicyEvidenceId: `artifact:${digest('5')}`,
  });
  await pool.query(
    `INSERT INTO outcome_competition_season (competition,season_year) VALUES ('AFLM',2025)`
  );
  await pool.query(
    `INSERT INTO outcome_artifact_custody (artifact_id,content_sha256,storage_uri,media_type,byte_length,
      artifact_class,environment,created_at,verified_at,custody_json)
     VALUES ('artifact:${digest('1')}',$1,$2,'text/html',1,'raw_source','test_fixture',
      '2025-11-01T00:00:00.000Z','2025-11-01T00:00:01.000Z','{}'::jsonb)`,
    [digest('1'), `artifact://sha256/${digest('1')}`]
  );
  await pool.query(`INSERT INTO outcome_source_capture_attempt
    (attempt_id,environment,provider,dataset,capability_id,status,started_at,completed_at,attempt_json)
    VALUES ('attempt-board-route','test_fixture','draftguru','trades','draftguru-trade-detail',
      'captured','2025-11-01T00:00:00.000Z','2025-11-01T00:00:01.000Z','{}'::jsonb)`);
  await pool.query(
    `INSERT INTO outcome_source_capture (capture_id,attempt_id,source_snapshot_id,source_artifact_id,
      environment,provider,dataset,dataset_version,access_mechanism,capability_id,competition,
      anchor_season_year,effective_at,captured_at,status,manifest_json)
     VALUES ($1,'attempt-board-route',$2,'artifact:${digest('1')}','test_fixture','draftguru','trades',
      '2025','automated_web','draftguru-trade-detail','AFLM',2025,'2025-10-15T00:00:00.000Z',
      '2025-11-01T00:00:01.000Z','approved',$3::jsonb)`,
    [
      captureId,
      `source-snapshot:${digest('2')}`,
      canonicalizeAflTradeJson({
        sourceUrl: 'https://www.draftguru.com.au/trades/board-route-fixture',
        executionReceipt: receipt,
      }),
    ]
  );
  await pool.query(
    `INSERT INTO outcome_external_evidence_batch (batch_id,capture_id,provider,evidence_count,issue_count,
      row_set_sha256,issue_set_sha256,status,finalized_at,batch_json)
     VALUES ($1,$2,'draftguru',1,0,$3,$4,'open',NULL,'{}'::jsonb)`,
    [batchId, captureId, sha256AflTradeCanonicalJson([evidence.evidenceId]), digest('0')]
  );
  await pool.query(
    `INSERT INTO outcome_external_evidence_row (evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json)
     VALUES ($1,$2,1,'fixture-trade','transaction',$3::jsonb)`,
    [evidence.evidenceId, batchId, canonicalizeAflTradeJson(evidence)]
  );
  await pool.query(
    `UPDATE outcome_external_evidence_batch SET status='finalized',finalized_at='2025-11-01T00:00:02.000Z'
      WHERE batch_id=$1`,
    [batchId]
  );
}, 300_000);

afterAll(async () => {
  await history?.cleanup();
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

describe('rule 5 with an unresolved board route (migration 0286)', () => {
  it('finalizes a candidate whose selected board pick has a null route', async () => {
    await pool.query(history.migrationSql);
    await expect(persist(candidate(null))).resolves.toMatchObject({ status: 'finalized' });
  });

  it('still refuses an unrecorded off-route transfer when the route resolved', async () => {
    await expect(persist(candidate(['richmond', 'carlton', 'gold-coast']))).rejects.toEqual(
      expect.objectContaining({
        code: 'P0001',
        message: expect.stringContaining('Pick-identity rule 5:'),
      })
    );
    await expect(persist(candidate(['port-adelaide', 'gold-coast']))).resolves.toMatchObject({
      status: 'finalized',
    });
  });
});
