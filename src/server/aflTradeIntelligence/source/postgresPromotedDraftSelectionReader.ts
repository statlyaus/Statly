import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import type { AflTradePromotedDraftSelectionReader } from './externalHistoricalReconciliationPreparation';
import type {
  AflTradeCurrentCanonicalDraftSelection,
  AflTradeCurrentCanonicalPickCustody,
  AflTradeCurrentCanonicalTransaction,
  AflTradePromotedSelectionPickState,
} from './pickLineageDeferral';

/**
 * What is already current canonical (statlyaus/Statly#869, #853): source selection ids whose
 * selection row is approved under the current version of a draft event (migration 0265,
 * asset-scoped since 0266), each with its selection number and player (migration 0278); source transaction ids whose trade event is current under the same
 * stable key from a finalized promotion, each with the source transfer ids promoted as assets on that
 * version (migration 0267), the pick id of each such asset that names one (migration 0274) and the
 * player id of each that names one (migration 0277); and custody observations canonical under a
 * finalized promotion, with their facts (migration 0274).
 * The same SQL functions back the candidate insert guards and the promoter's re-checks, so what
 * preparation records is what the database later demands.
 */
export class PostgresAflTradePromotedDraftSelectionReader implements AflTradePromotedDraftSelectionReader {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async loadCurrentCanonicalSelections(
    competition: string
  ): Promise<readonly AflTradeCurrentCanonicalDraftSelection[]> {
    const result = await this.client.query<{
      selection_id: string;
      selection_number: number;
      player_id: string;
    }>(
      // One row per current canonical selection row, so a source selection current under two
      // roots shows twice and is never re-synced into one of them by guess.
      `SELECT selection_id,selection_number,player_id
         FROM outcome_current_canonical_draft_selection_players($1)
        WHERE player_id IS NOT NULL
        ORDER BY selection_id,event_version_id`,
      [competition]
    );
    return result.rows.map((row) => ({
      selectionId: row.selection_id,
      selectionNumber: Number(row.selection_number),
      playerId: row.player_id,
    }));
  }

  /**
   * Each current canonical selection row with its stored pick, club, root and version, and whether a
   * special-entitlement exercise or selection claim cites it (migration 0284), a row with no player
   * included: rule 4 must see every current holder of a pick, as the 0284 guard does; and every recorded
   * selection and player asset on every version of the roots those rows sit on, with whether it is
   * current under asset-scoped supersession (0256), as the promoter's additive check reads them.
   */
  async loadCurrentCanonicalSelectionPicks(
    competition: string
  ): Promise<AflTradePromotedSelectionPickState> {
    const selections = await this.client.query<{
      selection_id: string;
      selection_number: number;
      player_id: string | null;
      pick_id: string | null;
      club_id: string;
      event_id: string;
      event_version_id: string;
      special_entitlement_cited: boolean;
    }>(
      `SELECT current.selection_id,current.selection_number,current.player_id,current.pick_id,
              current.club_id,current.event_id,current.event_version_id,
              (EXISTS (SELECT 1 FROM outcome_special_entitlement_lifecycle lifecycle
                        WHERE lifecycle.selection_id=current.canonical_selection_id)
               OR EXISTS (SELECT 1 FROM outcome_special_entitlement_selection_claim claim
                           WHERE claim.selection_id=current.canonical_selection_id))
                AS special_entitlement_cited
         FROM outcome_current_canonical_draft_selection_picks($1) current
        ORDER BY current.selection_id,current.event_version_id`,
      [competition]
    );
    const eventIds = [...new Set(selections.rows.map(({ event_id }) => event_id))].sort();
    const slots = await this.client.query<{
      event_id: string;
      event_version_id: string;
      kind: 'selection' | 'asset';
      selection_number: number | null;
      player_id: string | null;
      current: boolean;
    }>(
      `SELECT version.event_id,version.event_version_id,'selection' AS kind,
              selection.selection_number,selection.player_id,
              NOT outcome_event_version_superseded_for(
                version.event_version_id,selection.player_id,selection.selection_number) AS current
         FROM outcome_event_version version
         JOIN outcome_draft_selection selection ON selection.event_version_id=version.event_version_id
        WHERE version.event_id=ANY($1::text[])
       UNION ALL
       SELECT version.event_id,version.event_version_id,'asset',NULL,asset.player_id,
              NOT outcome_event_version_superseded_for(version.event_version_id,asset.player_id,NULL)
         FROM outcome_event_version version
         JOIN outcome_event_asset asset ON asset.event_version_id=version.event_version_id
        WHERE version.event_id=ANY($1::text[]) AND asset.player_id IS NOT NULL
        ORDER BY 1,2,3,4,5`,
      [eventIds]
    );
    return {
      selections: selections.rows.map((row) => ({
        selectionId: row.selection_id,
        selectionNumber: Number(row.selection_number),
        playerId: row.player_id,
        pickId: row.pick_id,
        clubId: row.club_id,
        eventId: row.event_id,
        eventVersionId: row.event_version_id,
        specialEntitlementCited: row.special_entitlement_cited,
      })),
      rootSlots: slots.rows.map((row) => ({
        eventId: row.event_id,
        eventVersionId: row.event_version_id,
        kind: row.kind,
        selectionNumber: row.selection_number === null ? null : Number(row.selection_number),
        playerId: row.player_id,
        current: row.current,
      })),
    };
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
