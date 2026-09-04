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
          : `https://example.test/${provider}/2025`,
    capturedAt,
    effectiveAt: '2025-11-20T00:00:00.000Z',
    parserVersion: `${provider}/v1`,
    fieldManifestSha256: digest('f'),
  };
}

function batch(
  provider: AflTradeExternalEvidenceContent['provider'],
  suffix: string,
  claims: AflTradeExternalEvidenceContent['claim'][]
) {
  const sourceCapture = capture(provider, suffix);
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
