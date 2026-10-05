import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  parseLocalWorkbookPickSelectionConfirmation,
  type LocalWorkbookPickSelectionConfirmation,
} from './localWorkbookPickSelectionConfirmation';

interface PickSelectionConfirmationRow {
  confirmation_json: unknown;
}

export class PostgresLocalWorkbookPickSelectionConfirmationRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async register(
    unparsedConfirmation: LocalWorkbookPickSelectionConfirmation
  ): Promise<LocalWorkbookPickSelectionConfirmation> {
    const confirmation = parseLocalWorkbookPickSelectionConfirmation(unparsedConfirmation);
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `local-workbook-pick-selection-confirmation:${confirmation.content.workbookSha256}:${confirmation.content.assetId}`,
      ]);
      await transaction.query(
        `INSERT INTO outcome_local_workbook_pick_selection_confirmation
          (confirmation_id,workbook_sha256,valuation_scope_key,trade_id,asset_id,asset_kind,
           source_asset_text,receiving_club_name,trade_year,draft_year,selection_number,
           drafted_player_name,canonical_player_id,recorded_name,evidence_bundle_id,
           identity_decision_ids,reviewed_season_ids,reviewer_id,reviewed_at,
           confirmation_content_sha256,confirmation_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18,$19,$20,$21::jsonb)
         ON CONFLICT (workbook_sha256,asset_id) DO NOTHING`,
        [
          confirmation.confirmationId,
          confirmation.content.workbookSha256,
          confirmation.content.valuationScopeKey,
          confirmation.content.tradeId,
          confirmation.content.assetId,
          confirmation.content.assetKind,
          confirmation.content.sourceAssetText,
          confirmation.content.receivingClubName,
          confirmation.content.tradeYear,
          confirmation.content.draftYear,
          confirmation.content.selectionNumber,
          confirmation.content.draftedPlayerName,
          confirmation.content.canonicalPlayerId,
          confirmation.content.recordedName,
          confirmation.content.evidenceBundleId,
          JSON.stringify(confirmation.content.identityDecisionIds),
          JSON.stringify(confirmation.content.reviewedSeasonIds),
          confirmation.content.reviewerId,
          confirmation.content.reviewedAt,
          confirmation.confirmationId.slice(
            'local-workbook-pick-selection-confirmation:'.length
          ),
          JSON.stringify(confirmation),
        ]
      );
      const retained = await transaction.query<PickSelectionConfirmationRow>(
        `SELECT confirmation_json
           FROM outcome_local_workbook_pick_selection_confirmation
          WHERE workbook_sha256=$1 AND asset_id=$2
          FOR SHARE`,
        [confirmation.content.workbookSha256, confirmation.content.assetId]
      );
      const authenticated = parseLocalWorkbookPickSelectionConfirmation(
        retained.rows[0]?.confirmation_json
      );
      if (canonicalizeAflTradeJson(authenticated) !== canonicalizeAflTradeJson(confirmation)) {
        throw new Error('The retained local workbook pick-selection confirmation conflicts.');
      }
      return authenticated;
    });
  }

  async loadForTrade(
    workbookSha256: string,
    valuationScopeKey: string,
    tradeId: string,
    assetIds: readonly string[]
  ): Promise<LocalWorkbookPickSelectionConfirmation[]> {
    if (!/^[a-f0-9]{64}$/u.test(workbookSha256)) {
      throw new TypeError('Pick-selection confirmation requires the pinned workbook digest.');
    }
    const requestedAssetIds = [...new Set(assetIds)].sort();
    if (requestedAssetIds.length === 0) return [];
    const result = await this.client.query<PickSelectionConfirmationRow>(
      `SELECT confirmation.confirmation_json
         FROM outcome_local_workbook_pick_selection_confirmation confirmation
        WHERE confirmation.workbook_sha256=$1
          AND confirmation.valuation_scope_key=$2
          AND confirmation.trade_id=$3
          AND confirmation.asset_id=ANY($4::text[])
          AND outcome_private_reviewed_evidence_bundle_is_current(confirmation.evidence_bundle_id)
          AND EXISTS (
            SELECT 1
              FROM outcome_private_reviewed_evaluation_head head
              JOIN outcome_private_reviewed_evaluation_decision decision
                ON decision.decision_id=head.decision_id
             WHERE head.evidence_bundle_id=confirmation.evidence_bundle_id
               AND head.evidence_scope_key='afl-player-match-reviewed-2021-2026'
               AND head.valuation_scope_key=$2
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
        ORDER BY confirmation.asset_id`,
      [workbookSha256, valuationScopeKey, tradeId, requestedAssetIds]
    );
    const requested = new Set(requestedAssetIds);
    const confirmations = result.rows.map(({ confirmation_json }) =>
      parseLocalWorkbookPickSelectionConfirmation(confirmation_json)
    );
    if (
      new Set(confirmations.map(({ content }) => content.assetId)).size !==
        confirmations.length ||
      confirmations.some(
        ({ content }) =>
          content.workbookSha256 !== workbookSha256 ||
          content.valuationScopeKey !== valuationScopeKey ||
          content.tradeId !== tradeId ||
          !requested.has(content.assetId)
      )
    ) {
      throw new Error('Pick-selection confirmation escaped the requested workbook trade assets.');
    }
    return confirmations;
  }
}
