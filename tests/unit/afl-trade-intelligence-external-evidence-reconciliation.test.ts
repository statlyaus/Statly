import { describe, expect, it } from 'vitest';

import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import {
  AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
  createAflTradeExternalIdentityResolution,
  reconcileAflTradeExternalEvidence,
} from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { parseAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import {
  AFL_TRADE_EXTERNAL_RECONCILIATION_CANDIDATE_SCHEMA_VERSION,
  AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
  createAflTradeHistoricalCompletionReconciliationAuthority,
} from '@/server/aflTradeIntelligence/source/externalReconciliationSourceAuthorityContracts';

const digest = (character: string) => character.repeat(64);
const capturedAt = '2026-08-09T04:00:00.000Z';

function capture(
  provider: AflTradeExternalEvidenceContent['provider'],
  suffix: string
): AflTradeExternalEvidenceContent['capture'] {
  const contentSha256 = digest(suffix);
  return {
    captureId: `source-capture:${digest(suffix)}`,
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    mediaType:
      provider === 'fitzroy_official_afl_player_details' ? 'application/x-r-rds' : 'text/html',
    sourceUrl:
      provider === 'fitzroy_official_afl_player_details'
        ? 'fitzroy://official-afl-player-details/2025'
        : provider === 'statly_local_fixture'
          ? `fixture://statly/${suffix}`
          : `https://example.test/${provider}/2025/${suffix}`,
    capturedAt,
    effectiveAt: '2025-11-20T00:00:00.000Z',
    parserVersion: `${provider}/v1`,
    fieldManifestSha256: digest('f'),
  };
}

function batch(
  provider: AflTradeExternalEvidenceContent['provider'],
  suffix: string,
  claims: AflTradeExternalEvidenceContent['claim'][],
  sourceUrl?: string,
  captureOverrides: Partial<AflTradeExternalEvidenceContent['capture']> = {}
) {
  const sourceCapture = {
    ...capture(provider, suffix),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...captureOverrides,
  };
  const evidence = claims.map((claim, index) =>
    createAflTradeExternalEvidenceEnvelope({
      schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
      provider,
      capture: sourceCapture,
      sourceRow: { ordinal: index + 1, sourceKey: `${provider}:${index + 1}` },
      claim,
      publicationEligible: false,
    })
  );
  return createAflTradeExternalEvidenceBatch({
    schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
    provider,
    captureId: sourceCapture.captureId,
    evidence,
    finalizedAt: capturedAt,
    publicationEligible: false,
  });
}

function resolution(
  provider: AflTradeExternalEvidenceContent['provider'],
  entityKind: 'club' | 'player',
  recordedName: string,
  canonicalId: string,
  nativeId: string | null = null
) {
  return createAflTradeExternalIdentityResolution({
    schemaVersion: AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
    provider,
    entityKind,
    sourceIdentity: { nativeId, recordedName },
    canonicalId,
    reviewDecisionId: `review-decision:${digest('a')}`,
    reviewDecisionSha256: digest('a'),
    decidedAt: '2026-08-09T03:00:00.000Z',
    status: 'current_approved',
  });
}

const draftguru = batch('draftguru', 'a', [
  {
    kind: 'transaction',
    nativeEventId: '2025-gws-bulldogs',
    seasonYear: 2025,
    occurredOn: '2025-10-15',
    transactionType: 'trade',
    title: 'GWS and Western Bulldogs exchange picks',
  },
  {
    kind: 'transaction_party',
    nativeEventId: '2025-gws-bulldogs',
    nativePartyId: 'gws',
    club: { nativeId: null, recordedName: 'GWS' },
  },
  {
    kind: 'transaction_party',
    nativeEventId: '2025-gws-bulldogs',
    nativePartyId: 'western-bulldogs',
    club: { nativeId: null, recordedName: 'Western Bulldogs' },
  },
  {
    kind: 'directed_transfer',
    nativeEventId: '2025-gws-bulldogs',
    nativeTransferId: 'pick-14',
    fromClub: { nativeId: null, recordedName: 'GWS' },
    toClub: { nativeId: null, recordedName: 'Western Bulldogs' },
    asset: {
      kind: 'current_pick',
      draftYear: 2025,
      draftType: 'national',
      recordedPickNumber: 14,
      recordedRoundNumber: 1,
      recordedLabel: 'Pick 14',
    },
  },
  {
    kind: 'draft_selection',
    draftYear: 2025,
    draftType: 'national',
    selectionNumber: 14,
    roundNumber: 1,
    player: { nativeId: 'harry-kyle', recordedName: 'Harry Kyle' },
    selectedByClub: { nativeId: 'western-bulldogs', recordedName: 'Western Bulldogs' },
  },
]);

const footywire = batch('footywire', 'b', [
  {
    kind: 'draft_selection',
    draftYear: 2025,
    draftType: 'national',
    selectionNumber: 14,
    roundNumber: 1,
    player: { nativeId: '11045', recordedName: 'Harry Kyle' },
    selectedByClub: { nativeId: 'western-bulldogs', recordedName: 'Western Bulldogs' },
  },
]);

const fitzroy = batch('fitzroy_official_afl_player_details', 'c', [
  {
    kind: 'player_draft_detail',
    player: { nativeId: 'CD_I1028012', recordedName: 'Harry Kyle' },
    squadSeason: 2026,
    squadClub: { nativeId: null, recordedName: 'Western Bulldogs' },
    draftYear: 2025,
    draftType: 'national',
    draftPosition: 14,
    recruitedFrom: 'Murray Bushrangers',
  },
]);

const officialOrder = batch('official_afl', 'd', [
  {
    kind: 'pick_custody',
    observedAt: '2025-11-01T00:00:00.000Z',
    draftYear: 2025,
    draftType: 'national',
    roundNumber: null,
    recordedPickNumber: 14,
    originalClub: { nativeId: null, recordedName: 'GWS' },
    currentClub: { nativeId: null, recordedName: 'Western Bulldogs' },
  },
]);

const futureDraftguru = batch('draftguru', '2', [
  {
    kind: 'transaction',
    nativeEventId: '2025-gws-bulldogs-future',
    seasonYear: 2025,
    occurredOn: '2025-10-15',
    transactionType: 'trade',
    title: 'GWS and Western Bulldogs exchange a future pick',
  },
  {
    kind: 'transaction_party',
    nativeEventId: '2025-gws-bulldogs-future',
    nativePartyId: 'gws',
    club: { nativeId: null, recordedName: 'GWS' },
  },
  {
    kind: 'transaction_party',
    nativeEventId: '2025-gws-bulldogs-future',
    nativePartyId: 'western-bulldogs',
    club: { nativeId: null, recordedName: 'Western Bulldogs' },
  },
  {
    kind: 'directed_transfer',
    nativeEventId: '2025-gws-bulldogs-future',
    nativeTransferId: 'gws-2026-round-2',
    fromClub: { nativeId: null, recordedName: 'GWS' },
    toClub: { nativeId: null, recordedName: 'Western Bulldogs' },
    asset: {
      kind: 'future_pick',
      draftYear: 2026,
      draftType: 'national',
      roundNumber: 2,
      originalClub: { nativeId: null, recordedName: 'GWS' },
    },
  },
]);

const futureOrder = batch('official_afl', '3', [
  {
    kind: 'pick_custody',
    observedAt: '2025-11-01T00:00:00.000Z',
    draftYear: 2026,
    draftType: 'national',
    roundNumber: 2,
    recordedPickNumber: null,
    originalClub: { nativeId: null, recordedName: 'GWS' },
    currentClub: { nativeId: null, recordedName: 'Western Bulldogs' },
  },
]);

const resolutions = [
  resolution('draftguru', 'club', 'GWS', 'club-gws'),
  resolution('draftguru', 'club', 'Western Bulldogs', 'club-western-bulldogs'),
  resolution('draftguru', 'club', 'Western Bulldogs', 'club-western-bulldogs', 'western-bulldogs'),
  resolution('draftguru', 'player', 'Harry Kyle', 'player-harry-kyle', 'harry-kyle'),
  resolution('footywire', 'club', 'Western Bulldogs', 'club-western-bulldogs', 'western-bulldogs'),
  resolution('footywire', 'player', 'Harry Kyle', 'player-harry-kyle', '11045'),
  resolution(
    'fitzroy_official_afl_player_details',
    'club',
    'Western Bulldogs',
    'club-western-bulldogs'
  ),
  resolution(
    'fitzroy_official_afl_player_details',
    'player',
    'Harry Kyle',
    'player-harry-kyle',
    'CD_I1028012'
  ),
  resolution('official_afl', 'club', 'Western Bulldogs', 'club-western-bulldogs'),
  resolution('official_afl', 'club', 'GWS', 'club-gws'),
];

describe('external draft and trade evidence reconciliation', () => {
  it('keeps local fixture evidence and provider support inside test_fixture', () => {
    const local = batch('statly_local_fixture', 'e', [
      {
        kind: 'draft_selection',
        draftYear: 2025,
        draftType: 'national',
        selectionNumber: 1,
        roundNumber: 1,
        player: { nativeId: null, recordedName: 'Synthetic Local Player' },
        selectedByClub: { nativeId: null, recordedName: 'Synthetic Local Club' },
      },
    ]);
    const identityResolutions = [
      resolution('statly_local_fixture', 'player', 'Synthetic Local Player', 'player-local'),
      resolution('statly_local_fixture', 'club', 'Synthetic Local Club', 'club-local'),
    ];

    expect(() =>
      reconcileAflTradeExternalEvidence({
        environment: 'non_production',
        competition: 'AFLM',
        anchorSeasonYear: 2025,
        sourceBatches: [local],
        identityResolutions,
        reconciledAt: capturedAt,
      })
    ).toThrow(/only in test_fixture/i);

    const candidate = reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      sourceBatches: [local],
      identityResolutions,
      reconciledAt: capturedAt,
    });
    expect(() =>
      parseAflTradeExternalReconciliationCandidate({
        ...candidate,
        content: { ...candidate.content, environment: 'production' },
      })
    ).toThrow(/fixture provider support is valid only in test_fixture/i);
  });

  it('rejects local fixture identities outside test_fixture with external source batches', () => {
    expect(() =>
      reconcileAflTradeExternalEvidence({
        environment: 'production',
        competition: 'AFLM',
        anchorSeasonYear: 2025,
        sourceBatches: [draftguru],
        identityResolutions: [
          resolution('statly_local_fixture', 'club', 'Synthetic Local Club', 'club-local'),
        ],
        reconciledAt: capturedAt,
      })
    ).toThrow(/fixture identities can be reconciled only in test_fixture/i);
  });

  it('builds a version 2 candidate from an exact historical completion authority', () => {
    const sourceBatches = [draftguru, footywire, fitzroy, officialOrder];
    const sourceBatchIds = sourceBatches.map(({ batchId }) => batchId).sort();
    const sourceAuthority = createAflTradeHistoricalCompletionReconciliationAuthority({
      schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
      kind: 'historical_plan_completion',
      completionId: `external-historical-capture-completion:${digest('9')}`,
      completionSha256: digest('9'),
      planId: `external-historical-capture-plan:${digest('8')}`,
      planSha256: digest('7'),
      targetSetSha256: digest('6'),
      resultSetSha256: digest('5'),
      completionSourceBatchSetSha256: digest('4'),
      candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson(sourceBatchIds),
      completedAt: '2026-08-09T04:30:00.000Z',
    });

    const candidate = reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      sourceBatches,
      identityResolutions: resolutions,
      sourceAuthority,
      reconciledAt: '2026-08-09T05:00:00.000Z',
    });

    expect(candidate.content.schemaVersion).toBe(
      AFL_TRADE_EXTERNAL_RECONCILIATION_CANDIDATE_SCHEMA_VERSION
    );
    expect(candidate.content.sourceAuthority).toEqual(sourceAuthority);
  });

  it('builds a complete party exchange and resolves pick 14 to its selected player', () => {
    const candidate = reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      sourceBatches: [draftguru, footywire, fitzroy, officialOrder],
      identityResolutions: resolutions,
      reconciledAt: '2026-08-09T05:00:00.000Z',
    });

    expect(candidate.content.transactions).toHaveLength(1);
    expect(candidate.content.transactions[0]).toMatchObject({
      parties: ['club-gws', 'club-western-bulldogs'],
      status: 'single_source',
    });
    expect(candidate.content.transfers[0]).toMatchObject({
      fromClubId: 'club-gws',
      toClubId: 'club-western-bulldogs',
      asset: { kind: 'pick_entitlement', draftYear: 2025, draftType: 'national', nominalPick: 14 },
    });
    expect(candidate.content.draftSelections).toEqual([
      expect.objectContaining({
        selectionNumber: 14,
        playerId: 'player-harry-kyle',
        clubId: 'club-western-bulldogs',
        status: 'corroborated',
        supportingProviders: ['draftguru', 'fitzroy_official_afl_player_details', 'footywire'],
      }),
    ]);
    expect(candidate.content.pickLineage).toEqual([
      expect.objectContaining({
        transferId: candidate.content.transfers[0].transferId,
        selectionId: candidate.content.draftSelections[0].selectionId,
        status: 'corroborated',
      }),
    ]);
    expect(candidate.content.issues).toEqual([]);
    expect(candidate.content.publicationEligible).toBe(false);
  });

  it('preserves an incomplete transaction as unresolved blocking evidence', () => {
    const incompleteBatch = batch('draftguru', 'e', [
      {
        kind: 'transaction',
        nativeEventId: 'incomplete-trade',
        seasonYear: 2025,
        occurredOn: null,
        transactionType: 'trade',
        title: null,
      },
    ]);
    const sourceAuthority = createAflTradeHistoricalCompletionReconciliationAuthority({
      schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
      kind: 'historical_plan_completion',
      completionId: `external-historical-capture-completion:${digest('9')}`,
      completionSha256: digest('9'),
      planId: `external-historical-capture-plan:${digest('8')}`,
      planSha256: digest('7'),
      targetSetSha256: digest('6'),
      resultSetSha256: digest('5'),
      completionSourceBatchSetSha256: digest('4'),
      candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson([incompleteBatch.batchId]),
      completedAt: '2026-08-09T04:30:00.000Z',
    });

    const candidate = parseAflTradeExternalReconciliationCandidate(
      reconcileAflTradeExternalEvidence({
        environment: 'test_fixture',
        competition: 'AFLM',
        anchorSeasonYear: 2025,
        sourceBatches: [incompleteBatch],
        identityResolutions: [],
        sourceAuthority,
        reconciledAt: '2026-08-09T05:00:00.000Z',
      })
    );

    expect(candidate.content.transactions).toEqual([
      expect.objectContaining({
        providerEventId: 'incomplete-trade',
        parties: [],
        transferIds: [],
        status: 'unresolved',
      }),
    ]);
    expect(candidate.content.issues).toEqual([
      expect.objectContaining({
        code: 'transaction_incomplete',
        subjectKey: 'transaction:incomplete-trade',
      }),
    ]);
  });

  it('preserves one entitlement through multiple on-trades before draft selection', () => {
    const onTradedDraftguru = batch('draftguru', 'b', [
      {
        kind: 'transaction',
        nativeEventId: '2025-gws-richmond',
        seasonYear: 2025,
        occurredOn: '2025-10-09',
        transactionType: 'trade',
        title: 'GWS trades pick 14 to Richmond',
      },
      {
        kind: 'transaction_party',
        nativeEventId: '2025-gws-richmond',
        nativePartyId: 'gws',
        club: { nativeId: null, recordedName: 'GWS' },
      },
      {
        kind: 'transaction_party',
        nativeEventId: '2025-gws-richmond',
        nativePartyId: 'richmond',
        club: { nativeId: null, recordedName: 'Richmond' },
      },
      {
        kind: 'directed_transfer',
        nativeEventId: '2025-gws-richmond',
        nativeTransferId: 'pick-14-to-richmond',
        fromClub: { nativeId: null, recordedName: 'GWS' },
        toClub: { nativeId: null, recordedName: 'Richmond' },
        asset: {
          kind: 'current_pick',
          draftYear: 2025,
          draftType: 'national',
          recordedPickNumber: 14,
          recordedRoundNumber: 1,
          recordedLabel: 'Pick 14',
        },
      },
      {
        kind: 'transaction',
        nativeEventId: '2025-richmond-bulldogs',
        seasonYear: 2025,
        occurredOn: '2025-10-15',
        transactionType: 'trade',
        title: 'Richmond on-trades pick 14 to Western Bulldogs',
      },
      {
        kind: 'transaction_party',
        nativeEventId: '2025-richmond-bulldogs',
        nativePartyId: 'richmond',
        club: { nativeId: null, recordedName: 'Richmond' },
      },
      {
        kind: 'transaction_party',
        nativeEventId: '2025-richmond-bulldogs',
        nativePartyId: 'western-bulldogs',
        club: { nativeId: null, recordedName: 'Western Bulldogs' },
      },
      {
        kind: 'directed_transfer',
        nativeEventId: '2025-richmond-bulldogs',
        nativeTransferId: 'pick-14-to-bulldogs',
        fromClub: { nativeId: null, recordedName: 'Richmond' },
        toClub: { nativeId: null, recordedName: 'Western Bulldogs' },
        asset: {
          kind: 'current_pick',
          draftYear: 2025,
          draftType: 'national',
          recordedPickNumber: 14,
          recordedRoundNumber: 1,
          recordedLabel: 'Pick 14',
        },
      },
      draftguru.content.evidence.find(({ content }) => content.claim.kind === 'draft_selection')!
        .content.claim,
    ]);
    const onTradedOrder = batch('official_afl', 'c', [
      {
        kind: 'pick_custody',
        observedAt: '2025-10-10T00:00:00.000Z',
        draftYear: 2025,
        draftType: 'national',
        roundNumber: 1,
        recordedPickNumber: 14,
        originalClub: { nativeId: null, recordedName: 'GWS' },
        currentClub: { nativeId: null, recordedName: 'Richmond' },
      },
      {
        kind: 'pick_custody',
        observedAt: '2025-11-01T00:00:00.000Z',
        draftYear: 2025,
        draftType: 'national',
        roundNumber: 1,
        recordedPickNumber: 14,
        originalClub: { nativeId: null, recordedName: 'GWS' },
        currentClub: { nativeId: null, recordedName: 'Western Bulldogs' },
      },
    ]);
    const candidate = reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      sourceBatches: [onTradedDraftguru, footywire, fitzroy, onTradedOrder],
      identityResolutions: [
        ...resolutions,
        resolution('draftguru', 'club', 'Richmond', 'club-richmond'),
        resolution('official_afl', 'club', 'Richmond', 'club-richmond'),
      ],
      reconciledAt: '2026-08-09T05:00:00.000Z',
    });

    expect(candidate.content.transfers).toHaveLength(2);
    expect(
      new Set(
        candidate.content.transfers.map(({ asset }) =>
          asset.kind === 'pick_entitlement' ? asset.pickId : null
        )
      ).size
    ).toBe(1);
    expect(candidate.content.transfers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'single_source',
          asset: expect.objectContaining({ originalClubId: 'club-gws' }),
        }),
      ])
    );
    expect(candidate.content.pickLineage).toHaveLength(2);
    expect(new Set(candidate.content.pickLineage.map(({ selectionId }) => selectionId)).size).toBe(
      1
    );
    expect(candidate.content.issues).toEqual([]);

    const undatedDraftguru = batch(
      'draftguru',
      '9',
      onTradedDraftguru.content.evidence.map(({ content }) =>
        content.claim.kind === 'transaction'
          ? { ...content.claim, occurredOn: null }
          : content.claim
      )
    );
    const undatedCandidate = reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      sourceBatches: [undatedDraftguru, footywire, fitzroy, onTradedOrder],
      identityResolutions: [
        ...resolutions,
        resolution('draftguru', 'club', 'Richmond', 'club-richmond'),
        resolution('official_afl', 'club', 'Richmond', 'club-richmond'),
      ],
      reconciledAt: '2026-08-09T05:00:00.000Z',
    });
    expect(undatedCandidate.content.pickLineage).toHaveLength(2);
    expect(undatedCandidate.content.issues).toEqual([]);

    const reconcileWithCustody = (
      suffix: string,
      custodyClaims: AflTradeExternalEvidenceContent['claim'][],
      extraResolutions: ReturnType<typeof resolution>[] = []
    ) =>
      reconcileAflTradeExternalEvidence({
        environment: 'test_fixture',
        competition: 'AFLM',
        anchorSeasonYear: 2025,
        sourceBatches: [
          onTradedDraftguru,
          footywire,
          fitzroy,
          batch('official_afl', suffix, custodyClaims),
        ],
        identityResolutions: [
          ...resolutions,
          resolution('draftguru', 'club', 'Richmond', 'club-richmond'),
          resolution('official_afl', 'club', 'Richmond', 'club-richmond'),
          ...extraResolutions,
        ],
        reconciledAt: '2026-08-09T05:00:00.000Z',
      });
    const custodyClaim = (
      observedAt: string,
      currentClub: string
    ): AflTradeExternalEvidenceContent['claim'] => ({
      kind: 'pick_custody',
      observedAt,
      draftYear: 2025,
      draftType: 'national',
      roundNumber: 1,
      recordedPickNumber: 14,
      originalClub: { nativeId: null, recordedName: 'GWS' },
      currentClub: { nativeId: null, recordedName: currentClub },
    });

    const prematureCustody = reconcileWithCustody('e', [
      custodyClaim('2025-10-01T00:00:00.000Z', 'Richmond'),
      custodyClaim('2025-11-01T00:00:00.000Z', 'Western Bulldogs'),
    ]);
    expect(prematureCustody.content.pickLineage).toHaveLength(1);
    expect(prematureCustody.content.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'lineage_unresolved' })])
    );

    const interruptedCustody = reconcileWithCustody(
      'f',
      [
        custodyClaim('2025-10-10T00:00:00.000Z', 'Richmond'),
        custodyClaim('2025-10-20T00:00:00.000Z', 'Carlton'),
        custodyClaim('2025-11-01T00:00:00.000Z', 'Western Bulldogs'),
      ],
      [resolution('official_afl', 'club', 'Carlton', 'club-carlton')]
    );
    expect(interruptedCustody.content.pickLineage).toHaveLength(1);
    expect(interruptedCustody.content.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'lineage_unresolved' })])
    );
  });

  it('keeps unresolved future picks distinct by original club and stable when custody arrives', () => {
    const baseClaims = futureDraftguru.content.evidence.map((row) => row.content.claim);
    const first = baseClaims.find((claim) => claim.kind === 'directed_transfer');
    if (!first || first.asset.kind !== 'future_pick') throw new Error('Missing future fixture');
    const second = {
      ...first,
      nativeTransferId: 'bulldogs-2026-round-2',
      asset: { ...first.asset, originalClub: { nativeId: null, recordedName: 'Western Bulldogs' } },
    };
    const input = {
      environment: 'test_fixture' as const,
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      sourceBatches: [batch('draftguru', '4', [...baseClaims, second])],
      identityResolutions: resolutions,
      reconciledAt: '2026-08-09T05:00:00.000Z',
    };
    const unresolved = reconcileAflTradeExternalEvidence(input);
    const assets = unresolved.content.transfers.map((transfer) => transfer.asset);
    expect(assets.every((asset) => asset.kind === 'pick_entitlement')).toBe(true);
    expect(
      new Set(assets.map((asset) => (asset.kind === 'pick_entitlement' ? asset.pickId : null))).size
    ).toBe(2);
    expect(unresolved.content.transfers.every((transfer) => transfer.status === 'unresolved')).toBe(
      true
    );
    const withCustody = reconcileAflTradeExternalEvidence({
      ...input,
      sourceBatches: [...input.sourceBatches, futureOrder],
    });
    const original = assets.find(
      (asset) => asset.kind === 'pick_entitlement' && asset.originalClubId === 'club-gws'
    );
    expect(
      withCustody.content.transfers.find(
        (transfer) =>
          transfer.asset.kind === 'pick_entitlement' && transfer.asset.originalClubId === 'club-gws'
      )?.asset
    ).toEqual(original);
    const unknown = reconcileAflTradeExternalEvidence({ ...input, identityResolutions: [] });
    expect(
      new Set(
        unknown.content.transfers.map((transfer) =>
          transfer.asset.kind === 'pick_entitlement' ? transfer.asset.pickId : null
        )
      ).size
    ).toBe(2);
    expect(unknown.content.transfers.every((transfer) => transfer.status === 'unresolved')).toBe(
      true
    );
  });

  it('keeps an unmatured future-pick entitlement open without inventing a selection', () => {
    const candidate = reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      sourceBatches: [futureDraftguru, futureOrder],
      identityResolutions: resolutions,
      reconciledAt: '2026-08-09T05:00:00.000Z',
    });

    expect(candidate.content.transfers).toEqual([
      expect.objectContaining({
        status: 'single_source',
        asset: expect.objectContaining({
          kind: 'pick_entitlement',
          draftYear: 2026,
          nominalRound: 2,
          nominalPick: null,
        }),
      }),
    ]);
    expect(candidate.content.draftSelections).toEqual([]);
    expect(candidate.content.pickLineage).toEqual([]);
    expect(candidate.content.issues).toEqual([]);
  });

  it('still blocks a matured pick entitlement whose selection is missing', () => {
    const candidate = reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2026,
      sourceBatches: [futureDraftguru, futureOrder],
      identityResolutions: resolutions,
      reconciledAt: '2026-12-01T00:00:00.000Z',
    });

    expect(candidate.content.pickLineage).toEqual([]);
    expect(candidate.content.issues).toContainEqual(
      expect.objectContaining({ code: 'lineage_unresolved', severity: 'blocking' })
    );
  });

  it('quarantines conflicting selection claims instead of selecting a majority winner', () => {
    const conflictingDraftguru = batch('draftguru', 'e', [
      {
        kind: 'draft_selection',
        draftYear: 2025,
        draftType: 'national',
        selectionNumber: 14,
        roundNumber: 1,
        player: { nativeId: 'oskar-taylor', recordedName: 'Oskar Taylor' },
        selectedByClub: { nativeId: 'western-bulldogs', recordedName: 'Western Bulldogs' },
      },
    ]);
    const conflictingResolution = resolution(
      'draftguru',
      'player',
      'Oskar Taylor',
      'player-oskar-taylor',
      'oskar-taylor'
    );

    const candidate = reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      sourceBatches: [conflictingDraftguru, footywire, fitzroy],
      identityResolutions: [...resolutions, conflictingResolution],
      reconciledAt: '2026-08-09T05:00:00.000Z',
    });

    expect(candidate.content.draftSelections[0]).toMatchObject({
      selectionNumber: 14,
      playerId: null,
      status: 'disputed',
    });
    expect(candidate.content.issues).toContainEqual(
      expect.objectContaining({ code: 'selection_conflict', severity: 'blocking' })
    );
  });

  it('uses official custody identity when a traded nominal pick shifts before draft night', () => {
    const footywireSelection = footywire.content.evidence[0].content.claim;
    const fitzroyPlayerDetail = fitzroy.content.evidence[0].content.claim;
    const officialCustody = officialOrder.content.evidence[0].content.claim;
    if (
      footywireSelection.kind !== 'draft_selection' ||
      fitzroyPlayerDetail.kind !== 'player_draft_detail' ||
      officialCustody.kind !== 'pick_custody'
    ) {
      throw new Error('Shifted-pick fixtures must retain their exact source claim kinds.');
    }
    const shiftedDraftguru = batch(
      'draftguru',
      '6',
      draftguru.content.evidence.map(({ content }) =>
        content.claim.kind === 'draft_selection'
          ? { ...content.claim, selectionNumber: 15 }
          : content.claim
      )
    );
    const shiftedFootywire = batch('footywire', '7', [
      {
        ...footywireSelection,
        selectionNumber: 15,
      },
    ]);
    const shiftedFitzroy = batch('fitzroy_official_afl_player_details', '8', [
      {
        ...fitzroyPlayerDetail,
        draftPosition: 15,
      },
    ]);
    const shiftedOrder = batch('official_afl', '9', [
      {
        ...officialCustody,
        recordedPickNumber: 15,
      },
    ]);

    const candidate = reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      sourceBatches: [shiftedDraftguru, shiftedFootywire, shiftedFitzroy, shiftedOrder],
      identityResolutions: resolutions,
      reconciledAt: '2026-08-09T05:00:00.000Z',
    });

    expect(candidate.content.transfers[0].asset).toMatchObject({ nominalPick: 14 });
    expect(candidate.content.draftSelections[0]).toMatchObject({
      selectionNumber: 15,
      playerId: 'player-harry-kyle',
    });
    expect(candidate.content.pickLineage).toEqual([
      expect.objectContaining({
        transferId: candidate.content.transfers[0].transferId,
        selectionId: candidate.content.draftSelections[0].selectionId,
      }),
    ]);
    expect(candidate.content.issues).toEqual([]);
  });

  it('quarantines colliding custody identities instead of guessing a shifted pick lineage', () => {
    const officialCustody = officialOrder.content.evidence[0].content.claim;
    if (officialCustody.kind !== 'pick_custody') {
      throw new Error('Official-order fixture must retain its pick-custody claim.');
    }
    const ambiguousOrder = batch('official_afl', '0', [
      {
        ...officialCustody,
        recordedPickNumber: 14,
      },
      {
        ...officialCustody,
        recordedPickNumber: 15,
      },
    ]);

    const candidate = reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      sourceBatches: [draftguru, footywire, fitzroy, ambiguousOrder],
      identityResolutions: resolutions,
      reconciledAt: '2026-08-09T05:00:00.000Z',
    });

    expect(candidate.content.pickCustody).toHaveLength(2);
    expect(candidate.content.pickCustody).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recordedPickNumber: 14, status: 'disputed' }),
        expect.objectContaining({ recordedPickNumber: 15, status: 'disputed' }),
      ])
    );
    expect(candidate.content.pickLineage).toEqual([]);
    expect(candidate.content.issues).toContainEqual(
      expect.objectContaining({ code: 'pick_identity_conflict', severity: 'blocking' })
    );
  });

  it('does not substitute another original club pick held by the receiving club', () => {
    const officialCustody = officialOrder.content.evidence[0].content.claim;
    if (officialCustody.kind !== 'pick_custody') {
      throw new Error('Official-order fixture must retain its pick-custody claim.');
    }
    const replacementOrder = batch('official_afl', '1', [
      {
        ...officialCustody,
        originalClub: { nativeId: null, recordedName: 'Carlton' },
      },
    ]);
    const candidate = reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      sourceBatches: [draftguru, footywire, fitzroy, replacementOrder],
      identityResolutions: [
        ...resolutions,
        resolution('official_afl', 'club', 'Carlton', 'club-carlton'),
      ],
      reconciledAt: '2026-08-09T05:00:00.000Z',
    });

    expect(candidate.content.transfers[0]).toMatchObject({ status: 'unresolved' });
    expect(candidate.content.pickLineage).toEqual([]);
    expect(candidate.content.issues).toContainEqual(
      expect.objectContaining({ code: 'lineage_unresolved', severity: 'blocking' })
    );
  });

  it('does not promote names or an indicative order row into canonical identity or selection', () => {
    const candidate = reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      sourceBatches: [officialOrder, footywire],
      identityResolutions: resolutions.filter(
        (value) =>
          !(value.content.provider === 'footywire' && value.content.entityKind === 'player')
      ),
      reconciledAt: '2026-08-09T05:00:00.000Z',
    });

    expect(candidate.content.draftSelections[0]).toMatchObject({
      playerId: null,
      status: 'unresolved',
    });
    expect(candidate.content.draftSelections).toHaveLength(1);
    expect(candidate.content.pickCustody).toEqual([
      expect.objectContaining({ currentClubId: 'club-western-bulldogs', recordedPickNumber: 14 }),
    ]);
    expect(candidate.content.issues).toContainEqual(
      expect.objectContaining({ code: 'identity_unresolved', severity: 'blocking' })
    );
  });
});

it('conserves explicit draft session evidence on each covered selection and blocks conflicting dates', () => {
  const session = batch('official_afl', '9', [
    {
      kind: 'draft_session',
      draftYear: 2025,
      draftType: 'national',
      sessionOrdinal: 1,
      eventDate: '2025-11-20',
      officialName: 'Synthetic national draft',
      selectionNumbers: [14],
    },
  ]);
  const reconcile = (extra: (typeof session)[] = []) =>
    reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      sourceBatches: [draftguru, footywire, officialOrder, session, ...extra],
      identityResolutions: resolutions,
      reconciledAt: capturedAt,
    });
  const candidate = reconcile();
  expect(candidate.content.draftSelections[0]!.evidenceIds).toContain(
    session.content.evidence[0]!.evidenceId
  );
  const conflict = batch('official_afl', '8', [
    {
      kind: 'draft_session',
      draftYear: 2025,
      draftType: 'national',
      sessionOrdinal: 1,
      eventDate: '2025-11-21',
      officialName: 'Synthetic conflicting date',
      selectionNumbers: [14],
    },
  ]);
  expect(reconcile([conflict]).content.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'selection_conflict', severity: 'blocking' }),
    ])
  );
});

it('reconciles a dated selection without inventing pre-draft pick custody or lineage', () => {
  const selection = batch('draftguru', '7', [
    {
      kind: 'draft_selection',
      draftYear: 2025,
      draftType: 'national',
      selectionNumber: 14,
      roundNumber: null,
      player: { nativeId: 'harry-kyle', recordedName: 'Harry Kyle' },
      selectedByClub: { nativeId: 'western-bulldogs', recordedName: 'Western Bulldogs' },
    },
  ]);
  const session = batch('official_afl', '6', [
    {
      kind: 'draft_session',
      draftYear: 2025,
      draftType: 'national',
      sessionOrdinal: 1,
      eventDate: '2025-11-20',
      officialName: 'Synthetic completed national draft',
      selectionNumbers: [14],
    },
  ]);
  const reconcile = (additional: (typeof selection)[] = [], identity = resolutions) =>
    reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      sourceBatches: [selection, session, ...additional],
      identityResolutions: identity,
      reconciledAt: capturedAt,
    });
  const candidate = reconcile();
  expect(candidate.content.issues).toEqual([]);
  expect(candidate.content.draftSelections).toEqual([
    expect.objectContaining({
      selectionNumber: 14,
      playerId: 'player-harry-kyle',
      clubId: 'club-western-bulldogs',
      status: 'single_source',
    }),
  ]);
  expect(candidate.content.pickCustody).toEqual([]);
  expect(candidate.content.pickLineage).toEqual([]);
  const custody = batch('official_afl', '5', [
    {
      kind: 'pick_custody',
      draftYear: 2025,
      draftType: 'national',
      roundNumber: 1,
      observedAt: '2025-11-20T00:00:00.000Z',
      recordedPickNumber: 14,
      originalClub: { nativeId: null, recordedName: 'GWS' },
      currentClub: { nativeId: null, recordedName: 'GWS' },
    },
  ]);
  expect(reconcile([custody]).content.draftSelections[0]!.status).toBe('unresolved');
  const incompleteCustody = batch('official_afl', '4', [
    {
      ...custody.content.evidence[0]!.content.claim,
      originalClub: null,
    } as AflTradeExternalEvidenceContent['claim'],
  ]);
  expect(reconcile([incompleteCustody]).content.draftSelections[0]!.status).toBe('unresolved');
  const agreeingSession = batch('official_afl', '2', [session.content.evidence[0]!.content.claim]);
  expect(reconcile([agreeingSession]).content.draftSelections[0]!.status).toBe('single_source');
  const conflictingSession = batch('official_afl', '3', [
    {
      kind: 'draft_session',
      draftYear: 2025,
      draftType: 'national',
      sessionOrdinal: 2,
      eventDate: '2025-11-21',
      officialName: 'Synthetic conflicting session',
      selectionNumbers: [14],
    },
  ]);
  expect(reconcile([conflictingSession]).content.draftSelections[0]!.status).toBe('disputed');
  expect(reconcile([], []).content.draftSelections[0]!.status).toBe('unresolved');
});

it('reconciles complementary session facts only with their complete inventory proof', () => {
  const selectionClaims = [1, 2, 3].map((selectionNumber) => ({
    kind: 'draft_selection' as const,
    draftYear: 2018,
    draftType: 'national' as const,
    selectionNumber,
    roundNumber: null,
    player: { nativeId: `player-${selectionNumber}`, recordedName: `Player ${selectionNumber}` },
    selectedByClub: {
      nativeId: `club-${selectionNumber}`,
      recordedName: `Club ${selectionNumber}`,
    },
  }));
  const inventory = batch('draftguru', 'a', selectionClaims);
  const dateOne = batch(
    'official_afl',
    '4',
    [
      {
        kind: 'draft_session_date',
        draftYear: 2018,
        draftType: 'national',
        sessionOrdinal: 1,
        eventDate: '2018-11-22',
      },
      {
        kind: 'draft_session_completion',
        draftYear: 2018,
        draftType: 'national',
        sessionOrdinal: 1,
      },
    ],
    'https://www.afl.com.au/news/53184/night-one'
  );
  const first = batch(
    'official_afl',
    '5',
    [
      {
        kind: 'draft_session_boundary',
        draftYear: 2018,
        draftType: 'national',
        sessionOrdinal: 1,
        boundary: 'first',
        selectionNumber: 1,
        player: { nativeId: 'player-1', recordedName: 'Player 1' },
        selectedByClub: { nativeId: 'club-1', recordedName: 'Club 1' },
      },
    ],
    'https://www.afl.com.au/news/99499/final-report'
  );
  const secondStart = batch(
    'official_afl',
    '6',
    [
      {
        kind: 'draft_session_boundary',
        draftYear: 2018,
        draftType: 'national',
        sessionOrdinal: 2,
        boundary: 'first',
        selectionNumber: 2,
        player: { nativeId: 'player-2', recordedName: 'Player 2' },
        selectedByClub: { nativeId: 'club-2', recordedName: 'Club 2' },
      },
    ],
    'https://www.afl.com.au/news/39763/day-two-first'
  );
  const finalSession = batch(
    'official_afl',
    '7',
    [
      {
        kind: 'draft_session_date',
        draftYear: 2018,
        draftType: 'national',
        sessionOrdinal: 2,
        eventDate: '2018-11-23',
      },
      {
        kind: 'draft_session_completion',
        draftYear: 2018,
        draftType: 'national',
        sessionOrdinal: 2,
      },
      {
        kind: 'draft_session_boundary',
        draftYear: 2018,
        draftType: 'national',
        sessionOrdinal: 2,
        boundary: 'last',
        selectionNumber: 3,
        player: { nativeId: 'player-3', recordedName: 'Player 3' },
        selectedByClub: { nativeId: 'club-3', recordedName: 'Club 3' },
      },
    ],
    'https://www.afl.com.au/news/99499/original-slug'
  );
  const total = batch(
    'official_afl',
    '8',
    [
      {
        kind: 'draft_completed_total',
        draftYear: 2018,
        draftType: 'national',
        selectionCount: 3,
      },
    ],
    'https://www.afl.com.au/news/140672/independent-total'
  );
  const identityResolutions = [
    ...['draftguru', 'official_afl'].flatMap((provider) =>
      [1, 2, 3].flatMap((number) => [
        resolution(
          provider as 'draftguru' | 'official_afl',
          'player',
          `Player ${number}`,
          `player-${number}`,
          `player-${number}`
        ),
        resolution(
          provider as 'draftguru' | 'official_afl',
          'club',
          `Club ${number}`,
          `club-${number}`,
          `club-${number}`
        ),
      ])
    ),
  ];
  const candidate = reconcileAflTradeExternalEvidence({
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2018,
    sourceBatches: [inventory, dateOne, first, secondStart, finalSession, total],
    identityResolutions,
    reconciledAt: capturedAt,
  });
  const proofIds = [dateOne, first, secondStart, finalSession, total]
    .flatMap(({ content }) => content.evidence.map(({ evidenceId }) => evidenceId))
    .sort();

  expect(candidate.content.issues).toEqual([]);
  expect(candidate.content.draftSelections).toHaveLength(3);
  for (const selection of candidate.content.draftSelections) {
    expect(selection.status).toBe('single_source');
    expect(selection.evidenceIds).toEqual(expect.arrayContaining(proofIds));
  }

  const gappedBatches = [inventory, dateOne, first, secondStart, finalSession, total].map(
    (source, index) =>
      batch(
        source.content.provider,
        ['a', '4', '5', '6', '7', '8'][index]!,
        source.content.evidence.map(({ content: { claim } }) =>
          claim.kind === 'draft_selection' || claim.kind === 'draft_session_boundary'
            ? {
                ...claim,
                selectionNumber:
                  claim.selectionNumber === 2 ? 4 : claim.selectionNumber === 3 ? 97 : 1,
              }
            : claim
        ),
        source.content.evidence[0]!.content.capture.sourceUrl
      )
  );
  const membership = batch(
    'official_afl',
    'f',
    [
      {
        kind: 'draft_completed_inventory',
        draftYear: 2018,
        draftType: 'national',
        selectionNumbers: [1, 4, 97],
      },
    ],
    'https://www.afl.com.au/news/999999/fixture-membership'
  );
  const reconcileGapped = (sources: typeof gappedBatches) =>
    reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2018,
      sourceBatches: sources,
      identityResolutions,
      reconciledAt: capturedAt,
    });
  const gapped = reconcileGapped([...gappedBatches, membership]);
  expect(gapped.content.issues).toEqual([]);
  expect(gapped.content.draftSelections.map((selection) => selection.selectionNumber)).toEqual([
    1, 4, 97,
  ]);
  for (const selection of gapped.content.draftSelections) {
    expect(selection.status).toBe('single_source');
    expect(selection.evidenceIds).toContain(membership.content.evidence[0]!.evidenceId);
  }
  expect(reconcileGapped(gappedBatches).content.issues.length).toBeGreaterThan(0);

  const aliasTotal = batch(
    'official_afl',
    '9',
    [total.content.evidence[0]!.content.claim],
    'https://www.afl.com.au/news/99499/alternate-slug?capture=2'
  );
  const aliasCandidate = reconcileAflTradeExternalEvidence({
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2018,
    sourceBatches: [inventory, dateOne, first, secondStart, finalSession, aliasTotal],
    identityResolutions,
    reconciledAt: capturedAt,
  });
  expect(aliasCandidate.content.issues[0]?.detail).toContain('independent authenticated document');
  const unrecognizedTerminal = batch(
    'official_afl',
    'b',
    finalSession.content.evidence.map(({ content }) => content.claim),
    'https://example.test/not-an-authenticated-afl-article'
  );
  const unrecognizedCandidate = reconcileAflTradeExternalEvidence({
    environment: 'non_production',
    competition: 'AFLM',
    anchorSeasonYear: 2018,
    sourceBatches: [inventory, dateOne, first, secondStart, unrecognizedTerminal, total],
    identityResolutions,
    reconciledAt: capturedAt,
  });
  expect(unrecognizedCandidate.content.issues[0]?.detail).toContain(
    'reviewed Official AFL article identity'
  );
});

it('reconciles the exact reviewed 2017 one-session article set outside fixtures', () => {
  const selectionClaims = Array.from({ length: 78 }, (_, index) => {
    const selectionNumber = index + 1;
    return {
      kind: 'draft_selection' as const,
      draftYear: 2017,
      draftType: 'national' as const,
      selectionNumber,
      roundNumber: null,
      player: {
        nativeId: `player-${selectionNumber}`,
        recordedName:
          selectionNumber === 1
            ? 'Cameron Rayner'
            : selectionNumber === 78
              ? 'Jarrod Garlett'
              : `Player ${selectionNumber}`,
      },
      selectedByClub: {
        nativeId: `club-${selectionNumber}`,
        recordedName:
          selectionNumber === 1
            ? 'Brisbane Lions'
            : selectionNumber === 78
              ? 'Carlton'
              : `Club ${selectionNumber}`,
      },
    };
  });
  const inventory = batch('draftguru', 'c', selectionClaims);
  const wrapClaims: AflTradeExternalEvidenceContent['claim'][] = [
    {
      kind: 'draft_session_date',
      draftYear: 2017,
      draftType: 'national',
      sessionOrdinal: 1,
      eventDate: '2017-11-24',
    },
    {
      kind: 'draft_session_completion',
      draftYear: 2017,
      draftType: 'national',
      sessionOrdinal: 1,
    },
    {
      kind: 'draft_session_boundary',
      draftYear: 2017,
      draftType: 'national',
      sessionOrdinal: 1,
      boundary: 'first',
      selectionNumber: 1,
      player: { nativeId: null, recordedName: 'Cameron Rayner' },
      selectedByClub: { nativeId: null, recordedName: 'Brisbane Lions' },
    },
    {
      kind: 'draft_session_boundary',
      draftYear: 2017,
      draftType: 'national',
      sessionOrdinal: 1,
      boundary: 'last',
      selectionNumber: 78,
      player: { nativeId: null, recordedName: 'Jarrod Garlett' },
      selectedByClub: { nativeId: null, recordedName: 'Carlton' },
    },
  ];
  const wrap = batch(
    'official_afl',
    'd',
    wrapClaims,
    'https://www.afl.com.au/news/142762/draft-wrap-lions-reveal-top-pick-freos-big-call'
  );
  const total = batch(
    'official_afl',
    'e',
    [
      {
        kind: 'draft_completed_total',
        draftYear: 2017,
        draftType: 'national',
        selectionCount: 78,
      },
    ],
    'https://www.afl.com.au/news/83698/broadcast-guide-premiership'
  );
  const date = batch(
    'official_afl',
    'f',
    [wrapClaims[0]!],
    'https://www.afl.com.au/news/46107/final-draft-order-check-out-all-of-your-clubs-picks'
  );
  const identityResolutions = [
    ...selectionClaims.flatMap((claim) => [
      resolution(
        'draftguru',
        'player',
        claim.player.recordedName,
        `canonical-${claim.player.nativeId}`,
        claim.player.nativeId
      ),
      resolution(
        'draftguru',
        'club',
        claim.selectedByClub.recordedName,
        `canonical-${claim.selectedByClub.nativeId}`,
        claim.selectedByClub.nativeId
      ),
    ]),
    resolution('official_afl', 'player', 'Cameron Rayner', 'canonical-player-1'),
    resolution('official_afl', 'club', 'Brisbane Lions', 'canonical-club-1'),
    resolution('official_afl', 'player', 'Jarrod Garlett', 'canonical-player-78'),
    resolution('official_afl', 'club', 'Carlton', 'canonical-club-78'),
  ];
  const reconcile2017 = (
    sourceBatches: ReturnType<typeof batch>[],
    resolutionsForCandidate = identityResolutions
  ) =>
    reconcileAflTradeExternalEvidence({
      environment: 'non_production',
      competition: 'AFLM',
      anchorSeasonYear: 2017,
      sourceBatches,
      identityResolutions: resolutionsForCandidate,
      reconciledAt: capturedAt,
    });

  const candidate = reconcile2017([inventory, wrap, total, date]);
  const proofIds = [wrap, total, date]
    .flatMap(({ content }) => content.evidence.map(({ evidenceId }) => evidenceId))
    .sort();
  expect(candidate.content.issues).toEqual([]);
  expect(candidate.content.draftSelections).toHaveLength(78);
  for (const selection of candidate.content.draftSelections) {
    expect(selection.status).toBe('single_source');
    expect(selection.evidenceIds).toEqual(expect.arrayContaining(proofIds));
  }

  const unknownWrap = batch(
    'official_afl',
    '1',
    wrapClaims,
    'https://www.afl.com.au/news/999999/unreviewed-draft-wrap'
  );
  expect(reconcile2017([inventory, unknownWrap, total, date]).content.issues[0]?.detail).toContain(
    'reviewed Official AFL article identity'
  );

  const aliasTotal = batch(
    'official_afl',
    '2',
    total.content.evidence.map(({ content }) => content.claim),
    'https://www.afl.com.au/news/142762/alternate-slug'
  );
  expect(reconcile2017([inventory, wrap, aliasTotal, date]).content.issues[0]?.detail).toContain(
    'independent authenticated document'
  );

  const missingInventory = batch('draftguru', '3', selectionClaims.slice(0, -1));
  expect(reconcile2017([missingInventory, wrap, total, date]).content.issues[0]?.detail).toContain(
    'complete unique inventory'
  );

  const duplicateInventory = batch('draftguru', '4', [
    ...selectionClaims,
    { ...selectionClaims[77]!, player: { nativeId: 'duplicate-78', recordedName: 'Duplicate 78' } },
  ]);
  expect(reconcile2017([duplicateInventory, wrap, total, date]).content.issues).not.toEqual([]);

  const conflictingDate = batch(
    'official_afl',
    '5',
    [
      {
        kind: 'draft_session_date',
        draftYear: 2017,
        draftType: 'national',
        sessionOrdinal: 1,
        eventDate: '2017-11-25',
      },
    ],
    'https://www.afl.com.au/news/46107/date-conflict'
  );
  expect(
    reconcile2017([inventory, wrap, total, conflictingDate]).content.issues[0]?.detail
  ).toContain('one agreed date precision');

  const extraSession = batch(
    'official_afl',
    '6',
    [
      {
        kind: 'draft_session_date',
        draftYear: 2017,
        draftType: 'national',
        sessionOrdinal: 2,
        eventDate: '2017-11-25',
      },
      {
        kind: 'draft_session_completion',
        draftYear: 2017,
        draftType: 'national',
        sessionOrdinal: 2,
      },
    ],
    'https://www.afl.com.au/news/46107/extra-session'
  );
  expect(reconcile2017([inventory, wrap, total, date, extraSession]).content.issues).not.toEqual(
    []
  );

  const wrongBoundaryResolutions = identityResolutions.map((identity) =>
    identity.content.provider === 'official_afl' &&
    identity.content.entityKind === 'player' &&
    identity.content.sourceIdentity.recordedName === 'Cameron Rayner'
      ? createAflTradeExternalIdentityResolution({
          ...identity.content,
          canonicalId: 'wrong-cameron-rayner',
        })
      : identity
  );
  expect(
    reconcile2017([inventory, wrap, total, date], wrongBoundaryResolutions).content.issues[0]
      ?.detail
  ).toContain('boundary identity disagrees');
});

it('reconciles only the reviewed 2016 one-session article identities outside fixtures', () => {
  const selectionClaims = Array.from({ length: 77 }, (_, index) => {
    const selectionNumber = index + 1;
    return {
      kind: 'draft_selection' as const,
      draftYear: 2016,
      draftType: 'national' as const,
      selectionNumber,
      roundNumber: null,
      player: {
        nativeId: `2016-player-${selectionNumber}`,
        recordedName:
          selectionNumber === 1
            ? 'Andrew McGrath'
            : selectionNumber === 77
              ? 'Jake Waterman'
              : `2016 Player ${selectionNumber}`,
      },
      selectedByClub: {
        nativeId: `2016-club-${selectionNumber}`,
        recordedName:
          selectionNumber === 1
            ? 'Essendon'
            : selectionNumber === 77
              ? 'West Coast'
              : `2016 Club ${selectionNumber}`,
      },
    };
  });
  const inventory = batch('draftguru', '1', selectionClaims);
  const wrapClaims: AflTradeExternalEvidenceContent['claim'][] = [
    {
      kind: 'draft_session_date',
      draftYear: 2016,
      draftType: 'national',
      sessionOrdinal: 1,
      eventDate: '2016-11-25',
    },
    {
      kind: 'draft_session_completion',
      draftYear: 2016,
      draftType: 'national',
      sessionOrdinal: 1,
    },
    {
      kind: 'draft_session_boundary',
      draftYear: 2016,
      draftType: 'national',
      sessionOrdinal: 1,
      boundary: 'first',
      selectionNumber: 1,
      player: { nativeId: null, recordedName: 'Andrew McGrath' },
      selectedByClub: { nativeId: null, recordedName: 'Essendon' },
    },
    {
      kind: 'draft_session_boundary',
      draftYear: 2016,
      draftType: 'national',
      sessionOrdinal: 1,
      boundary: 'last',
      selectionNumber: 77,
      player: { nativeId: null, recordedName: 'Jake Waterman' },
      selectedByClub: { nativeId: null, recordedName: 'West Coast' },
    },
  ];
  const wrapUrl = 'https://www.afl.com.au/news/157359/all-the-picks-from-the-2016-nab-afl-draft';
  const scheduleUrl = 'https://www.afl.com.au/news/49872/indicative-draft-order-your-clubs-picks';
  const totalUrl = 'https://www.afl.com.au/news/149290/revisiting-the-drafts-2016-national-draft';
  const wrap = batch('official_afl', '2', wrapClaims, wrapUrl);
  const schedule = batch('official_afl', '3', [wrapClaims[0]!], scheduleUrl);
  const total = batch(
    'official_afl',
    '4',
    [
      {
        kind: 'draft_completed_total',
        draftYear: 2016,
        draftType: 'national',
        selectionCount: 77,
      },
    ],
    totalUrl,
    { effectiveAt: '2019-11-28T11:30:00.000Z' }
  );
  const identityResolutions = [
    ...selectionClaims.flatMap((claim) => [
      resolution(
        'draftguru',
        'player',
        claim.player.recordedName,
        `canonical-${claim.player.nativeId}`,
        claim.player.nativeId
      ),
      resolution(
        'draftguru',
        'club',
        claim.selectedByClub.recordedName,
        `canonical-${claim.selectedByClub.nativeId}`,
        claim.selectedByClub.nativeId
      ),
    ]),
    resolution('official_afl', 'player', 'Andrew McGrath', 'canonical-2016-player-1'),
    resolution('official_afl', 'club', 'Essendon', 'canonical-2016-club-1'),
    resolution('official_afl', 'player', 'Jake Waterman', 'canonical-2016-player-77'),
    resolution('official_afl', 'club', 'West Coast', 'canonical-2016-club-77'),
  ];
  const reconcile2016 = (sourceBatches: ReturnType<typeof batch>[]) =>
    reconcileAflTradeExternalEvidence({
      environment: 'non_production',
      competition: 'AFLM',
      anchorSeasonYear: 2016,
      sourceBatches,
      identityResolutions,
      reconciledAt: capturedAt,
    });

  const rosterClaim: AflTradeExternalEvidenceContent['claim'] = {
    kind: 'draft_completed_membership_roster',
    draftYear: 2016,
    draftType: 'national',
    members: selectionClaims.map((claim) => ({
      recordedName: claim.player.recordedName,
      selectionNumber: claim.selectionNumber === 77 ? null : claim.selectionNumber,
    })),
  };
  const numberClaim: AflTradeExternalEvidenceContent['claim'] = {
    kind: 'draft_completed_member_number',
    draftYear: 2016,
    draftType: 'national',
    recordedName: 'Jake Waterman',
    selectionNumber: 77,
  };
  const roster = batch('official_afl', '5', [rosterClaim], wrapUrl);
  const number = batch('official_afl', '6', [numberClaim], totalUrl);
  const joined = reconcile2016([inventory, wrap, schedule, total, roster, number]);
  expect(joined.content.issues).toEqual([]);
  const joinedIds = [roster, number].flatMap((b) => b.content.evidence.map((e) => e.evidenceId));
  for (const selected of joined.content.draftSelections) {
    expect(selected.evidenceIds).toEqual(expect.arrayContaining(joinedIds));
  }
  expect(
    reconcile2016([inventory, wrap, schedule, total, roster]).content.issues.length
  ).toBeGreaterThan(0);
  const wrongName = batch(
    'official_afl',
    '7',
    [{ ...numberClaim, recordedName: 'Unrelated Player' }],
    totalUrl
  );
  expect(
    reconcile2016([inventory, wrap, schedule, total, roster, wrongName]).content.issues.length
  ).toBeGreaterThan(0);
  const wrongYear = batch('official_afl', '8', [{ ...numberClaim, draftYear: 2015 }], totalUrl);
  expect(
    reconcile2016([inventory, wrap, schedule, total, roster, wrongYear]).content.issues.length
  ).toBeGreaterThan(0);

  const mixedRoster = batch(
    'official_afl',
    'a',
    [
      {
        ...rosterClaim,
        members: [...rosterClaim.members, { recordedName: 'Elevated Rookie', selectionNumber: 90 }],
      },
    ],
    wrapUrl
  );
  const exclusionClaim = {
    kind: 'draft_completed_member_exclusion' as const,
    draftYear: 2016,
    draftType: 'national' as const,
    recordedName: 'Elevated Rookie',
    reason: 'rookie_elevation' as const,
  };
  const exclusion = batch('official_afl', 'b', [exclusionClaim], totalUrl);
  const classified = reconcile2016([
    inventory,
    wrap,
    schedule,
    total,
    mixedRoster,
    number,
    exclusion,
  ]);
  expect(classified.content.issues).toEqual([]);
  for (const selection of classified.content.draftSelections) {
    expect(selection.evidenceIds).toContain(exclusion.content.evidence[0]!.evidenceId);
  }
  expect(
    reconcile2016([inventory, wrap, schedule, total, mixedRoster, number]).content.issues.length
  ).toBeGreaterThan(0);
  const unrelatedExclusion = batch(
    'official_afl',
    'c',
    [{ ...exclusionClaim, recordedName: 'Other' }],
    totalUrl
  );
  expect(
    reconcile2016([inventory, wrap, schedule, total, mixedRoster, number, unrelatedExclusion])
      .content.issues.length
  ).toBeGreaterThan(0);

  const candidate = reconcile2016([inventory, wrap, schedule, total]);
  expect(total.content.evidence[0]!.content.capture.effectiveAt).toBe('2019-11-28T11:30:00.000Z');
  expect(total.content.evidence[0]!.content.claim).toMatchObject({
    kind: 'draft_completed_total',
    draftYear: 2016,
    selectionCount: 77,
  });
  const proofIds = [wrap, schedule, total]
    .flatMap(({ content }) => content.evidence.map(({ evidenceId }) => evidenceId))
    .sort();
  expect(candidate.content.issues).toEqual([]);
  expect(candidate.content.draftSelections).toHaveLength(77);
  expect(candidate.content.anchorSeasonYear).toBe(2016);
  for (const selection of candidate.content.draftSelections) {
    expect(selection.draftYear).toBe(2016);
    expect(selection.draftType).toBe('national');
    expect(selection.evidenceIds).toEqual(expect.arrayContaining(proofIds));
  }

  const aliasSchedule = batch(
    'official_afl',
    '5',
    [wrapClaims[0]!],
    'https://www.afl.com.au/news/49872/alternate-reviewed-slug?capture=2'
  );
  expect(reconcile2016([inventory, wrap, aliasSchedule, total]).content.issues).toEqual([]);

  for (const sourceUrl of [
    'https://www.afl.com.au/news/123233/club-verdict',
    'https://www.afl.com.au/news/999999/unknown',
    'https://example.test/news/157359/copied-article-id',
  ]) {
    const rejectedWrap = batch('official_afl', '6', wrapClaims, sourceUrl);
    expect(
      reconcile2016([inventory, rejectedWrap, schedule, total]).content.issues[0]?.detail
    ).toContain('reviewed Official AFL article identity');
  }
});
