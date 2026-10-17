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
 * Migration 0288 (issue 789): reconciliation carries one `draftBoardBidMatches` record per Footyinfo
 * matched bid. A real completion holding a Draftguru year page, an official session and a v2 board
 * whose pick 1 is a matched father-son bid, prepared through the real repository so the triggers are
 * the ones under test. The bidding club appears on no other board row. Before 0288 the identity-review
 * guard refuses its observation, canonical-target registration cannot rebuild its work item, and
 * finalization refuses a hand-built candidate citing a bid-match row only on its record; after it all
 * three accept.
 */
const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!url) throw new Error('Disposable PostgreSQL required.');
const MIGRATION = '0288_footyinfo_board_bid_match_reconciliation';
const schema = `board_bid_match_${process.pid}_${Date.now()}`;
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
}, 120000);
afterAll(async () => {
  await history?.cleanup();
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

async function completeFixturePlan() {
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
    { footyinfoBidMatch: true }
  );
  const fixtures = [draft, official, board];
  const plannedAt = (
    await pool.query<{ at: string }>(
      `SELECT to_char(
         date_trunc('milliseconds',GREATEST(clock_timestamp(),max(finalized_at)))+interval '1 millisecond',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
       FROM outcome_external_evidence_batch WHERE batch_id=ANY($1::text[])`,
      [fixtures.map(({ target }) => target.evidenceBatchId)]
    )
  ).rows[0]!.at;
  await new Promise((resolve) => setTimeout(resolve, 5));
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
  return { completion, board, metadata: draft.metadata };
}

const hex = (character: string) => character.repeat(64);

/**
 * A 2025 board batch staged directly (a selection, its matched-bid board pick and the bid match), so
 * a hand-built candidate isolates the finalize trigger's conservation clause, as the 0272 suite does.
 */
async function stageBidMatchBoard() {
  const capture = {
    captureId: `source-capture:${hex('e')}`,
    artifactId: `artifact:${hex('e')}`,
    contentSha256: hex('e'),
    mediaType: 'text/html',
    sourceUrl: 'https://www.footyinfo.com/draft/2025',
    capturedAt: '2025-12-01T00:00:00.000Z',
    effectiveAt: '2025-12-01T00:00:00.000Z',
    parserVersion: 'footyinfo-draft-board-parser/v2',
    fieldManifestSha256: hex('4'),
  };
  const club = { nativeId: 'GCS', recordedName: 'Gold Coast' };
  const player = { nativeId: 'synthetic-nominee', recordedName: 'Synthetic Nominee' };
  const bid = { club: { nativeId: 'WCE', recordedName: 'West Coast' }, basis: 'academy' as const };
  const claims: Parameters<typeof createAflTradeExternalEvidenceEnvelope>[0]['claim'][] = [
    {
      kind: 'draft_selection',
      draftYear: 2025,
      draftType: 'national',
      selectionNumber: 2,
      roundNumber: 1,
      player,
      selectedByClub: club,
    },
    {
      kind: 'draft_board_pick',
      draftYear: 2025,
      draftType: 'national',
      roundNumber: 1,
      recordedPickNumber: 2,
      status: 'selected',
      club,
      player,
      route: [],
      routeLabel: 'matched_bid',
      bid,
      points: 2481,
      note: null,
    },
    {
      kind: 'draft_board_bid_match',
      draftYear: 2025,
      draftType: 'national',
      nativePickId: '6592',
      selectionNumber: 2,
      roundNumber: 1,
      club,
      player,
      bid,
      points: 2481,
      pointsUsed: 1024,
      consumedPicks: [
        {
          nativePickId: '6495',
          label: 'R1 (GWS) - Pick 14',
          originalNumber: 14,
          originalClubCode: 'GWS',
          holdingClubCode: 'GCS',
          pointsUsed: 1024,
        },
      ],
      leftoverPicks: [],
    },
  ];
  const rows = claims.map((claim, index) =>
    createAflTradeExternalEvidenceEnvelope({
      schemaVersion: 'afl-trade-external-evidence/v1',
      provider: 'footyinfo',
      publicationEligible: false,
      capture,
      sourceRow: { ordinal: index + 1, sourceKey: `2025:national:${index + 1}` },
      claim,
    })
  );
  const batchId = `external-evidence-batch:${hex('e')}`;
  const receipt = createAflTradeExternalCaptureExecutionReceipt({
    schemaVersion: 'afl-trade-external-capture-execution/v1',
    rightsArtifactId: `source-rights:${hex('2')}`,
    gateDecisionId: `gate-decision:${hex('3')}`,
    gateDecisionKey: 'fixture:footyinfo-national-draft-board',
    ledgerRevision: 1,
    evaluatedAt: '2025-12-01T00:00:00.000Z',
    provider: 'footyinfo',
    capabilityId: 'footyinfo-national-draft-board',
    parserVersion: capture.parserVersion,
    fieldManifestSha256: hex('4'),
    upstreamRate: { requests: 1, perSeconds: 5, burst: 1 },
    cacheSeconds: 86_400,
    rawRetentionDays: 365,
    egressPolicyEvidenceId: `artifact:${hex('5')}`,
  });
  await pool.query(
    `INSERT INTO outcome_competition_season (competition,season_year) VALUES ('AFLM',2025)
      ON CONFLICT DO NOTHING`
  );
  await pool.query(
    `INSERT INTO outcome_artifact_custody (artifact_id,content_sha256,storage_uri,media_type,byte_length,
      artifact_class,environment,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,'text/html',1,'raw_source','test_fixture',
      '2025-12-01T00:00:00.000Z','2025-12-01T00:00:01.000Z','{}'::jsonb)`,
    [capture.artifactId, hex('e'), `artifact://sha256/${hex('e')}`]
  );
  await pool.query(
    `INSERT INTO outcome_source_capture_attempt
      (attempt_id,environment,provider,dataset,capability_id,status,started_at,completed_at,attempt_json)
     VALUES ('attempt-bid-match','test_fixture','footyinfo','bid-match','footyinfo-national-draft-board',
      'captured','2025-12-01T00:00:00.000Z','2025-12-01T00:00:01.000Z','{}'::jsonb)`
  );
  await pool.query(
    `INSERT INTO outcome_source_capture (capture_id,attempt_id,source_snapshot_id,source_artifact_id,
      environment,provider,dataset,dataset_version,access_mechanism,capability_id,competition,
      anchor_season_year,effective_at,captured_at,status,manifest_json)
     VALUES ($1,'attempt-bid-match',$2,$3,'test_fixture','footyinfo','bid-match','2025','automated_web',
      'footyinfo-national-draft-board','AFLM',2025,'2025-12-01T00:00:00.000Z',
      '2025-12-01T00:00:01.000Z','approved',$4::jsonb)`,
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
     VALUES ($1,$2,'footyinfo',$3,0,$4,$5,'open',NULL,'{}'::jsonb)`,
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
    `UPDATE outcome_external_evidence_batch SET status='finalized',finalized_at='2025-12-01T00:00:02.000Z'
      WHERE batch_id=$1`,
    [batchId]
  );
  const [selectionRow, boardPickRow, bidMatchRow] = rows.map(({ evidenceId }) => evidenceId);
  return createAflTradeExternalReconciliationCandidate({
    schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION,
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    sourceBatchIds: [batchId],
    identityResolutionIds: [],
    transactions: [],
    transfers: [],
    draftSelections: [
      {
        selectionId: address('external-draft-selection', {
          draftYear: 2025,
          draftType: 'national',
          selectionNumber: 2,
        }),
        draftYear: 2025,
        draftType: 'national',
        selectionNumber: 2,
        roundNumber: 1,
        pickId: address('draft-pick', {
          draftYear: 2025,
          draftType: 'national',
          nominalPick: 2,
          nominalRound: 1,
        }),
        playerId: 'player-synthetic-nominee',
        clubId: 'club-gold-coast',
        status: 'single_source',
        supportingProviders: ['footyinfo'],
        evidenceIds: [selectionRow!],
      },
    ],
    pickCustody: [],
    pickLineage: [],
    draftBoardPicks: [
      {
        boardPickId: address('external-draft-board-pick', { evidenceId: boardPickRow }),
        draftYear: 2025,
        draftType: 'national',
        roundNumber: 1,
        recordedPickNumber: 2,
        status: 'selected',
        clubId: 'club-gold-coast',
        routeClubIds: [],
        matchedBidBasis: 'academy',
        evidenceIds: [boardPickRow!],
      },
    ],
    draftBoardBidMatches: [
      {
        bidMatchId: address('external-draft-board-bid-match', { evidenceId: bidMatchRow }),
        draftYear: 2025,
        draftType: 'national',
        nativePickId: '6592',
        selectionNumber: 2,
        roundNumber: 1,
        clubId: 'club-gold-coast',
        playerId: 'player-synthetic-nominee',
        bidClubId: 'club-west-coast',
        basis: 'academy',
        points: 2481,
        pointsUsed: 1024,
        consumedPicks: [
          {
            nativePickId: '6495',
            label: 'R1 (GWS) - Pick 14',
            originalNumber: 14,
            originalClubId: 'club-gws',
            holdingClubId: 'club-gold-coast',
            pointsUsed: 1024,
          },
        ],
        leftoverPicks: [],
        evidenceIds: [bidMatchRow!],
      },
    ],
    issues: [],
    reconciledAt: '2026-10-17T01:00:00.000Z',
    publicationEligible: false,
  });
}

const actor = 'synthetic-bid-match-reviewer';

/** One identity-reviewer grant per provider: a resolution needs an authority for its own provider. */
async function reviewerAuthority(
  metadata: Awaited<ReturnType<typeof completeFixturePlan>>['metadata'],
  provider: 'draftguru' | 'footyinfo'
) {
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
  await metadata.putIfAbsent(ref, new TextEncoder().encode(canonical(document)));
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

it('reviews the bidding club and conserves the bid-match row once 0288 is applied', async () => {
  const { completion, board, metadata } = await completeFixturePlan();
  expect(completion).toMatchObject({ targetCount: 3, sourceBatchCount: 3 });
  const source = new PostgresAflTradeExternalHistoricalReconciliationSource(sql);
  const reviewRepository = new PostgresAflTradeExternalIdentityReviewRepository(sql);
  const authorities = {
    draftguru: await reviewerAuthority(metadata, 'draftguru'),
    footyinfo: await reviewerAuthority(metadata, 'footyinfo'),
  };
  const queue = await loadAflTradeExternalIdentityReviewQueue(
    { completionId: completion.completionId },
    { source, reviewRepository }
  );
  // The bidding club is a subject of its own, though it holds and routes no pick.
  expect(
    queue.items
      .filter(({ provider }) => provider === 'footyinfo')
      .map(({ entityKind, observedNames }) => `${entityKind}:${observedNames[0]}`)
      .sort()
  ).toEqual([
    'club:Bidding Club',
    'club:Origin Club',
    'club:Removed Club',
    'club:Synthetic Club',
    'player:Synthetic Player',
  ]);
  const reviewPackage = buildAflTradeExternalIdentityReviewPackage(
    await source.load(completion.completionId)
  );
  const rebuilds = async () =>
    Object.fromEntries(
      await Promise.all(
        reviewPackage.content.items
          .filter(({ workItem }) => workItem.content.subject.content.provider === 'footyinfo')
          .map(async ({ workItem }) => [
            workItem.content.observedNames[0],
            (
              await pool.query<{ exact: boolean }>(
                `SELECT outcome_external_registration_work_exact($1,$2::jsonb,'test_fixture') AS exact`,
                [completion.completionId, canonical(workItem)]
              )
            ).rows[0]!.exact,
          ])
      )
    );
  // Before 0288 registration rebuilds no identity from a bid-match row, so every work item holding
  // one differs from the package's.
  expect(await rebuilds()).toEqual({
    'Bidding Club': false,
    'Origin Club': true,
    'Removed Club': true,
    'Synthetic Club': false,
    'Synthetic Player': false,
  });

  const identityReviewedAt = await databaseInstant();
  const decide = async (item: (typeof queue.items)[number]) => {
    const name = item.observedNames[0]!;
    const canonicalId = `synthetic-${item.entityKind}-${name.toLowerCase().replace(/ /g, '-')}`;
    await pool.query(
      item.entityKind === 'player'
        ? `INSERT INTO outcome_player(player_id,display_name,status) VALUES($1,$2,'approved') ON CONFLICT DO NOTHING`
        : `INSERT INTO outcome_club(club_id,current_name,status) VALUES($1,$2,'approved') ON CONFLICT DO NOTHING`,
      [canonicalId, name]
    );
    return recordAflTradeExternalIdentityReviewDecision(
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
  };
  const bidder = queue.items.find(({ observedNames }) => observedNames[0] === 'Bidding Club')!;
  // Before 0288 the insert guard does not recognise the bid-match observation.
  await expect(decide(bidder)).rejects.toThrow(
    'External identity work item observation does not match its exact source identity'
  );

  // Before 0288 finalization counts no bid-match record as a citation, so a candidate that cites
  // the bid-match row only there is refused as unconserved and nothing is stored.
  const handBuilt = await stageBidMatchBoard();
  const persistHandBuilt = () =>
    new PostgresAflTradeExternalReconciliationRepository(sql).persistCandidate({
      candidate: handBuilt,
      identityResolutions: [],
    });
  await expect(persistHandBuilt()).rejects.toMatchObject({
    code: 'P0001',
    message: 'External reconciliation must conserve the exact source evidence set',
  });
  const candidateCount = async () =>
    (
      await pool.query<{ n: number }>(
        `SELECT count(*)::integer AS n FROM outcome_external_reconciliation_candidate`
      )
    ).rows[0]!.n;
  expect(await candidateCount()).toBe(0);

  await pool.query(history.migrationSql);

  await expect(persistHandBuilt()).resolves.toMatchObject({ status: 'finalized' });

  expect(Object.values(await rebuilds()).every(Boolean)).toBe(true);
  for (const item of queue.items) await decide(item);

  const prepared = await prepareAflTradeHistoricalReconciliation(
    { completionId: completion.completionId },
    {
      source,
      identityReviewRepository: reviewRepository,
      candidateRepository: new PostgresAflTradeExternalReconciliationRepository(sql),
    }
  );
  expect(prepared).toMatchObject({ status: 'finalized', blockingIssueCount: 0 });
  const candidate = await new PostgresAflTradeExternalCanonicalPromotionReviewRepository(
    sql
  ).loadCandidate(prepared.candidateId);
  expect(candidate.content.draftBoardBidMatches).toEqual([
    expect.objectContaining({
      selectionNumber: 1,
      clubId: 'synthetic-club-synthetic-club',
      playerId: 'synthetic-player-synthetic-player',
      bidClubId: 'synthetic-club-bidding-club',
      basis: 'father_son',
      consumedPicks: [
        expect.objectContaining({
          originalNumber: 30,
          originalClubId: 'synthetic-club-origin-club',
          holdingClubId: 'synthetic-club-synthetic-club',
          pointsUsed: 400,
        }),
      ],
    }),
  ]);
  // Every board row is cited by the stored candidate; the bid-match row only by its own record.
  const rows = await pool.query<{ evidence_id: string; claim_kind: string }>(
    `SELECT evidence_id, claim_kind FROM outcome_external_evidence_row WHERE batch_id=$1`,
    [board.target.evidenceBatchId]
  );
  const bidRow = rows.rows.find(({ claim_kind }) => claim_kind === 'draft_board_bid_match')!;
  expect(candidate.content.draftBoardBidMatches![0]!.evidenceIds).toEqual([bidRow.evidence_id]);
  const citedElsewhere = [
    ...candidate.content.draftSelections,
    ...(candidate.content.draftBoardPicks ?? []),
    ...candidate.content.issues,
  ].flatMap(({ evidenceIds }) => evidenceIds);
  expect(citedElsewhere).not.toContain(bidRow.evidence_id);
});
