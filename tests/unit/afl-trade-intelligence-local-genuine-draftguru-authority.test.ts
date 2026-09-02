import { describe, expect, it } from 'vitest';

import {
  createLocalGenuinePlayerDraftguruCaptureCommand,
  createLocalGenuinePlayerDraftguruAuthorities,
  createLocalGenuinePlayerDraftguruGateRequest,
  recordLocalGenuinePlayerDraftguruAuthorities,
} from '@/server/aflTradeIntelligence/development/localGenuinePlayerDraftguruAuthority';
import { validateAflTradeExternalCaptureScope } from '@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';
import { evaluateAflTradeGate0A } from '@/server/aflTradeIntelligence/source/sourceContracts';

describe('local genuine-player Draftguru authority', () => {
  it('creates only bounded private non-production transaction capabilities', () => {
    const authorities = createLocalGenuinePlayerDraftguruAuthorities();

    expect(
      authorities.map(({ sourceRights }) =>
        sourceRights.content.acquisition.kind === 'provider_web'
          ? sourceRights.content.acquisition.capabilityId
          : null
      )
    ).toEqual(['draftguru-trade-index', 'draftguru-trade-detail', 'draftguru-player-trade-detail']);

    for (const authority of authorities) {
      expect(authority.sourceRights.content).toMatchObject({
        provider: 'draftguru',
        scope: {
          competitions: ['AFLM'],
          seasonRanges: [{ from: 2020, to: 2024 }],
          accessMechanism: 'automated_web',
        },
        operations: {
          bounded_evaluation_capture: 'allowed',
          raw_evidence_retention: 'allowed',
          metadata_hash_retention: 'allowed',
          internal_quality_evaluation: 'allowed',
          model_training: 'allowed',
          derived_feature_creation: 'allowed',
          public_derived_output: 'blocked',
          public_fact_display: 'blocked',
          raw_field_redistribution: 'blocked',
        },
        redistribution: {
          rawFieldsPermitted: false,
          publicDerivedOutputPermitted: false,
        },
        restrictions: {
          geographic: [],
          commercial: ['internal-evaluation'],
          audience: ['internal'],
        },
        proposalOrigin: 'human_authored',
        proposedBy: 'statly-product-owner',
      });
      expect(authority.proposal.content.environment).toBe('non_production');
      expect(authority.decision.content).toMatchObject({
        environment: 'non_production',
        state: 'approved',
        accountableOwner: 'statly-product-owner',
      });
      expect(authority.sourceRights.content.fields).not.toHaveLength(0);
      expect(
        authority.sourceRights.content.fields.every(
          ({ uses }) =>
            uses.archive_fact === 'allowed' &&
            uses.derived_feature === 'allowed' &&
            uses.model_training === 'allowed' &&
            uses.public_display === 'blocked'
        )
      ).toBe(true);
    }
  });

  it('covers every emitted trade-index and trade-detail claim leaf', () => {
    const byCapability = new Map(
      createLocalGenuinePlayerDraftguruAuthorities().map((authority) => [
        authority.capabilityId,
        authority,
      ])
    );

    expect(
      byCapability
        .get('draftguru-trade-index')!
        .sourceRights.content.fields.map(({ normalizedField }) => normalizedField)
    ).toEqual([
      'trade_detail_link.anchorSeasonYear',
      'trade_detail_link.nativeEventId',
      'trade_detail_link.sourceUrl',
    ]);
    expect(
      byCapability
        .get('draftguru-trade-detail')!
        .sourceRights.content.fields.map(({ normalizedField }) => normalizedField)
    ).toEqual([
      'directed_transfer.asset.draftType',
      'directed_transfer.asset.draftYear',
      'directed_transfer.asset.kind',
      'directed_transfer.asset.originalClub.recordedName',
      'directed_transfer.asset.player.nativeId',
      'directed_transfer.asset.player.recordedName',
      'directed_transfer.asset.recordedPickNumber',
      'directed_transfer.asset.roundNumber',
      'directed_transfer.fromClub.recordedName',
      'directed_transfer.nativeEventId',
      'directed_transfer.nativeTransferId',
      'directed_transfer.toClub.recordedName',
      'transaction.nativeEventId',
      'transaction.seasonYear',
      'transaction.title',
      'transaction.transactionType',
      'transaction_party.club.recordedName',
      'transaction_party.nativeEventId',
      'transaction_party.nativePartyId',
    ]);
    expect(
      byCapability
        .get('draftguru-player-trade-detail')!
        .sourceRights.content.fields.map(({ normalizedField }) => normalizedField)
    ).toEqual([
      'directed_transfer.asset.kind',
      'directed_transfer.asset.player.nativeId',
      'directed_transfer.asset.player.recordedName',
      'directed_transfer.fromClub.recordedName',
      'directed_transfer.nativeEventId',
      'directed_transfer.nativeTransferId',
      'directed_transfer.toClub.recordedName',
      'transaction.nativeEventId',
      'transaction.seasonYear',
      'transaction.title',
      'transaction.transactionType',
      'transaction_party.club.recordedName',
      'transaction_party.nativeEventId',
      'transaction_party.nativePartyId',
    ]);
  });

  it('produces a mechanically eligible exact capture request for every admitted season', () => {
    const authorities = createLocalGenuinePlayerDraftguruAuthorities();
    for (const authority of authorities) {
      const request = createLocalGenuinePlayerDraftguruGateRequest(authority, 2022, {
        evaluatedAt: '2026-09-03T00:10:00.000Z',
      });
      const result = evaluateAflTradeGate0A(
        { proposals: [authority.proposal], decisions: [authority.decision] },
        authority.sourceRights,
        request
      );

      expect(result).toMatchObject({ status: 'mechanically_eligible', blockers: [] });
      expect(request.operations).toEqual([
        'bounded_evaluation_capture',
        'raw_evidence_retention',
        'metadata_hash_retention',
        'internal_quality_evaluation',
        'model_training',
        'derived_feature_creation',
      ]);
      expect(request.fieldUses).toHaveLength(authority.sourceRights.content.fields.length * 3);
    }
  });

  it('rejects seasons outside the explicitly approved 2020-2024 window', () => {
    const [authority] = createLocalGenuinePlayerDraftguruAuthorities();
    expect(() =>
      createLocalGenuinePlayerDraftguruGateRequest(authority!, 2025, {
        evaluatedAt: '2026-09-03T00:10:00.000Z',
      })
    ).toThrow(/2020 through 2024/i);
  });

  it('binds exact index and detail captures to their private authority', () => {
    const [index, detail, playerDetail] = createLocalGenuinePlayerDraftguruAuthorities();
    const common = {
      capturedAt: '2026-09-03T00:10:00.000Z',
      effectiveAt: '2026-09-03T00:09:00.000Z',
      maximumBytes: 2 * 1024 * 1024,
    };
    const indexCommand = createLocalGenuinePlayerDraftguruCaptureCommand(index, {
      ...common,
      season: 2024,
      discoveryFromSeason: 2020,
      sourceUrl: 'https://www.draftguru.com.au/trades',
    });
    const detailCommand = createLocalGenuinePlayerDraftguruCaptureCommand(detail, {
      ...common,
      season: 2022,
      sourceUrl: 'https://www.draftguru.com.au/trades/2022-jason-horne-francis',
    });
    const playerDetailCommand = createLocalGenuinePlayerDraftguruCaptureCommand(playerDetail, {
      ...common,
      season: 2022,
      sourceUrl: 'https://www.draftguru.com.au/trades/2022-josh-dunkley',
    });

    expect(() => validateAflTradeExternalCaptureScope(indexCommand.request)).not.toThrow();
    expect(() => validateAflTradeExternalCaptureScope(detailCommand.request)).not.toThrow();
    expect(() => validateAflTradeExternalCaptureScope(playerDetailCommand.request)).not.toThrow();
    expect(indexCommand.gateRequest.rightsArtifactId).toBe(index.sourceRights.rightsArtifactId);
    expect(detailCommand.gateRequest.rightsArtifactId).toBe(detail.sourceRights.rightsArtifactId);
    expect(indexCommand.request.discoveryFromSeasonYear).toBe(2020);
    expect(detailCommand.request.discoveryFromSeasonYear).toBeUndefined();
  });

  it('appends the three exact authorities as one optimistic ledger batch', async () => {
    let appendInput: unknown;
    const result = await recordLocalGenuinePlayerDraftguruAuthorities({
      load: async () => ({ revision: 7, ledger: { proposals: [], decisions: [] } }),
      appendBatch: async (input) => {
        appendInput = input;
        return {
          revision: 10,
          ledger: { proposals: [], decisions: [] },
          idempotentReplays: [false, false, false],
        };
      },
    });

    expect(appendInput).toMatchObject({ expectedRevision: 7 });
    expect((appendInput as { records: unknown[] }).records).toHaveLength(3);
    expect(result.revision).toBe(10);
  });
});
