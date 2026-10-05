import type { DraftTradeAssetItem } from '@/lib/draftTrades/read';
import { resolveLocalWorkbookPickSelectionConfirmation } from '@/server/aflTradeIntelligence/development/localWorkbookPickSelectionConfirmationResolution';

const asset: DraftTradeAssetItem = {
  id: 'workbook-2024-example-gold-coast-1',
  tradeId: 'workbook-2024-example',
  year: 2024,
  clubSlug: 'gold-coast',
  clubName: 'Gold Coast',
  assetIndex: 1,
  assetType: 'pick',
  assetText: '#7 (#12 - Pickett - 0 games)',
  playerName: null,
  pick: {
    code: '7',
    numberGiven: 7,
    year: null,
    round: null,
    originalClub: null,
    numberActual: 12,
  },
  draftedPlayer: 'Pickett',
  games: 0,
  note: null,
};

const candidate = {
  canonicalPlayerId: 'local-afl-player:100',
  recordedName: 'Player Pickett',
  identityDecisionIds: ['identity-review:100'],
  reviewedSeasonIds: [`hpn-reviewed-season:${'1'.repeat(64)}`],
};

function resolve(
  overrides: Partial<
    Parameters<typeof resolveLocalWorkbookPickSelectionConfirmation>[0]
  > = {}
) {
  return resolveLocalWorkbookPickSelectionConfirmation({
    asset,
    workbookSha256: '2'.repeat(64),
    valuationScopeKey: 'afl-men:2024-trades',
    evidenceBundleId: `private-reviewed-evidence-bundle:${'3'.repeat(64)}`,
    candidates: [candidate],
    reviewerId: 'local-workbook-pick-selection-confirmer',
    rationale: 'Approved exact local workbook selection lineage.',
    reviewedAt: '2026-08-17T02:00:00.000Z',
    ...overrides,
  });
}

describe('local workbook pick-selection confirmation resolution', () => {
  it('resolves a unique surname label to exact reviewed selected-player evidence', () => {
    const resolution = resolve({ confirmedCanonicalPlayerId: candidate.canonicalPlayerId });

    expect(resolution).toMatchObject({
      state: 'reviewable',
      confirmation: {
        content: {
          tradeId: asset.tradeId,
          assetId: asset.id,
          assetKind: 'pick',
          tradeYear: 2024,
          draftYear: 2024,
          selectionNumber: 12,
          draftedPlayerName: 'Pickett',
          canonicalPlayerId: candidate.canonicalPlayerId,
          numericalAuthority: 'none',
          publicationProhibited: true,
        },
      },
    });
  });

  it('separates a future-pick entitlement year from its recorded settlement year', () => {
    const futurePick: DraftTradeAssetItem = {
      ...asset,
      id: 'workbook-2021-example-hawthorn-1',
      tradeId: 'workbook-2021-example',
      year: 2021,
      assetType: 'future_pick',
      assetText: '#2022R1 (Melbourne) (#18 - Weddle - 60 games)',
      pick: {
        code: '2022R1',
        numberGiven: null,
        year: 2022,
        round: 1,
        originalClub: 'Melbourne',
        numberActual: 18,
      },
      draftedPlayer: 'Weddle',
      games: 60,
    };

    const resolution = resolve({
      asset: futurePick,
      valuationScopeKey: 'afl-men:2021-trades',
      candidates: [{ ...candidate, recordedName: 'Josh Weddle' }],
      confirmedCanonicalPlayerId: candidate.canonicalPlayerId,
    });

    expect(resolution).toMatchObject({
      state: 'reviewable',
      confirmation: {
        content: {
          assetKind: 'future_pick',
          tradeYear: 2021,
          draftYear: 2022,
          selectionNumber: 18,
          draftedPlayerName: 'Weddle',
          numericalAuthority: 'none',
          publicationProhibited: true,
        },
      },
    });
  });

  it('retains one exact recorded-name evidence set when one player has reviewed aliases', () => {
    const moreCompleteAlias = {
      ...candidate,
      recordedName: 'P. Pickett',
      identityDecisionIds: ['identity-review:alias'],
      reviewedSeasonIds: [
        `hpn-reviewed-season:${'4'.repeat(64)}`,
        `hpn-reviewed-season:${'5'.repeat(64)}`,
      ],
    };

    const resolution = resolve({
      candidates: [candidate, moreCompleteAlias],
      confirmedCanonicalPlayerId: candidate.canonicalPlayerId,
    });

    expect(resolution).toMatchObject({
      state: 'reviewable',
      confirmation: {
        content: {
          recordedName: 'P. Pickett',
          identityDecisionIds: ['identity-review:alias'],
          reviewedSeasonIds: moreCompleteAlias.reviewedSeasonIds,
        },
      },
    });
  });

  it('fails closed without confirmation, for a mismatched confirmation, and unsupported assets', () => {
    expect(resolve()).toEqual({
      state: 'unavailable',
      reason: 'selected_player_identity_review_required',
    });
    expect(
      resolve({
        candidates: [candidate, { ...candidate, canonicalPlayerId: 'local-afl-player:200' }],
        confirmedCanonicalPlayerId: 'local-afl-player:unknown',
      })
    ).toEqual({ state: 'unavailable', reason: 'selected_player_identity_unresolved' });
    expect(
      resolve({ asset: { ...asset, pick: { ...asset.pick, numberActual: null } } })
    ).toEqual({ state: 'unavailable', reason: 'final_selection_not_recorded' });
    expect(
      resolve({ asset: { ...asset, assetType: 'player' } })
    ).toEqual({ state: 'unavailable', reason: 'asset_kind_not_supported' });
  });
});
