import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import type { AflTradePromotedDraftSelectionReader } from './externalHistoricalReconciliationPreparation';

/**
 * Source selection ids that are current canonical selections (statlyaus/Statly#869): a draft
 * selection member of a finalized promotion whose selection row is approved under the current
 * version of a draft event of the competition. The same SQL function (migration 0265) backs the
 * candidate insert trigger and the promoter's re-check, so what preparation records is what the
 * database later demands.
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
}
