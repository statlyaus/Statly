import { describe, expect, it } from 'vitest';

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
import { reviewedStatementSourceUrl } from '@/server/aflTradeIntelligence/source/reviewedDraftNightTradeSourceScope';

type Provider = AflTradeExternalEvidenceContent['provider'];
type Claim = AflTradeExternalEvidenceContent['claim'];
const digest = (character: string) => character.repeat(64);
const capturedAt = '2026-10-12T00:00:00.000Z';
const sourceUrls: Partial<Record<Provider, string>> = {
  draftguru: 'https://www.draftguru.com.au/trades/2025-synthetic',
  official_afl: 'https://www.afl.com.au/news/1/synthetic-order',
  statly_reviewed: reviewedStatementSourceUrl(
    'src/server/aflTradeIntelligence/source/reviewedDraftNightTrades/2025-v1.json'
  ),
};

function batch(provider: Provider, suffix: string, claims: Claim[]) {
  const capture = {
    captureId: `source-capture:${digest(suffix)}`,
    artifactId: `artifact:${digest(suffix)}`,
    contentSha256: digest(suffix),
    mediaType: 'text/html',
    sourceUrl: sourceUrls[provider]!,
    capturedAt,
    effectiveAt: '2025-11-20T00:00:00.000Z',
    parserVersion: `${provider}/v1`,
    fieldManifestSha256: digest('f'),
  };
  return createAflTradeExternalEvidenceBatch({
    schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
    provider,
    captureId: capture.captureId,
    evidence: claims.map((claim, index) =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
        provider,
        capture,
        sourceRow: { ordinal: index + 1, sourceKey: `${provider}:${index + 1}` },
        claim,
        publicationEligible: false,
      })
    ),
    finalizedAt: capturedAt,
    publicationEligible: false,
  });
}

const pick = (recordedPickNumber: number) =>
  ({ kind: 'current_pick', draftYear: 2025, draftType: 'national', recordedPickNumber }) as const;

/** One trade as Draftguru (undated) or the reviewed statement (dated to its night) states it. */
function trade(
  eventId: string,
  occurredOn: string | null,
  legs: [string, string, number][]
): Claim[] {
  const clubs = [...new Set(legs.flatMap(([from, to]) => [from, to]))];
  return [
    {
      kind: 'transaction',
      nativeEventId: eventId,
      seasonYear: 2025,
      occurredOn,
      transactionType: 'trade',
      title: null,
    },
    ...clubs.map((club): Claim => ({
      kind: 'transaction_party',
      nativeEventId: eventId,
      nativePartyId: club.toLowerCase(),
      club: { nativeId: null, recordedName: club },
    })),
    ...legs.map(([from, to, slot]): Claim => ({
      kind: 'directed_transfer',
      nativeEventId: eventId,
      nativeTransferId: `pick:2025:national:${slot}`,
      fromClub: { nativeId: null, recordedName: from },
      toClub: { nativeId: null, recordedName: to },
      asset: pick(slot),
    })),
  ];
}

const custody = (observedAt: string, slot: number, holder: string, original: string): Claim => ({
  kind: 'pick_custody',
  observedAt,
  draftYear: 2025,
  draftType: 'national',
  roundNumber: 1,
  recordedPickNumber: slot,
  originalClub: { nativeId: null, recordedName: original },
  currentClub: { nativeId: null, recordedName: holder },
});

const clubs = ['Carlton', 'GWS', 'Western Bulldogs', 'Richmond'];
const identityResolutions = clubs.flatMap((club) =>
  (['draftguru', 'official_afl', 'statly_reviewed'] as const).map((provider) =>
    createAflTradeExternalIdentityResolution({
      schemaVersion: AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
      provider,
      entityKind: 'club',
      sourceIdentity: { nativeId: null, recordedName: club },
      canonicalId: `club-${club.toLowerCase().replace(/ /g, '-')}`,
      reviewDecisionId: `review-decision:${digest('a')}`,
      reviewDecisionSha256: digest('a'),
      decidedAt: '2026-10-11T00:00:00.000Z',
      status: 'current_approved',
    })
  )
);

function reconcile(reviewed: Claim[], orders: Claim[]) {
  return reconcileAflTradeExternalEvidence({
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    sourceBatches: [
      // Trade period: Carlton sends pick 14 to GWS (Draftguru records no day).
      batch('draftguru', 'a', trade('2025-carlton-gws', null, [['Carlton', 'GWS', 14]])),
      batch('official_afl', 'b', orders),
      batch('statly_reviewed', 'c', reviewed),
    ],
    identityResolutions,
    reconciledAt: '2026-10-12T01:00:00.000Z',
  }).content;
}

const nightTrade = (from: string) =>
  trade('draft-night-2025-2025-11-20-synthetic', '2025-11-20', [
    [from, 'Western Bulldogs', 14],
    ['Western Bulldogs', from, 30],
  ]);
const legOf = (candidate: ReturnType<typeof reconcile>, from: string, slot: number) =>
  candidate.transfers.find(
    ({ fromClubId, asset }) =>
      fromClubId === `club-${from.toLowerCase().replace(/ /g, '-')}` &&
      asset.kind === 'pick_entitlement' &&
      asset.nominalPick === slot
  )!;

describe('a dated draft-night trade read against the pre-draft order (statlyaus/Statly#886)', () => {
  it('takes the order pick when the order names the sender as holder on the eve of the night', () => {
    const candidate = reconcile(nightTrade('GWS'), [
      custody('2025-11-15T00:00:00.000Z', 14, 'GWS', 'Carlton'),
    ]);
    const orderPick = candidate.pickCustody[0]!.pickId;
    const tradePeriod = legOf(candidate, 'Carlton', 14);
    const draftNight = legOf(candidate, 'GWS', 14);
    expect(draftNight.status).toBe('single_source');
    expect(draftNight.asset).toMatchObject({ kind: 'pick_entitlement', pickId: orderPick });
    // The grader's traded-on link: the same pick, given by the club the trade period delivered it to.
    expect(tradePeriod.asset).toMatchObject({ pickId: orderPick });
    expect(draftNight.fromClubId).toBe(tradePeriod.toClubId);
    expect(draftNight.transactionId).not.toBe(tradePeriod.transactionId);
    const night = candidate.transactions.find(
      ({ transactionId }) => transactionId === draftNight.transactionId
    )!;
    expect(night).toMatchObject({ occurredOn: '2025-11-20', transactionType: 'trade' });
  });

  it('does not take the order pick when the order names another holder', () => {
    const candidate = reconcile(nightTrade('Richmond'), [
      custody('2025-11-15T00:00:00.000Z', 14, 'GWS', 'Carlton'),
    ]);
    const draftNight = legOf(candidate, 'Richmond', 14);
    expect(draftNight.status).toBe('unresolved');
    expect(draftNight.asset).not.toMatchObject({ pickId: candidate.pickCustody[0]!.pickId });
  });

  it('decides by a later observation when one exists', () => {
    // After the night the slot is observed with the Bulldogs: the existing sequence rule proves the
    // hop, and the earlier observation is not read as the eve-of-trade holder as well.
    const candidate = reconcile(nightTrade('GWS'), [
      custody('2025-11-15T00:00:00.000Z', 14, 'GWS', 'Carlton'),
      custody('2025-11-21T00:00:00.000Z', 14, 'Western Bulldogs', 'Carlton'),
    ]);
    const draftNight = legOf(candidate, 'GWS', 14);
    expect(draftNight.status).toBe('single_source');
    expect(draftNight.asset).toMatchObject({ pickId: candidate.pickCustody[0]!.pickId });
  });
});
