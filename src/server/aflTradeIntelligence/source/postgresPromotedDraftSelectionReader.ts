import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import type { AflTradePromotedDraftSelectionReader } from './externalHistoricalReconciliationPreparation';
import type {
  AflTradeCurrentCanonicalPickCustody,
  AflTradeCurrentCanonicalTransaction,
} from './pickLineageDeferral';

/**
 * What is already current canonical (statlyaus/Statly#869, #853): source selection ids whose
 * selection row is approved under the current version of a draft event (migration 0265,
 * asset-scoped since 0266); source transaction ids whose trade event is current under the same
 * stable key from a finalized promotion, each with the source transfer ids promoted as assets on that
 * version (migration 0267), the pick id of each such asset that names one (migration 0274) and the
 * player id of each that names one (migration 0275); and custody observations canonical under a
 * finalized promotion, with their facts (migration 0274).
 * The same SQL functions back the candidate insert guards and the promoter's re-checks, so what
 * preparation records is what the database later demands.
 */
export class PostgresAflTradePromotedDraftSelectionReader implements AflTradePromotedDraftSelectionReader {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async loadCurrentCanonicalSelectionIds(competition: string): Promise<readonly string[]> {
    const result = await this.client.query<{ selection_id: string }>(
      'SELECT selection_id FROM outcome_current_canonical_draft_selection_ids($1) ORDER BY selection_id',
      [competition]
    );
    return result.rows.map(({ selection_id }) => selection_id);
  }

  async loadCurrentCanonicalTransactions(
    competition: string
  ): Promise<readonly AflTradeCurrentCanonicalTransaction[]> {
    const result = await this.client.query<{ transaction_id: string; transfer_ids: string[] }>(
      'SELECT transaction_id,transfer_ids FROM outcome_current_canonical_transactions($1) ORDER BY transaction_id',
      [competition]
    );
    const picks = await this.client.query<{
      transaction_id: string;
      transfer_id: string;
      pick_id: string;
    }>(
      `SELECT transaction_id,transfer_id,pick_id FROM outcome_current_canonical_transaction_picks($1)
        ORDER BY transaction_id,transfer_id`,
      [competition]
    );
    const picksByTransaction = new Map<string, { transferId: string; pickId: string }[]>();
    for (const { transaction_id, transfer_id, pick_id } of picks.rows) {
      const listed = picksByTransaction.get(transaction_id) ?? [];
      listed.push({ transferId: transfer_id, pickId: pick_id });
      picksByTransaction.set(transaction_id, listed);
    }
    const players = await this.client.query<{
      transaction_id: string;
      transfer_id: string;
      player_id: string;
    }>(
      `SELECT transaction_id,transfer_id,player_id FROM outcome_current_canonical_transaction_players($1)
        ORDER BY transaction_id,transfer_id`,
      [competition]
    );
    const playersByTransaction = new Map<string, { transferId: string; playerId: string }[]>();
    for (const { transaction_id, transfer_id, player_id } of players.rows) {
      const listed = playersByTransaction.get(transaction_id) ?? [];
      listed.push({ transferId: transfer_id, playerId: player_id });
      playersByTransaction.set(transaction_id, listed);
    }
    const reviewed = await this.client.query<{ transaction_id: string }>(
      'SELECT transaction_id FROM outcome_current_canonical_reviewed_lineage_transactions($1)',
      [competition]
    );
    const reviewedIds = new Set(reviewed.rows.map(({ transaction_id }) => transaction_id));
    return result.rows.map(({ transaction_id, transfer_ids }) => ({
      transactionId: transaction_id,
      transferIds: [...transfer_ids].sort(),
      transferPickIds: picksByTransaction.get(transaction_id) ?? [],
      transferPlayerIds: playersByTransaction.get(transaction_id) ?? [],
      reviewedLineage: reviewedIds.has(transaction_id),
    }));
  }

  async loadCurrentCanonicalPickCustody(
    competition: string
  ): Promise<readonly AflTradeCurrentCanonicalPickCustody[]> {
    const result = await this.client.query<{
      custody_id: string;
      pick_id: string;
      observed_at: string | null;
      observed_date: Record<string, string | number> | null;
      draft_season_year: number;
      draft_kind: string;
      recorded_round: number | null;
      recorded_pick: number | null;
      original_club_id: string | null;
      current_club_id: string;
      predecessor_custody_id: string | null;
    }>(
      `SELECT custody_id,pick_id,
              to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at,
              observed_date,draft_season_year,draft_kind,recorded_round,recorded_pick,
              original_club_id,current_club_id,predecessor_custody_id
         FROM outcome_current_canonical_pick_custody($1) ORDER BY custody_id`,
      [competition]
    );
    return result.rows.map((row) => ({
      custodyId: row.custody_id,
      pickId: row.pick_id,
      observedAt: row.observed_at,
      observedDate: row.observed_date,
      draftSeasonYear: row.draft_season_year,
      draftKind: row.draft_kind,
      recordedRound: row.recorded_round,
      recordedPick: row.recorded_pick,
      originalClubId: row.original_club_id,
      currentClubId: row.current_club_id,
      predecessorCustodyId: row.predecessor_custody_id,
    }));
  }
}
