import { Pool } from 'pg';

import {
  createLocalWorkbookPlayerIdentityReview,
  parseLocalWorkbookPlayerIdentityReview,
} from '../../src/server/aflTradeIntelligence/development/localWorkbookPlayerIdentityReview';
import { loadAflOutcomesDevelopmentWorkbook } from '../../src/server/aflTradeIntelligence/source/developmentWorkbookLoader';
import { projectAflOutcomesDevelopmentWorkbookTrades } from '../../src/server/aflTradeIntelligence/source/developmentWorkbookTradeProjection';

const REVIEWED_AT = '2026-08-16T14:30:00.000Z';
const FLANDERS_TRADE_ID = 'workbook-2025-c64962fd1891b951';
const FLANDERS_ASSET_ID = `${FLANDERS_TRADE_ID}-st-kilda-2`;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main(): Promise<void> {
  const workbookPath = required('AFL_OUTCOMES_DEV_WORKBOOK_PATH');
  const workbookSha256 = required('AFL_OUTCOMES_DEV_WORKBOOK_SHA256').toLowerCase();
  const workbook = await loadAflOutcomesDevelopmentWorkbook({
    workbookPath,
    expectedSha256: workbookSha256,
    runtimeEnvironment: process.env.NODE_ENV,
  });
  const detail = projectAflOutcomesDevelopmentWorkbookTrades(workbook).detailsById.get(
    FLANDERS_TRADE_ID
  );
  const asset = detail?.assets.find(({ id }) => id === FLANDERS_ASSET_ID);
  if (
    detail?.trade.title !== '2025 Trade for Sam Flanders' ||
    asset?.assetType !== 'player' ||
    asset.playerName !== 'Flanders' ||
    asset.assetText !== 'Flanders (0 games)' ||
    asset.clubName !== 'St Kilda'
  ) {
    throw new Error('The pinned workbook no longer matches the reviewed Sam Flanders asset.');
  }

  const pool = new Pool({
    connectionString: required('AFL_OUTCOMES_DATABASE_URL'),
    application_name: 'statly-local-workbook-player-identity-review',
    connectionTimeoutMillis: 30_000,
    max: 1,
  });
  try {
    const evidence = await pool.query<{
      evidence_bundle_id: string;
      canonical_player_id: string;
    }>(
      `SELECT head.evidence_bundle_id,identity.canonical_player_id
         FROM outcome_private_reviewed_evaluation_head head
         JOIN outcome_private_reviewed_evaluation_decision decision
           ON decision.decision_id=head.decision_id
         CROSS JOIN LATERAL (
           SELECT member.canonical_player_id
             FROM outcome_hpn_reviewed_season_member member
             JOIN outcome_provider_identity_candidate candidate
               ON candidate.provider_decoded_row_id=member.provider_decoded_row_id
            WHERE member.identity_state='resolved'
              AND candidate.recorded_name='Sam Flanders'
            GROUP BY member.canonical_player_id
         ) identity
        WHERE head.evidence_scope_key='afl-player-match-reviewed-2021-2026'
          AND head.status='authorized'
          AND decision.decision_json->'content'->>'status'='authorized'
          AND decision.decision_json->'content'->>'schemaVersion'
                ='afl-trade-private-reviewed-evidence-evaluation-decision/v1'
          AND decision.decision_json->'content'->>'authorityBoundary'
                ='exact_current_private_review_sets_and_retained_source_artifacts_for_internal_nonproduction_calculation_only'
          AND decision.decision_json->'content'->'permissions'->>'internalEvaluation'='true'
          AND decision.decision_json->'content'->'permissions'->>'derivedCalculations'='true'
          AND decision.decision_json->'content'->'publicationProhibited'='true'::jsonb
          AND outcome_private_reviewed_evidence_bundle_is_current(head.evidence_bundle_id)`,
      []
    );
    if (evidence.rows.length !== 1) {
      throw new Error('Sam Flanders requires one exact current reviewed evidence identity.');
    }
    const parent = evidence.rows[0]!;
    const review = createLocalWorkbookPlayerIdentityReview({
      workbookSha256,
      tradeId: detail.trade.tradeId,
      assetId: asset.id,
      sourcePlayerName: asset.playerName,
      sourceAssetText: asset.assetText,
      receivingClubName: asset.clubName,
      canonicalPlayerId: parent.canonical_player_id,
      recordedName: 'Sam Flanders',
      evidenceBundleId: parent.evidence_bundle_id,
      reviewerId: 'local-workbook-player-identity-reviewer',
      rationale:
        'Approved the exact Sam Flanders identity for this pinned private workbook asset after local identity, match, and factual review.',
      reviewedAt: REVIEWED_AT,
    });
    await pool.query('BEGIN');
    try {
      await pool.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `local-workbook-player-identity:${workbookSha256}:${asset.id}`,
      ]);
      await pool.query(
        `INSERT INTO outcome_local_workbook_player_identity_review
          (decision_id,workbook_sha256,trade_id,asset_id,source_player_name,
           source_asset_text,receiving_club_name,canonical_player_id,recorded_name,
           evidence_bundle_id,reviewer_id,reviewed_at,decision_content_sha256,decision_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (workbook_sha256,asset_id) DO NOTHING`,
        [
          review.decisionId,
          workbookSha256,
          detail.trade.tradeId,
          asset.id,
          asset.playerName,
          asset.assetText,
          asset.clubName,
          parent.canonical_player_id,
          'Sam Flanders',
          parent.evidence_bundle_id,
          review.content.reviewerId,
          review.content.reviewedAt,
          review.decisionId.split(':')[1],
          review,
        ]
      );
      const retained = await pool.query<{ decision_json: unknown }>(
        `SELECT decision_json
           FROM outcome_local_workbook_player_identity_review
          WHERE workbook_sha256=$1 AND asset_id=$2
          FOR SHARE`,
        [workbookSha256, asset.id]
      );
      if (
        retained.rows.length !== 1 ||
        parseLocalWorkbookPlayerIdentityReview(retained.rows[0]!.decision_json).decisionId !==
          review.decisionId
      ) {
        throw new Error('The retained local workbook player identity review conflicts.');
      }
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
    process.stdout.write(
      `${JSON.stringify({
        status: 'reviewed',
        tradeId: detail.trade.tradeId,
        assetId: asset.id,
        recordedName: review.content.recordedName,
        publicationEligible: false,
      })}\n`
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
