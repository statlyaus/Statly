import {
  createLocalWorkbookPickSelectionConfirmation,
  type LocalWorkbookPickSelectionConfirmation,
} from '@/server/aflTradeIntelligence/development/localWorkbookPickSelectionConfirmation';
import { PostgresLocalWorkbookPickSelectionConfirmationRepository } from '@/server/aflTradeIntelligence/development/postgresLocalWorkbookPickSelectionConfirmationRepository';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const confirmation = createLocalWorkbookPickSelectionConfirmation({
  workbookSha256: '1'.repeat(64),
  valuationScopeKey: 'afl-men:2024-trades',
  tradeId: 'workbook-2024-example',
  assetId: 'workbook-2024-example-club-a-1',
  assetKind: 'pick',
  sourceAssetText: '#7 (#12 - Pickett - 0 games)',
  receivingClubName: 'Gold Coast',
  tradeYear: 2024,
  draftYear: 2024,
  selectionNumber: 12,
  draftedPlayerName: 'Pickett',
  canonicalPlayerId: 'local-afl-player:100',
  recordedName: 'Player Pickett',
  evidenceBundleId: `private-reviewed-evidence-bundle:${'2'.repeat(64)}`,
  identityDecisionIds: ['identity-review:100'],
  reviewedSeasonIds: [`hpn-reviewed-season:${'3'.repeat(64)}`],
  reviewerId: 'local-workbook-pick-selection-confirmer',
  rationale: 'Approved exact local workbook selection lineage.',
  reviewedAt: '2026-08-17T02:00:00.000Z',
});

function clientWithRows(rows: unknown[]): AflOutcomeSqlClient {
  const query = vi.fn(async () => ({ rows, rowCount: rows.length })) as AflOutcomeSqlClient['query'];
  return {
    query,
    transaction: async (work) => work({ query }),
  };
}

describe('PostgreSQL local workbook pick-selection confirmation repository', () => {
  it('loads only exact current confirmations for the requested workbook trade assets', async () => {
    const repository = new PostgresLocalWorkbookPickSelectionConfirmationRepository(
      clientWithRows([{ confirmation_json: confirmation }])
    );

    await expect(
      repository.loadForTrade(
        confirmation.content.workbookSha256,
        confirmation.content.valuationScopeKey,
        confirmation.content.tradeId,
        [confirmation.content.assetId]
      )
    ).resolves.toEqual([confirmation]);
  });

  it('rejects a row whose authenticated content escapes the requested scope', async () => {
    const changed = {
      ...confirmation,
      content: { ...confirmation.content, tradeId: 'workbook-2024-other' },
    } as LocalWorkbookPickSelectionConfirmation;
    const repository = new PostgresLocalWorkbookPickSelectionConfirmationRepository(
      clientWithRows([{ confirmation_json: changed }])
    );

    await expect(
      repository.loadForTrade(
        confirmation.content.workbookSha256,
        confirmation.content.valuationScopeKey,
        confirmation.content.tradeId,
        [confirmation.content.assetId]
      )
    ).rejects.toThrow(/exact authentication|requested workbook trade assets/i);
  });

  it('registers create-if-absent and authenticates the exact retained decision', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ confirmation_json: confirmation }], rowCount: 1 });
    const client: AflOutcomeSqlClient = {
      query,
      transaction: async (work) => work({ query }),
    };
    const repository = new PostgresLocalWorkbookPickSelectionConfirmationRepository(client);

    await expect(repository.register(confirmation)).resolves.toEqual(confirmation);
  });
});
