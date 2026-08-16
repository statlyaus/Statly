import type { DraftTradeDetail } from '@/lib/draftTrades/read';

import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import type { AflOutcomesDevelopmentAcquisitionItem } from '../source/developmentWorkbookAcquisitionProjection';
import {
  projectLocalPrivateReviewedTradeCalculation,
  type LocalPrivateReviewedPlayerIdentityEvidence,
  type LocalPrivateReviewedTradeCalculation,
} from './localPrivateReviewedTradeCalculation';
import { loadLocalAflTradeStagedWorkbookOutcomes } from './localStagedWorkbookOutcomeProjection';

interface IdentityRow {
  recorded_name: string;
  canonical_player_id: string;
  identity_decision_ids: string[];
  reviewed_season_ids: string[];
}

interface CalculationRow {
  calculation_json: unknown;
}

function normalizeName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-AU');
}

function transactionClient(transaction: AflOutcomeSqlTransaction): AflOutcomeSqlClient {
  return {
    query: transaction.query.bind(transaction),
    transaction: async (work) => work(transaction),
  };
}

function acquisitionInputs(detail: DraftTradeDetail): AflOutcomesDevelopmentAcquisitionItem[] {
  return detail.assets.flatMap((asset) =>
    asset.assetType === 'player' && asset.playerName
      ? [
          {
            eventId: asset.id,
            year: asset.year,
            category: 'trade' as const,
            acquisitionType: 'Trade',
            signing: null,
            pick: null,
            draftNumber: null,
            clubName: asset.clubName,
            playerName: asset.playerName,
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
        ]
      : []
  );
}

async function loadIdentityEvidence(
  transaction: AflOutcomeSqlTransaction,
  detail: DraftTradeDetail
): Promise<LocalPrivateReviewedPlayerIdentityEvidence[]> {
  const requestedNames = [
    ...new Set(
      detail.assets
        .filter(({ assetType, playerName }) => assetType === 'player' && playerName !== null)
        .map(({ playerName }) => normalizeName(playerName!))
    ),
  ];
  if (requestedNames.length === 0) return [];
  const result = await transaction.query<IdentityRow>(
    `SELECT candidate.recorded_name,member.canonical_player_id,
            array_agg(DISTINCT member.member_json->'playerIdentity'->>'identityDecisionId'
                      ORDER BY member.member_json->'playerIdentity'->>'identityDecisionId')
              AS identity_decision_ids,
            array_agg(DISTINCT member.reviewed_season_id ORDER BY member.reviewed_season_id)
              AS reviewed_season_ids
       FROM outcome_hpn_reviewed_season_member member
       JOIN outcome_provider_identity_candidate candidate
         ON candidate.provider_decoded_row_id=member.provider_decoded_row_id
      WHERE member.identity_state='resolved'
        AND lower(regexp_replace(btrim(candidate.recorded_name),'\\s+',' ','g'))=ANY($1::text[])
      GROUP BY candidate.recorded_name,member.canonical_player_id
      ORDER BY candidate.recorded_name,member.canonical_player_id`,
    [requestedNames]
  );
  return result.rows.map((row) => ({
    recordedName: row.recorded_name,
    canonicalPlayerId: row.canonical_player_id,
    identityDecisionIds: row.identity_decision_ids,
    reviewedSeasonIds: row.reviewed_season_ids,
  }));
}

export async function loadPostgresLocalPrivateReviewedTradeCalculation(
  client: AflOutcomeSqlClient,
  input: Readonly<{
    detail: DraftTradeDetail;
    workbookSha256: string;
  }>
): Promise<LocalPrivateReviewedTradeCalculation> {
  return client.transaction(async (transaction) => {
    const identities = await loadIdentityEvidence(transaction, input.detail);
    const outcomesByAssetId = await loadLocalAflTradeStagedWorkbookOutcomes(
      transactionClient(transaction),
      acquisitionInputs(input.detail)
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
      calculations: calculationRows.rows.map(({ calculation_json }) => calculation_json),
      outcomesByAssetId,
    });
  });
}
