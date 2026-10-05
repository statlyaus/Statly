import type { DraftTradeDetail } from '@/lib/draftTrades/read';

import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import type { AflOutcomesDevelopmentAcquisitionItem } from '../source/developmentWorkbookAcquisitionProjection';
import {
  projectLocalPrivateReviewedTradeCalculation,
  type LocalPrivateReviewedPlayerIdentityEvidence,
  type LocalPrivateReviewedSelectionLineageEvidence,
  type LocalPrivateReviewedTradeCalculation,
} from './localPrivateReviewedTradeCalculation';
import { parseLocalWorkbookPlayerIdentityReview } from './localWorkbookPlayerIdentityReview';
import { PostgresLocalWorkbookPickSelectionConfirmationRepository } from './postgresLocalWorkbookPickSelectionConfirmationRepository';
import { loadLocalAflTradeStagedWorkbookOutcomes } from './localStagedWorkbookOutcomeProjection';

interface IdentityRow {
  asset_id: string;
  canonical_player_id: string;
  decision_json: unknown;
  identity_decision_ids: string[];
  reviewed_season_ids: string[];
}

interface CalculationRow {
  calculation_json: unknown;
}

function transactionClient(transaction: AflOutcomeSqlTransaction): AflOutcomeSqlClient {
  return {
    query: transaction.query.bind(transaction),
    transaction: async (work) => work(transaction),
  };
}

function acquisitionInputs(
  detail: DraftTradeDetail,
  identities: readonly LocalPrivateReviewedPlayerIdentityEvidence[]
): AflOutcomesDevelopmentAcquisitionItem[] {
  return detail.assets.flatMap<AflOutcomesDevelopmentAcquisitionItem>((asset) => {
    if (asset.assetType === 'player' && asset.playerName) {
      return [
          {
            eventId: asset.id,
            year: asset.year,
            category: 'trade' as const,
            acquisitionType: 'Trade',
            signing: null,
            pick: null,
            draftNumber: null,
            clubName: asset.clubName,
            playerName:
              identities.find(
                ({ sourcePlayerName }) => sourcePlayerName === asset.playerName
              )?.recordedName ?? asset.playerName,
            age: null,
            heightCm: null,
            weightKg: null,
            originalClub: null,
            grade: null,
            games: null,
            goals: null,
            coachesVotes: null,
            brownlowVotes: null,
            awards: null,
          },
        ];
    }
    // A traded pick asset is not the selected player's later draft-acquisition asset. Until the
    // governed pick-lineage and draft-selection tables resolve that distinct start event/asset,
    // no acquisition-spell outcome may be requested for a pick.
    return [];
  });
}

async function loadIdentityEvidence(
  transaction: AflOutcomeSqlTransaction,
  detail: DraftTradeDetail,
  workbookSha256: string
): Promise<LocalPrivateReviewedPlayerIdentityEvidence[]> {
  const requestedAssets = detail.assets.filter(
    ({ assetType, playerName }) => assetType === 'player' && playerName !== null
  );
  if (requestedAssets.length === 0) return [];
  const assetById = new Map(requestedAssets.map((asset) => [asset.id, asset]));
  const result = await transaction.query<IdentityRow>(
    `SELECT review.asset_id,review.canonical_player_id,review.decision_json,
            array_agg(DISTINCT member.member_json->'playerIdentity'->>'identityDecisionId'
                      ORDER BY member.member_json->'playerIdentity'->>'identityDecisionId')
              AS identity_decision_ids,
            array_agg(DISTINCT member.reviewed_season_id ORDER BY member.reviewed_season_id)
              AS reviewed_season_ids
       FROM outcome_local_workbook_player_identity_review review
       JOIN outcome_hpn_reviewed_season_member member
         ON member.identity_state='resolved'
        AND member.canonical_player_id=review.canonical_player_id
       JOIN outcome_hpn_reviewed_season_universe season
         ON season.reviewed_season_id=member.reviewed_season_id
       JOIN outcome_private_reviewed_evidence_bundle bundle
         ON bundle.evidence_bundle_id=review.evidence_bundle_id
      WHERE review.workbook_sha256=$1
        AND review.trade_id=$2
        AND review.asset_id=ANY($3::text[])
        AND season.candidate_json->'content'->>'resolvedReviewSetSha256'
              IN (SELECT item->>'reviewSetId'
                    FROM jsonb_array_elements(
                      bundle.bundle_json->'content'->'reviewSets'
                    ) review_set(item))
        AND outcome_private_reviewed_evidence_bundle_is_current(review.evidence_bundle_id)
        AND EXISTS (
          SELECT 1
            FROM outcome_private_reviewed_evaluation_head head
            JOIN outcome_private_reviewed_evaluation_decision decision
              ON decision.decision_id=head.decision_id
           WHERE head.evidence_bundle_id=review.evidence_bundle_id
             AND head.evidence_scope_key='afl-player-match-reviewed-2021-2026'
             AND head.status='authorized'
             AND decision.decision_json->'content'->>'status'='authorized'
             AND decision.decision_json->'content'->>'schemaVersion'
                   ='afl-trade-private-reviewed-evidence-evaluation-decision/v1'
             AND decision.decision_json->'content'->>'authorityBoundary'
                   ='exact_current_private_review_sets_and_retained_source_artifacts_for_internal_nonproduction_calculation_only'
             AND decision.decision_json->'content'->'permissions'->>'internalEvaluation'='true'
             AND decision.decision_json->'content'->'permissions'->>'derivedCalculations'='true'
             AND decision.decision_json->'content'->'publicationProhibited'='true'::jsonb
        )
      GROUP BY review.asset_id,review.canonical_player_id,review.decision_json
      ORDER BY review.asset_id`,
    [workbookSha256, detail.trade.tradeId, requestedAssets.map(({ id }) => id)]
  );
  return result.rows.map((row) => {
    const review = parseLocalWorkbookPlayerIdentityReview(row.decision_json);
    const asset = assetById.get(row.asset_id);
    if (
      !asset?.playerName ||
      review.content.workbookSha256 !== workbookSha256 ||
      review.content.tradeId !== detail.trade.tradeId ||
      review.content.assetId !== asset.id ||
      review.content.sourcePlayerName !== asset.playerName ||
      review.content.sourceAssetText !== asset.assetText ||
      review.content.receivingClubName !== asset.clubName ||
      review.content.canonicalPlayerId !== row.canonical_player_id
    ) {
      throw new Error('The local workbook player identity review no longer matches its asset.');
    }
    return {
      sourcePlayerName: asset.playerName,
      recordedName: review.content.recordedName,
      canonicalPlayerId: row.canonical_player_id,
      identityDecisionIds: row.identity_decision_ids,
      reviewedSeasonIds: row.reviewed_season_ids,
    };
  });
}

async function loadSelectionEvidence(
  transaction: AflOutcomeSqlTransaction,
  detail: DraftTradeDetail,
  workbookSha256: string
): Promise<LocalPrivateReviewedSelectionLineageEvidence[]> {
  const requestedAssets = detail.assets.filter(
    ({ assetType }) => assetType === 'pick' || assetType === 'future_pick'
  );
  const confirmations = await new PostgresLocalWorkbookPickSelectionConfirmationRepository(
    transactionClient(transaction)
  ).loadForTrade(
    workbookSha256,
    `afl-men:${detail.trade.year}-trades`,
    detail.trade.tradeId,
    requestedAssets.map(({ id }) => id)
  );
  const assetById = new Map(requestedAssets.map((asset) => [asset.id, asset]));
  return confirmations.map((confirmation) => {
    const content = confirmation.content;
    const asset = assetById.get(content.assetId);
    const expectedDraftYear = asset?.assetType === 'future_pick' ? asset.pick.year : asset?.year;
    if (
      !asset ||
      content.assetKind !== asset.assetType ||
      content.sourceAssetText !== asset.assetText ||
      content.receivingClubName !== asset.clubName ||
      content.tradeYear !== asset.year ||
      content.draftYear !== expectedDraftYear ||
      content.selectionNumber !== asset.pick.numberActual ||
      content.draftedPlayerName !== asset.draftedPlayer
    ) {
      throw new Error(
        'The local workbook pick-selection confirmation no longer matches its asset.'
      );
    }
    return {
      assetId: content.assetId,
      draftYear: content.draftYear,
      selectionNumber: content.selectionNumber,
      draftedPlayerName: content.draftedPlayerName,
      recordedName: content.recordedName,
      canonicalPlayerId: content.canonicalPlayerId,
      selectionDecisionId: confirmation.confirmationId,
      identityDecisionIds: content.identityDecisionIds,
      reviewedSeasonIds: content.reviewedSeasonIds,
    };
  });
}

export async function loadPostgresLocalPrivateReviewedTradeCalculation(
  client: AflOutcomeSqlClient,
  input: Readonly<{
    detail: DraftTradeDetail;
    workbookSha256: string;
  }>
): Promise<LocalPrivateReviewedTradeCalculation> {
  return client.transaction(async (transaction) => {
    const identities = await loadIdentityEvidence(
      transaction,
      input.detail,
      input.workbookSha256
    );
    const selections = await loadSelectionEvidence(
      transaction,
      input.detail,
      input.workbookSha256
    );
    const outcomesByAssetId = await loadLocalAflTradeStagedWorkbookOutcomes(
      transactionClient(transaction),
      acquisitionInputs(input.detail, identities)
    );
    const calculationRows = await transaction.query<CalculationRow>(
      `SELECT calculation_json
         FROM outcome_private_reviewed_hpn_calculation
        ORDER BY season_year,calculation_id`
    );
    return projectLocalPrivateReviewedTradeCalculation({
      detail: input.detail,
      workbookSha256: input.workbookSha256,
      identities,
      selections,
      calculations: calculationRows.rows.map(({ calculation_json }) => calculation_json),
      outcomesByAssetId,
    });
  });
}
