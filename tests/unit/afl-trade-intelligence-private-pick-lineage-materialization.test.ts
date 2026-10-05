import { describe, expect, it } from 'vitest';

import {
  materializePrivateValuationPickLineage,
  type PrivateValuationPickLineageFacts,
} from '@/server/aflTradeIntelligence/valuation/privateValuationPickLineageMaterialization';

const receivingClubId = 'local-afl-club:receiving';
const laterClubId = 'local-afl-club:later';
const tradeAt = '2021-10-15T00:00:00.000Z';
const cutoffAt = '2026-08-18T00:00:00.000Z';

function facts(): PrivateValuationPickLineageFacts {
  return {
    root: {
      assetId: 'asset:original-future-pick',
      transferAssetVersionId: 'event-asset-version:root',
      pickId: 'pick:future-first',
      assetKind: 'future_pick',
      receivingClubId,
      tradeEffectiveAt: tradeAt,
      evidenceId: 'evidence:original-trade',
    },
    knowledgeCutoffAt: cutoffAt,
    transfers: [
      {
        assetVersionId: 'event-asset-version:root',
        eventVersionId: 'event-version:original-trade',
        eventDate: tradeAt,
        recordedAt: tradeAt,
        assetKind: 'future_pick',
        playerId: null,
        pickId: 'pick:future-first',
        draftYear: 2021,
        fromClubId: 'local-afl-club:giver',
        toClubId: receivingClubId,
        evidenceId: 'evidence:original-trade',
      },
    ],
    pickTransformations: [
      {
        edgeId: 'pick-lineage-edge:future-to-final',
        parentPickId: 'pick:future-first',
        childPickId: 'pick:final-14',
        relationKind: 'future_right_resolved_to_pick',
        effectiveAt: '2021-11-01T00:00:00.000Z',
        knownFrom: '2021-11-01T00:00:00.000Z',
        evidenceId: 'evidence:pick-lineage',
      },
    ],
    custodyObservations: [
      {
        custodyObservationId: 'pick-custody:future-received',
        pickId: 'pick:future-first',
        observedAt: tradeAt,
        currentClubId: receivingClubId,
        recordedAt: tradeAt,
        evidenceId: 'evidence:original-trade',
      },
      {
        custodyObservationId: 'pick-custody:final-received',
        pickId: 'pick:final-14',
        observedAt: '2021-11-01T00:00:00.000Z',
        currentClubId: receivingClubId,
        recordedAt: '2021-11-01T00:00:00.000Z',
        evidenceId: 'evidence:pick-custody',
      },
    ],
    realizations: [
      {
        realizationId: 'pick-realization:final-14',
        transferAssetVersionId: 'event-asset-version:root',
        pickId: 'pick:final-14',
        draftSelectionId: 'draft-selection:14',
        recordedAt: '2021-11-21T00:00:00.000Z',
        evidenceId: 'evidence:realization',
      },
    ],
    selections: [
      {
        selectionId: 'draft-selection:14',
        pickId: 'pick:final-14',
        playerId: 'local-afl-player:selected',
        clubId: receivingClubId,
        eventDate: '2021-11-20T00:00:00.000Z',
        recordedAt: '2021-11-21T00:00:00.000Z',
        evidenceId: 'evidence:selection',
      },
    ],
    acquisitionSpells: [
      {
        spellVersionId: 'acquisition-spell-version:selected',
        startAssetVersionId: 'event-asset-version:drafted-player',
        playerId: 'local-afl-player:selected',
        clubId: receivingClubId,
        startDate: '2021-11-20T00:00:00.000Z',
        endDate: null,
        recordedAt: '2021-11-21T00:00:00.000Z',
        evidenceId: 'evidence:selected-player-spell',
      },
    ],
  };
}

describe('private pick lineage materialization', () => {
  it('materializes held entitlement, final pick, selection, and selected player once', () => {
    const result = materializePrivateValuationPickLineage(facts());

    expect(result).toMatchObject({
      state: 'ready',
      rootAssetId: 'asset:original-future-pick',
      attribution: {
        state: 'ready',
        frontierAssetIds: [expect.stringMatching(/^private-lineage-player:/u)],
      },
      frontierAssets: [
        {
          assetId: expect.stringMatching(/^private-lineage-player:/u),
          assetType: 'player',
          identity: {
            kind: 'player',
            playerId: 'local-afl-player:selected',
            acquisitionSpellVersionId: 'acquisition-spell-version:selected',
          },
          acquisitionClubId: receivingClubId,
          sourceTransferAssetVersionId: 'event-asset-version:root',
        },
      ],
      realizationAtCutoff: {
        state: 'selected',
        attribution: 'credited_current_frontier',
        realizationId: 'pick-realization:final-14',
        selection: {
          selectionId: 'draft-selection:14',
          pickId: 'pick:final-14',
          playerId: 'local-afl-player:selected',
          clubId: receivingClubId,
        },
        selectedPlayer: {
          assetType: 'player',
          identity: {
            kind: 'player',
            playerId: 'local-afl-player:selected',
            acquisitionSpellVersionId: 'acquisition-spell-version:selected',
          },
          acquisitionClubId: receivingClubId,
        },
      },
    });
    if (result.state !== 'ready') throw new Error('Expected materialized pick lineage.');
    expect(result.graph.edges.map(({ kind }) => kind)).toEqual([
      'future_right_resolved_to_pick',
      'pick_exercised_at_selection',
      'selection_created_player',
    ]);
  });

  it('stops following the departed pick and attributes the later exchange successor', () => {
    const onTraded = facts();
    onTraded.transfers.push(
      {
        assetVersionId: 'event-asset-version:pick-out',
        eventVersionId: 'event-version:later-trade',
        eventDate: '2021-11-10T00:00:00.000Z',
        recordedAt: '2021-11-10T00:00:00.000Z',
        assetKind: 'pick',
        playerId: null,
        pickId: 'pick:final-14',
        draftYear: 2021,
        fromClubId: receivingClubId,
        toClubId: laterClubId,
        evidenceId: 'evidence:later-trade',
      },
      {
        assetVersionId: 'event-asset-version:player-in',
        eventVersionId: 'event-version:later-trade',
        eventDate: '2021-11-10T00:00:00.000Z',
        recordedAt: '2021-11-10T00:00:00.000Z',
        assetKind: 'player',
        playerId: 'local-afl-player:successor',
        pickId: null,
        draftYear: null,
        fromClubId: laterClubId,
        toClubId: receivingClubId,
        evidenceId: 'evidence:later-trade',
      }
    );
    onTraded.custodyObservations.push({
      custodyObservationId: 'pick-custody:final-later',
      pickId: 'pick:final-14',
      observedAt: '2021-11-10T00:00:00.000Z',
      currentClubId: laterClubId,
      recordedAt: '2021-11-10T00:00:00.000Z',
      evidenceId: 'evidence:later-trade',
    });
    onTraded.selections[0] = { ...onTraded.selections[0]!, clubId: laterClubId };
    onTraded.acquisitionSpells = [
      {
        spellVersionId: 'acquisition-spell-version:successor',
        startAssetVersionId: 'event-asset-version:player-in',
        playerId: 'local-afl-player:successor',
        clubId: receivingClubId,
        startDate: '2021-11-10T00:00:00.000Z',
        endDate: null,
        recordedAt: '2021-11-10T00:00:00.000Z',
        evidenceId: 'evidence:successor-spell',
      },
      {
        spellVersionId: 'acquisition-spell-version:selected-later',
        startAssetVersionId: 'event-asset-version:drafted-player-later',
        playerId: 'local-afl-player:selected',
        clubId: laterClubId,
        startDate: '2021-11-20T00:00:00.000Z',
        endDate: null,
        recordedAt: '2021-11-21T00:00:00.000Z',
        evidenceId: 'evidence:selected-player-later-spell',
      },
    ];

    const result = materializePrivateValuationPickLineage(onTraded);
    expect(result).toMatchObject({
      state: 'ready',
      attribution: {
        state: 'ready',
        frontierAssetIds: [expect.stringMatching(/^private-lineage-player:/u)],
      },
      frontierAssets: [
        {
          assetId: expect.stringMatching(/^private-lineage-player:/u),
          assetType: 'player',
          identity: {
            kind: 'player',
            playerId: 'local-afl-player:successor',
            acquisitionSpellVersionId: 'acquisition-spell-version:successor',
          },
          acquisitionClubId: receivingClubId,
          sourceTransferAssetVersionId: 'event-asset-version:player-in',
        },
      ],
      realizationAtCutoff: {
        state: 'selected',
        attribution: 'superseded_by_later_exchange',
        realizationId: 'pick-realization:final-14',
        selection: {
          selectionId: 'draft-selection:14',
          pickId: 'pick:final-14',
          playerId: 'local-afl-player:selected',
          clubId: laterClubId,
        },
        selectedPlayer: {
          assetType: 'player',
          identity: {
            kind: 'player',
            playerId: 'local-afl-player:selected',
            acquisitionSpellVersionId: 'acquisition-spell-version:selected-later',
          },
          acquisitionClubId: laterClubId,
        },
      },
    });
    if (result.state !== 'ready') throw new Error('Expected on-traded pick lineage.');
    expect(result.graph.edges.map(({ kind }) => kind)).toEqual([
      'future_right_resolved_to_pick',
      'asset_traded_for_asset',
    ]);
    expect(result.graph.assets).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ evidenceId: 'evidence:selection', assetType: 'player' }),
      ])
    );
  });

  it('fails closed when the later exchange also gives another asset', () => {
    const ambiguous = facts();
    ambiguous.transfers.push(
      {
        assetVersionId: 'event-asset-version:pick-out',
        eventVersionId: 'event-version:later-trade',
        eventDate: '2021-11-10T00:00:00.000Z',
        recordedAt: '2021-11-10T00:00:00.000Z',
        assetKind: 'pick',
        playerId: null,
        pickId: 'pick:final-14',
        draftYear: 2021,
        fromClubId: receivingClubId,
        toClubId: laterClubId,
        evidenceId: 'evidence:later-trade',
      },
      {
        assetVersionId: 'event-asset-version:other-out',
        eventVersionId: 'event-version:later-trade',
        eventDate: '2021-11-10T00:00:00.000Z',
        recordedAt: '2021-11-10T00:00:00.000Z',
        assetKind: 'player',
        playerId: 'local-afl-player:other-out',
        pickId: null,
        draftYear: null,
        fromClubId: receivingClubId,
        toClubId: laterClubId,
        evidenceId: 'evidence:later-trade',
      },
      {
        assetVersionId: 'event-asset-version:player-in',
        eventVersionId: 'event-version:later-trade',
        eventDate: '2021-11-10T00:00:00.000Z',
        recordedAt: '2021-11-10T00:00:00.000Z',
        assetKind: 'player',
        playerId: 'local-afl-player:successor',
        pickId: null,
        draftYear: null,
        fromClubId: laterClubId,
        toClubId: receivingClubId,
        evidenceId: 'evidence:later-trade',
      }
    );

    expect(materializePrivateValuationPickLineage(ambiguous)).toEqual({
      state: 'unavailable',
      rootAssetId: 'asset:original-future-pick',
      reasons: ['later_exchange_attribution_ambiguous'],
    });
  });

  it('fails closed when a retained realization has no exact selection', () => {
    const incomplete = facts();
    incomplete.selections = [];

    expect(materializePrivateValuationPickLineage(incomplete)).toEqual({
      state: 'unavailable',
      rootAssetId: 'asset:original-future-pick',
      reasons: ['pick_realization_selection_missing'],
    });
  });

  it('fails closed when the root transfer has multiple realizations', () => {
    const ambiguous = facts();
    ambiguous.realizations.push({
      ...ambiguous.realizations[0]!,
      realizationId: 'pick-realization:duplicate',
    });

    expect(materializePrivateValuationPickLineage(ambiguous)).toEqual({
      state: 'unavailable',
      rootAssetId: 'asset:original-future-pick',
      reasons: ['pick_realization_ambiguous'],
    });
  });
});
