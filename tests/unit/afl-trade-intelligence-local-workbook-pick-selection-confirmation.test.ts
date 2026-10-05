import { describe, expect, it } from 'vitest';

import {
  createLocalWorkbookPickSelectionConfirmation,
  parseLocalWorkbookPickSelectionConfirmation,
} from '@/server/aflTradeIntelligence/development/localWorkbookPickSelectionConfirmation';

const input = {
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
  canonicalPlayerId: 'local-afl-player:afl-tables:12345',
  recordedName: 'Player Pickett',
  evidenceBundleId: `private-reviewed-evidence-bundle:${'2'.repeat(64)}`,
  identityDecisionIds: [`identity-review:${'3'.repeat(64)}`],
  reviewedSeasonIds: [`hpn-reviewed-season:${'4'.repeat(64)}`],
  reviewerId: 'local-workbook-pick-selection-confirmer',
  rationale:
    'Approved the exact private workbook selection and selected-player identity after local factual review.',
  reviewedAt: '2026-08-17T02:00:00.000Z',
} as const;

describe('local workbook pick-selection confirmation', () => {
  it('content-addresses exact private-only selection confirmation without granting numerical authority', () => {
    const confirmation = createLocalWorkbookPickSelectionConfirmation(input);

    expect(confirmation.confirmationId).toMatch(
      /^local-workbook-pick-selection-confirmation:[a-f0-9]{64}$/
    );
    expect(confirmation.content).toMatchObject({
      ...input,
      authority: 'private_local_workbook_pick_selection_confirmation',
      numericalAuthority: 'none',
      publicationEligible: false,
      publicationProhibited: true,
    });
    expect(parseLocalWorkbookPickSelectionConfirmation(confirmation)).toEqual(confirmation);
  });

  it('rejects changed selection, player, evidence membership, or publication authority', () => {
    const confirmation = createLocalWorkbookPickSelectionConfirmation(input);
    for (const content of [
      { ...confirmation.content, selectionNumber: 13 },
      { ...confirmation.content, canonicalPlayerId: 'local-afl-player:other' },
      { ...confirmation.content, identityDecisionIds: [] },
      { ...confirmation.content, publicationEligible: true },
    ]) {
      expect(() =>
        parseLocalWorkbookPickSelectionConfirmation({ ...confirmation, content })
      ).toThrow(/failed exact authentication/i);
    }
  });
});
