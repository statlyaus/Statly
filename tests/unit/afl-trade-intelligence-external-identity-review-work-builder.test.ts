import { describe, expect, it } from 'vitest';

import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { buildAflTradeExternalIdentityReviewPackage } from '@/server/aflTradeIntelligence/source/externalIdentityReviewWorkBuilder';
import {
  AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
  createAflTradeHistoricalCompletionReconciliationAuthority,
} from '@/server/aflTradeIntelligence/source/externalReconciliationSourceAuthorityContracts';

const sha = (character: string) => character.repeat(64);

function batch(
  provider: AflTradeExternalEvidenceContent['provider'],
  suffix: string,
  claims: AflTradeExternalEvidenceContent['claim'][]
) {
  const capture = {
    captureId: `source-capture:${sha(suffix)}`,
    artifactId: `artifact:${sha(suffix)}`,
    contentSha256: sha(suffix),
    mediaType: 'text/html',
    sourceUrl: `https://example.test/${provider}/2025`,
    capturedAt: '2026-08-10T00:00:02.000Z',
    effectiveAt: '2025-11-20T00:00:00.000Z',
    parserVersion: `${provider}/v1`,
    fieldManifestSha256: sha('f'),
  } as const;
  const evidence = claims.map((claim, index) =>
    createAflTradeExternalEvidenceEnvelope({
      schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
      provider,
      capture,
      sourceRow: { ordinal: index + 1, sourceKey: `${provider}:${index + 1}` },
      claim,
      publicationEligible: false,
    })
  );
  return createAflTradeExternalEvidenceBatch({
    schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
    provider,
    captureId: capture.captureId,
    evidence,
    finalizedAt: '2026-08-10T00:00:03.000Z',
    publicationEligible: false,
  });
}

const draftguru = batch('draftguru', 'a', [
  {
    kind: 'transaction',
    nativeEventId: '2025-example-trade',
    seasonYear: 2025,
    occurredOn: '2025-10-15',
    transactionType: 'trade',
    title: 'Example trade',
  },
  {
    kind: 'transaction_party',
    nativeEventId: '2025-example-trade',
    nativePartyId: 'western-bulldogs',
    club: { nativeId: null, recordedName: 'Western Bulldogs' },
  },
  {
    kind: 'directed_transfer',
    nativeEventId: '2025-example-trade',
    nativeTransferId: 'player-14',
    fromClub: { nativeId: 'club-gws', recordedName: 'GWS' },
    toClub: { nativeId: null, recordedName: 'Western Bulldogs' },
    asset: {
      kind: 'player',
      player: { nativeId: 'player-14', recordedName: 'Harry Kyle' },
    },
  },
  {
    kind: 'draft_selection',
    draftYear: 2025,
    draftType: 'national',
    selectionNumber: 14,
    roundNumber: 1,
    player: { nativeId: 'player-14', recordedName: 'H. Kyle' },
    selectedByClub: { nativeId: null, recordedName: 'Western Bulldogs' },
  },
]);

function sourceAuthority(sourceBatches = [draftguru]) {
  const batchIds = sourceBatches.map(({ batchId }) => batchId).sort();
  return createAflTradeHistoricalCompletionReconciliationAuthority({
    schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
    kind: 'historical_plan_completion',
    completionId: `external-historical-capture-completion:${sha('1')}`,
    completionSha256: sha('1'),
    planId: `external-historical-capture-plan:${sha('2')}`,
    planSha256: sha('2'),
    targetSetSha256: sha('3'),
    resultSetSha256: sha('4'),
    completionSourceBatchSetSha256: sha256AflTradeCanonicalJson(batchIds),
    candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson(batchIds),
    completedAt: '2026-08-10T00:00:04.000Z',
  });
}

describe('external identity review work builder', () => {
  it('creates intentional identity work for draft-session boundary facts', () => {
    const official = batch('official_afl', 'd', [
      {
        kind: 'draft_session_boundary',
        draftYear: 2018,
        draftType: 'national',
        sessionOrdinal: 2,
        boundary: 'first',
        selectionNumber: 23,
        player: { nativeId: null, recordedName: 'Jez McLennan' },
        selectedByClub: { nativeId: null, recordedName: 'Gold Coast' },
      },
    ]);

    const reviewPackage = buildAflTradeExternalIdentityReviewPackage({
      environment: 'test_fixture',
      competition: 'AFLM',
      sourceAuthority: sourceAuthority([official]),
      sourceBatches: [official],
    });

    expect(
      reviewPackage.content.items.map(({ workItem }) => workItem.content.observedNames).sort()
    ).toEqual([['Gold Coast'], ['Jez McLennan']]);
  });

  it('creates identity work for the holder and route clubs of a Footyinfo board pick', () => {
    const club = (nativeId: string, recordedName: string) => ({ nativeId, recordedName });
    const footyinfo = batch('footyinfo', 'e', [
      {
        kind: 'draft_board_pick',
        draftYear: 2025,
        draftType: 'national',
        roundNumber: 1,
        recordedPickNumber: 11,
        status: 'selected',
        club: club('GCS', 'Gold Coast'),
        player: { nativeId: 'player-11', recordedName: 'Example Player' },
        route: [club('PAD', 'Port Adelaide'), club('GCS', 'Gold Coast')],
        routeLabel: null,
        bid: null,
        points: null,
        note: null,
      },
      {
        kind: 'draft_board_pick',
        draftYear: 2025,
        draftType: 'national',
        roundNumber: 3,
        recordedPickNumber: null,
        status: 'removed',
        club: club('WCE', 'West Coast'),
        route: [],
        routeLabel: null,
        bid: null,
        points: null,
        note: null,
      },
    ]);

    const reviewPackage = buildAflTradeExternalIdentityReviewPackage({
      environment: 'test_fixture',
      competition: 'AFLM',
      sourceAuthority: sourceAuthority([footyinfo]),
      sourceBatches: [footyinfo],
    });

    const items = reviewPackage.content.items.map(({ workItem }) => workItem.content);
    const nativeIds = (entityKind: 'club' | 'player') =>
      items
        .filter(({ subject }) => subject.content.entityKind === entityKind)
        .map(({ subject }) =>
          subject.content.identityScope.kind === 'provider_native_id'
            ? subject.content.identityScope.nativeId
            : null
        )
        .sort();
    // Port Adelaide only routes a pick and West Coast only holds a removed one.
    expect(nativeIds('club')).toEqual(['GCS', 'PAD', 'WCE']);
    expect(nativeIds('player')).toEqual(['player-11']);
    expect(
      items.find(
        ({ subject }) =>
          subject.content.identityScope.kind === 'provider_native_id' &&
          subject.content.identityScope.nativeId === 'PAD'
      )?.observedNames
    ).toEqual(['Port Adelaide']);
  });

  it('creates identity work for the matching club, bidding club and nominee of a matched bid', () => {
    const club = (nativeId: string, recordedName: string) => ({ nativeId, recordedName });
    const footyinfo = batch('footyinfo', 'e', [
      {
        kind: 'draft_board_bid_match',
        draftYear: 2021,
        draftType: 'national',
        nativePickId: '5733',
        selectionNumber: 2,
        roundNumber: 1,
        club: club('WBD', 'Western Bulldogs'),
        player: { nativeId: 'sam-darcy', recordedName: 'Sam Darcy' },
        bid: { club: club('GWS', 'GWS'), basis: 'father_son' },
        points: 2517,
        pointsUsed: 347,
        consumedPicks: [
          {
            nativePickId: '5727',
            label: 'R3 (HAW) - Pick 45',
            originalNumber: 45,
            originalClubCode: 'HAW',
            holdingClubCode: 'WBD',
            pointsUsed: 347,
          },
        ],
        leftoverPicks: [],
      },
    ]);

    const reviewPackage = buildAflTradeExternalIdentityReviewPackage({
      environment: 'test_fixture',
      competition: 'AFLM',
      sourceAuthority: sourceAuthority([footyinfo]),
      sourceBatches: [footyinfo],
    });

    // The bidding club is a subject though it holds no pick; Hawthorn, named by code on a spent pick
    // only, is not an identity the board states.
    expect(
      reviewPackage.content.items
        .map(({ workItem }) => workItem.content)
        .map(({ subject, observedNames }) => `${subject.content.entityKind}:${observedNames[0]}`)
        .sort()
    ).toEqual(['club:GWS', 'club:Western Bulldogs', 'player:Sam Darcy']);
  });

  it('enumerates the exact provider identities without merging distinct source scopes', () => {
    const reviewPackage = buildAflTradeExternalIdentityReviewPackage({
      environment: 'test_fixture',
      competition: 'AFLM',
      sourceAuthority: sourceAuthority(),
      sourceBatches: [draftguru],
    });

    const items = reviewPackage.content.items.map(({ workItem }) => workItem.content);
    expect(items).toHaveLength(3);
    expect(
      items.find(({ subject }) => subject.content.entityKind === 'player')?.observedNames
    ).toEqual(['H. Kyle', 'Harry Kyle']);
    expect(
      items.find(
        ({ subject }) =>
          subject.content.identityScope.kind === 'exact_recorded_name' &&
          subject.content.identityScope.recordedName === 'Western Bulldogs'
      )?.observations
    ).toHaveLength(3);
    expect(
      items.find(
        ({ subject }) =>
          subject.content.identityScope.kind === 'provider_native_id' &&
          subject.content.identityScope.nativeId === 'club-gws'
      )
    ).toBeDefined();
  });

  it('rejects a trade identity whose event has no explicit transaction season', () => {
    const incomplete = batch('draftguru', 'b', [
      {
        kind: 'transaction_party',
        nativeEventId: '2025-missing-transaction',
        nativePartyId: 'gws',
        club: { nativeId: null, recordedName: 'GWS' },
      },
    ]);

    expect(() =>
      buildAflTradeExternalIdentityReviewPackage({
        environment: 'test_fixture',
        competition: 'AFLM',
        sourceAuthority: sourceAuthority([incomplete]),
        sourceBatches: [incomplete],
      })
    ).toThrow(/transaction season/i);
  });

  it('rejects substituted completion membership', () => {
    expect(() =>
      buildAflTradeExternalIdentityReviewPackage({
        environment: 'test_fixture',
        competition: 'AFLM',
        sourceAuthority: sourceAuthority(),
        sourceBatches: [
          batch(
            'draftguru',
            'c',
            draftguru.content.evidence.map((row) => row.content.claim)
          ),
        ],
      })
    ).toThrow(/source batches/i);
  });
});
