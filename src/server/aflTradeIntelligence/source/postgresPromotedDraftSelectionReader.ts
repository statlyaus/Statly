import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import type { AflTradePromotedDraftSelectionReader } from './externalHistoricalReconciliationPreparation';

/**
 * What is already current canonical (statlyaus/Statly#869): source selection ids whose selection row
 * is approved under the current version of a draft event (migration 0265, asset-scoped since 0266),
 * and source transaction ids whose trade event is current under the same stable key from a finalized
 * promotion, each with the source transfer ids promoted as assets on that version (migration 0267).
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
  ): Promise<readonly { transactionId: string; transferIds: readonly string[] }[]> {
    const result = await this.client.query<{ transaction_id: string; transfer_ids: string[] }>(
      'SELECT transaction_id,transfer_ids FROM outcome_current_canonical_transactions($1) ORDER BY transaction_id',
      [competition]
    );
    return result.rows.map(({ transaction_id, transfer_ids }) => ({
      transactionId: transaction_id,
      transferIds: [...transfer_ids].sort(),
    }));
  }
}
