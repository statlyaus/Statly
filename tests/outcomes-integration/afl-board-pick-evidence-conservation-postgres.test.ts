import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createAflTradeContentAddress as address,
  canonicalizeAflTradeJson as canonical,
  sha256AflTradeCanonicalJson as sha,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeRetainedExternalCapturePlan } from '@/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';
import { createAflTradeExternalEvidenceEnvelope } from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { createAflTradeExternalCaptureExecutionReceipt } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import { AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { createAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import { PostgresAflTradeExternalDiscoveryRepository } from '@/server/aflTradeIntelligence/source/postgresExternalDraftTradeDiscoveryRepository';
import { PostgresAflTradeExternalHistoricalCaptureCompletionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalCaptureCompletionRepository';
import { PostgresAflTradeExternalHistoricalReconciliationSource } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalReconciliationSource';
import { PostgresAflTradeExternalIdentityReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalIdentityReviewRepository';
import { buildAflTradeExternalIdentityReviewPackage } from '@/server/aflTradeIntelligence/source/externalIdentityReviewWorkBuilder';
import {
  loadAflTradeExternalIdentityReviewQueue,
  recordAflTradeExternalIdentityReviewDecision,
} from '@/server/aflTradeIntelligence/source/externalIdentityReviewService';
import { prepareAflTradeHistoricalReconciliation } from '@/server/aflTradeIntelligence/source/externalHistoricalReconciliationPreparation';
import { PostgresAflTradeExternalReconciliationRepository } from '@/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';
import { PostgresAflTradeExternalCanonicalPromotionReviewRepository } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionReviewRepository';
import { createRetainedExternalCaptureFixture } from '../testUtils/retainedExternalCaptureFixture';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

/**
 * Migration 0272 (issue 853): finalization conserves the board rows a candidate's Footyinfo board
 * picks cite. Before it, the finalize trigger compared the source rows only with the rows cited by
 * transactions, transfers, selections, custody, lineage, issues and the deferred set, so every
 * board row looked uncited and the whole candidate was refused. A real completion holding a
 * Draftguru year page and a Footyinfo board, prepared through the real repository, so the trigger
 * is the one under test. The board's passed pick is routed from, and its removed pick held by, a club
 * on no selection; the identity-review package observes both (#853), which needs the observation
 * guards of migration 0285, applied here out of order because they touch no 0272 definition.
 */
const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!url) throw new Error('Disposable PostgreSQL required.');
const MIGRATION = '0272_board_pick_evidence_conservation';
const schema = `board_pick_conservation_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const sql = createPgAflOutcomeSqlClient(pool);
let history: Awaited<ReturnType<typeof deployOutcomesHistoryBefore>>;
const databaseInstant = async () =>
  (
    await pool.query<{ at: string }>(
      `SELECT to_char(date_trunc('milliseconds',clock_timestamp()) AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`
    )
  ).rows[0]!.at;
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url);
  scoped.searchParams.set('schema', schema);
  history = await deployOutcomesHistoryBefore(MIGRATION, scoped.toString(), pool);
  await pool.query(
    await readFile(
      join(
        import.meta.dirname,
        '../../prisma/afl-trade-outcomes/migrations/0285_board_pick_identity_observations/migration.sql'
      ),
      'utf8'
    )
  );
}, 120000);
afterAll(async () => {
  await history?.cleanup();
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

it('conserves the board rows a candidate cites only on its board picks once 0272 is applied', async () => {
  // The year page and the official session, as the retained-selection suite pairs them, so pick 1
  // resolves through the dated session and the board's effect on its status is observable.
  const draft = await createRetainedExternalCaptureFixture(sql, false, 'test_fixture', 27);
  const official = await createRetainedExternalCaptureFixture(sql, true);
  const board = await createRetainedExternalCaptureFixture(
    sql,
    false,
    'test_fixture',
    1,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    { footyinfoBoard: true }
  );
  const plannedAt = (
    await pool.query<{ at: string }>(
      `SELECT to_char(
         date_trunc('milliseconds',GREATEST(clock_timestamp(),max(finalized_at)))+interval '1 millisecond',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
       FROM outcome_external_evidence_batch WHERE batch_id=ANY($1::text[])`,
      [
        [
          draft.target.evidenceBatchId,
          official.target.evidenceBatchId,
          board.target.evidenceBatchId,
        ],
      ]
    )
  ).rows[0]!.at;
  await new Promise((resolve) => setTimeout(resolve, 5));
  const fixtures = [draft, official, board];
  const plan = createAflTradeRetainedExternalCapturePlan({
    environment: 'test_fixture',
    competition: 'AFLM',
    plannedAt,
    scopeEvidence: fixtures
      .flatMap(({ scopeEvidence }) => scopeEvidence)
      .sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
    targets: fixtures
      .map(({ target }) => target)
      .sort((a, b) => a.captureId.localeCompare(b.captureId)),
  });
  await new PostgresAflTradeExternalDiscoveryRepository(sql).persistRetainedPlan(plan, {
    read: async (ref) => {
      for (const repo of fixtures.flatMap(({ raw, metadata }) => [raw, metadata])) {
        const value = await repo.loadExact(ref, 2097152);
        if (value) return value.bytes;
      }
      throw new Error('Missing retained fixture bytes');
    },
  });
  const completion = await new PostgresAflTradeExternalHistoricalCaptureCompletionRepository(
    sql
  ).completeRetainedPlan(plan.planId);
  expect(completion).toMatchObject({ targetCount: 3, sourceBatchCount: 3 });

  const source = new PostgresAflTradeExternalHistoricalReconciliationSource(sql);
  const reviewRepository = new PostgresAflTradeExternalIdentityReviewRepository(sql);
  const actor = 'synthetic-board-pick-reviewer';
  // One identity-reviewer grant per provider: a resolution needs an authority for its own provider.
  async function authority(provider: 'draftguru' | 'footyinfo') {
    const at = await databaseInstant();
    const document = {
      evidenceKind: 'reviewer_authority_evidence',
      environment: 'test_fixture',
      principalRef: actor,
      role: 'afl_trade_external_identity_reviewer',
      provider,
      capabilityId: 'external_identity_resolution',
      scopeKey: 'public-afl-draft-trade-outcomes',
      competition: 'AFLM',
      validFromSeason: 2024,
      validThroughSeason: 2024,
    };
    const referenceId = address('reviewer-authority-evidence', document),
      digest = sha(document),
      ref = createAflTradeCanonicalJsonArtifactRef(document, at);
    await draft.metadata.putIfAbsent(ref, new TextEncoder().encode(canonical(document)));
    const approval = address('governed-evidence-approval-decision', { referenceId });
    await sql.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO outcome_artifact_custody(artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,environment,created_at,verified_at,custody_json) VALUES($1,$2,$3,$4,$5,'capture_metadata','test_fixture',$6,$6,'{}')`,
        [ref.artifactId, ref.contentSha256, ref.storageUri, ref.mediaType, ref.byteLength, at]
      );
      await tx.query(
        `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at) VALUES($1,'governed_evidence_reference',$2,'approved','Synthetic scoped technical authority',$3::jsonb,$4,$5)`,
        [approval, referenceId, canonical({ referenceSha256: digest }), actor, at]
      );
      await tx.query(
        `INSERT INTO outcome_governed_evidence_reference(reference_id,reference_sha256,evidence_kind,artifact_id,environment,status,approval_decision_id,created_at,evidence_canonical_json,evidence_json) VALUES($1,$2,'reviewer_authority_evidence',$3,'test_fixture','approved',$4,$5,$6::text,($6::text)::jsonb)`,
        [referenceId, digest, ref.artifactId, approval, at, canonical(document)]
      );
      await tx.query(
        `INSERT INTO outcome_operational_principal_authority(authority_evidence_id,principal_ref,role,scope_key,provider,capability_id,competition,valid_from_season,valid_through_season,valid_from,valid_through) VALUES($1,$2,'afl_trade_external_identity_reviewer','public-afl-draft-trade-outcomes',$3,'external_identity_resolution','AFLM',2024,2024,$4,NULL)`,
        [referenceId, actor, provider, at]
      );
    });
    return referenceId;
  }
  const authorities = {
    draftguru: await authority('draftguru'),
    footyinfo: await authority('footyinfo'),
  };
  const queue = await loadAflTradeExternalIdentityReviewQueue(
    { completionId: completion.completionId },
    { source, reviewRepository }
  );
  // The board's club and player are subjects of their own provider; both resolve to the same
  // canonical club and player as the year page's, by the name each provider writes. A club named
  // only by a board pick's route or holder is a subject too, so its reviewed decision loads.
  expect(
    queue.items
      .filter(({ provider }) => provider === 'footyinfo')
      .map(({ entityKind, observedNames }) => `${entityKind}:${observedNames[0]}`)
      .sort()
  ).toEqual([
    'club:Origin Club',
    'club:Removed Club',
    'club:Synthetic Club',
    'player:Synthetic Player',
  ]);
  // Canonical-target registration rebuilds each provider-native work item in SQL from the same
  // board-pick identities (migration 0285).
  const reviewPackage = buildAflTradeExternalIdentityReviewPackage(
    await source.load(completion.completionId)
  );
  for (const { workItem } of reviewPackage.content.items.filter(
    ({ workItem }) => workItem.content.subject.content.provider === 'footyinfo'
  )) {
    expect(
      (
        await pool.query<{ exact: boolean }>(
          `SELECT outcome_external_registration_work_exact($1,$2::jsonb,'test_fixture') AS exact`,
          [completion.completionId, canonical(workItem)]
        )
      ).rows[0]!.exact
    ).toBe(true);
  }
  const identityReviewedAt = await databaseInstant();
  for (const item of queue.items) {
    const name = item.observedNames[0]!;
    const canonicalId = `synthetic-${item.entityKind}-${name.toLowerCase().replace(/ /g, '-')}`;
    await pool.query(
      item.entityKind === 'player'
        ? `INSERT INTO outcome_player(player_id,display_name,status) VALUES($1,$2,'approved') ON CONFLICT DO NOTHING`
        : `INSERT INTO outcome_club(club_id,current_name,status) VALUES($1,$2,'approved') ON CONFLICT DO NOTHING`,
      [canonicalId, name]
    );
    await recordAflTradeExternalIdentityReviewDecision(
      {
        completionId: completion.completionId,
        subjectId: item.subjectId,
        decision: 'approved',
        canonicalId,
        rationale: 'Synthetic exact native identity',
        authorityEvidenceId: authorities[item.provider as 'draftguru' | 'footyinfo'],
        decidedBy: actor,
        decidedAt: identityReviewedAt,
      },
      { source, reviewRepository }
    );
  }

  const candidateRepository = new PostgresAflTradeExternalReconciliationRepository(sql);
  const prepare = () =>
    prepareAflTradeHistoricalReconciliation(
      { completionId: completion.completionId },
      { source, identityReviewRepository: reviewRepository, candidateRepository }
    );
  // Before 0272 the three board rows are cited only on board picks, which the trigger never read.
  await expect(prepare()).rejects.toMatchObject({
    code: 'P0001',
    message: 'External reconciliation must conserve the exact source evidence set',
  });
  expect(
    (
      await pool.query(
        `SELECT count(*)::integer AS n FROM outcome_external_reconciliation_candidate`
      )
    ).rows[0]!.n
  ).toBe(0);

  await pool.query(history.migrationSql);

  const prepared = await prepare();
  expect(prepared).toMatchObject({ status: 'finalized', blockingIssueCount: 0 });
  const candidate = await new PostgresAflTradeExternalCanonicalPromotionReviewRepository(
    sql
  ).loadCandidate(prepared.candidateId);
  expect(candidate.content.draftBoardPicks?.map(({ status }) => status).sort()).toEqual([
    'passed',
    'removed',
    'selected',
  ]);
  // The board corroborates the year page's pick 1 across the round difference (#898): the year
  // page writes no round, the board does, and the selection keeps the year page's. The other 26
  // stay as the year page and session alone make them.
  expect(candidate.content.draftSelections).toHaveLength(27);
  expect(
    candidate.content.draftSelections.find(({ selectionNumber }) => selectionNumber === 1)
  ).toMatchObject({
    status: 'corroborated',
    supportingProviders: ['draftguru', 'footyinfo'],
    roundNumber: null,
  });
  expect(
    candidate.content.draftSelections
      .filter(({ selectionNumber }) => selectionNumber !== 1)
      .every(({ status }) => status === 'single_source')
  ).toBe(true);
  // Every row of the board batch is cited by the stored candidate, and only board picks cite the
  // passed and removed rows.
  const cited = new Set([
    ...candidate.content.draftSelections.flatMap(({ evidenceIds }) => evidenceIds),
    ...(candidate.content.draftBoardPicks ?? []).flatMap(({ evidenceIds }) => evidenceIds),
  ]);
  const sourceRows = await pool.query<{ evidence_id: string; claim_kind: string }>(
    `SELECT evidence_id, claim_kind FROM outcome_external_evidence_row WHERE batch_id=$1`,
    [board.target.evidenceBatchId]
  );
  expect(sourceRows.rows.map(({ claim_kind }) => claim_kind).sort()).toEqual([
    'draft_board_pick',
    'draft_board_pick',
    'draft_board_pick',
    'draft_selection',
  ]);
  expect(sourceRows.rows.filter(({ evidence_id }) => !cited.has(evidence_id))).toEqual([]);
  const onlyOnBoardPicks = (candidate.content.draftBoardPicks ?? [])
    .filter(({ status }) => status !== 'selected')
    .flatMap(({ evidenceIds }) => evidenceIds);
  expect(onlyOnBoardPicks).toHaveLength(2);
  for (const evidenceId of onlyOnBoardPicks) {
    expect(
      candidate.content.draftSelections.some(({ evidenceIds }) => evidenceIds.includes(evidenceId))
    ).toBe(false);
  }
});

/**
 * Owner decision 2026-10-14 (issue 789): a not-used outcome whose nominee count rests on a draft
 * membership a Footyinfo board proved names `draftProvenBy` and cites the receiving club's board
 * `draft_selection` row. Finalization stores it and conserves every board row. Hand-built over two
 * staged batches, a Draftguru trade row and a 2025 board (selection plus board pick), so only the
 * new outcome shape is under test. It runs after the test above has applied 0272.
 */
it('finalizes a not-used outcome whose 2025 draft a Footyinfo board proved', async () => {
  const hex = (character: string) => character.repeat(64);
  async function stage(
    provider: 'draftguru' | 'footyinfo',
    suffix: string,
    capabilityId: string,
    sourceUrl: string,
    claims: Parameters<typeof createAflTradeExternalEvidenceEnvelope>[0]['claim'][]
  ) {
    const captureId = `source-capture:${hex(suffix)}`;
    const artifactId = `artifact:${hex(suffix)}`;
    const capture = {
      captureId,
      artifactId,
      contentSha256: hex(suffix),
      mediaType: 'text/html',
      sourceUrl,
      capturedAt: '2025-12-01T00:00:00.000Z',
      effectiveAt: '2025-12-01T00:00:00.000Z',
      parserVersion: `${provider}/v1`,
      fieldManifestSha256: hex('4'),
    };
    const rows = claims.map((claim, index) =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: 'afl-trade-external-evidence/v1',
        provider,
        publicationEligible: false,
        capture,
        sourceRow: { ordinal: index + 1, sourceKey: `board-proven:${index + 1}` },
        claim,
      })
    );
    const batchId = `external-evidence-batch:${hex(suffix)}`;
    const receipt = createAflTradeExternalCaptureExecutionReceipt({
      schemaVersion: 'afl-trade-external-capture-execution/v1',
      rightsArtifactId: `source-rights:${hex('2')}`,
      gateDecisionId: `gate-decision:${hex('3')}`,
      gateDecisionKey: `fixture:${capabilityId}`,
      ledgerRevision: 1,
      evaluatedAt: '2025-12-01T00:00:00.000Z',
      provider,
      capabilityId,
      parserVersion: capture.parserVersion,
      fieldManifestSha256: hex('4'),
      upstreamRate: { requests: 1, perSeconds: 5, burst: 1 },
      cacheSeconds: 86_400,
      rawRetentionDays: 365,
      egressPolicyEvidenceId: `artifact:${hex('5')}`,
    });
    await pool.query(
      `INSERT INTO outcome_artifact_custody (artifact_id,content_sha256,storage_uri,media_type,byte_length,
        artifact_class,environment,created_at,verified_at,custody_json)
       VALUES ($1,$2,$3,'text/html',1,'raw_source','test_fixture',
        '2025-12-01T00:00:00.000Z','2025-12-01T00:00:01.000Z','{}'::jsonb)`,
      [artifactId, hex(suffix), `artifact://sha256/${hex(suffix)}`]
    );
    await pool.query(
      `INSERT INTO outcome_source_capture_attempt
        (attempt_id,environment,provider,dataset,capability_id,status,started_at,completed_at,attempt_json)
       VALUES ($1,'test_fixture',$2,'board-proven',$3,'captured','2025-12-01T00:00:00.000Z',
        '2025-12-01T00:00:01.000Z','{}'::jsonb)`,
      [`attempt-board-proven-${suffix}`, provider, capabilityId]
    );
    await pool.query(
      `INSERT INTO outcome_source_capture (capture_id,attempt_id,source_snapshot_id,source_artifact_id,
        environment,provider,dataset,dataset_version,access_mechanism,capability_id,competition,
        anchor_season_year,effective_at,captured_at,status,manifest_json)
       VALUES ($1,$2,$3,$4,'test_fixture',$5,'board-proven','2025','automated_web',$6,'AFLM',2025,
        '2025-12-01T00:00:00.000Z','2025-12-01T00:00:01.000Z','approved',$7::jsonb)`,
      [
        captureId,
        `attempt-board-proven-${suffix}`,
        `source-snapshot:${hex(suffix)}`,
        artifactId,
        provider,
        capabilityId,
        canonical({ sourceUrl, executionReceipt: receipt }),
      ]
    );
    await pool.query(
      `INSERT INTO outcome_external_evidence_batch (batch_id,capture_id,provider,evidence_count,issue_count,
        row_set_sha256,issue_set_sha256,status,finalized_at,batch_json)
       VALUES ($1,$2,$3,$4,0,$5,$6,'open',NULL,'{}'::jsonb)`,
      [
        batchId,
        captureId,
        provider,
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
      `UPDATE outcome_external_evidence_batch SET status='finalized',finalized_at='2025-12-01T00:00:02.000Z'
        WHERE batch_id=$1`,
      [batchId]
    );
    return { batchId, evidenceIds: rows.map(({ evidenceId }) => evidenceId) };
  }

  await pool.query(
    `INSERT INTO outcome_competition_season (competition,season_year) VALUES ('AFLM',2025)
      ON CONFLICT DO NOTHING`
  );
  const club = { nativeId: 'WBD', recordedName: 'Western Bulldogs' };
  const player = { nativeId: 'synthetic-draftee', recordedName: 'Synthetic Draftee' };
  const trade = await stage(
    'draftguru',
    'd',
    'draftguru-trade-detail',
    'https://www.draftguru.com.au/trades/board-proven-fixture',
    [
      {
        kind: 'transaction',
        nativeEventId: 'board-proven-fixture',
        seasonYear: 2025,
        occurredOn: null,
        transactionType: 'trade',
        title: null,
      },
    ]
  );
  const board = await stage(
    'footyinfo',
    'e',
    'footyinfo-national-draft-board',
    'https://www.footyinfo.com/draft/2025',
    [
      {
        kind: 'draft_selection',
        draftYear: 2025,
        draftType: 'national',
        selectionNumber: 1,
        roundNumber: 1,
        player,
        selectedByClub: club,
      },
      {
        kind: 'draft_board_pick',
        draftYear: 2025,
        draftType: 'national',
        roundNumber: 1,
        recordedPickNumber: 1,
        status: 'selected',
        club,
        player,
        route: [],
        routeLabel: null,
        bid: null,
        points: null,
        note: null,
      },
    ]
  );
  const [tradeRow] = trade.evidenceIds;
  const [selectionRow, boardPickRow] = board.evidenceIds;
  const transactionId = address('external-transaction', {
    provider: 'draftguru',
    nativeEventId: 'board-proven-fixture',
  });
  const transferId = address('external-transfer', { transactionId, nativeTransferId: 'pick' });
  const pickId = address('draft-pick', {
    draftYear: 2025,
    draftType: 'national',
    roundNumber: 2,
    originalClubId: 'club-gws',
  });
  const record = createAflTradeExternalReconciliationCandidate({
    schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION,
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    sourceBatchIds: [trade.batchId, board.batchId].sort(),
    identityResolutionIds: [],
    transactions: [
      {
        transactionId,
        providerEventId: 'board-proven-fixture',
        seasonYear: 2025,
        occurredOn: null,
        transactionType: 'trade',
        title: null,
        parties: ['club-gws', 'club-western-bulldogs'],
        transferIds: [transferId],
        status: 'single_source',
        evidenceIds: [tradeRow!],
      },
    ],
    transfers: [
      {
        transferId,
        transactionId,
        fromClubId: 'club-gws',
        toClubId: 'club-western-bulldogs',
        asset: {
          kind: 'pick_entitlement',
          pickId,
          draftYear: 2025,
          draftType: 'national',
          nominalRound: 2,
          nominalPick: null,
          originalClubId: 'club-gws',
          recordedLabel: null,
        },
        status: 'single_source',
        evidenceIds: [tradeRow!],
      },
    ],
    draftSelections: [
      {
        selectionId: address('external-draft-selection', {
          draftYear: 2025,
          draftType: 'national',
          selectionNumber: 1,
        }),
        draftYear: 2025,
        draftType: 'national',
        selectionNumber: 1,
        roundNumber: 1,
        pickId: address('draft-pick', {
          draftYear: 2025,
          draftType: 'national',
          nominalPick: 1,
          nominalRound: 1,
        }),
        playerId: 'player-synthetic-draftee',
        clubId: 'club-western-bulldogs',
        status: 'single_source',
        supportingProviders: ['footyinfo'],
        evidenceIds: [selectionRow!],
      },
    ],
    pickCustody: [],
    pickLineage: [],
    pickOutcomes: [
      {
        outcomeId: address('external-pick-outcome', { transferId, evidenceId: tradeRow }),
        transferId,
        disposition: 'not_used',
        outcomeStatus: 'stated',
        selectionId: null,
        playerId: null,
        nominationBasis: 'club_took_no_nominated_player',
        receivingClubNominatedSelections: 0,
        draftProvenBy: 'footyinfo',
        evidenceIds: [tradeRow!, selectionRow!].sort(),
      },
    ],
    draftBoardPicks: [
      {
        boardPickId: address('external-draft-board-pick', { evidenceId: boardPickRow }),
        draftYear: 2025,
        draftType: 'national',
        roundNumber: 1,
        recordedPickNumber: 1,
        status: 'selected',
        clubId: 'club-western-bulldogs',
        routeClubIds: [],
        evidenceIds: [boardPickRow!],
      },
    ],
    issues: [],
    reconciledAt: '2026-10-14T01:00:00.000Z',
    publicationEligible: false,
  });
  await expect(
    new PostgresAflTradeExternalReconciliationRepository(sql).persistCandidate({
      candidate: record,
      identityResolutions: [],
    })
  ).resolves.toMatchObject({ status: 'finalized' });
  const stored = await new PostgresAflTradeExternalCanonicalPromotionReviewRepository(
    sql
  ).loadCandidate(record.candidateId);
  expect(stored.content.pickOutcomes).toEqual([
    expect.objectContaining({
      nominationBasis: 'club_took_no_nominated_player',
      draftProvenBy: 'footyinfo',
      evidenceIds: expect.arrayContaining([selectionRow]),
    }),
  ]);
});
