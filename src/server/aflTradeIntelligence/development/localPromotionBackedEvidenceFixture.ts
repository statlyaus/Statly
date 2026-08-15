import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from '../source/externalDraftTradeEvidenceContracts';
import {
  AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
  createAflTradeExternalIdentityResolution,
  reconcileAflTradeExternalEvidence,
} from '../source/externalEvidenceReconciliation';
import { createLocalAflTradeArchiveFixture } from './localSourceArchiveFixture';

const capturedAt = '2026-08-09T08:00:01.000Z';
const reconciledAt = '2026-08-09T08:10:00.000Z';

type Provider = AflTradeExternalEvidenceContent['provider'];
type Claim = AflTradeExternalEvidenceContent['claim'];

function sourceCapture(
  provider: Provider,
  sourceUrl: string,
  effectiveAt: string,
  claims: readonly Claim[]
): AflTradeExternalEvidenceContent['capture'] {
  const contentSha256 = sha256AflTradeCanonicalJson({ provider, sourceUrl, claims });
  return {
    captureId: createAflTradeContentAddress('source-capture', {
      provider,
      sourceUrl,
      contentSha256,
    }),
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    mediaType: 'application/json',
    sourceUrl,
    capturedAt,
    effectiveAt,
    parserVersion: `statly-local-${provider}/v1`,
    fieldManifestSha256: sha256AflTradeCanonicalJson(claims.map(({ kind }) => kind).sort()),
  };
}

function evidenceBatch(input: {
  provider: Provider;
  sourceUrl: string;
  effectiveAt: string;
  claims: readonly Claim[];
}) {
  const capture = sourceCapture(input.provider, input.sourceUrl, input.effectiveAt, input.claims);
  const evidence = input.claims.map((claim, index) =>
    createAflTradeExternalEvidenceEnvelope({
      schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
      provider: input.provider,
      capture,
      sourceRow: { ordinal: index + 1, sourceKey: `${input.provider}:${index + 1}` },
      claim,
      publicationEligible: false,
    })
  );
  return createAflTradeExternalEvidenceBatch({
    schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
    provider: input.provider,
    captureId: capture.captureId,
    evidence,
    finalizedAt: capturedAt,
    publicationEligible: false,
  });
}

function identityResolution(input: {
  provider: Provider;
  entityKind: 'club' | 'player';
  nativeId: string;
  recordedName: string;
  canonicalId: string;
}) {
  const reviewDecisionSha256 = sha256AflTradeCanonicalJson(input);
  return createAflTradeExternalIdentityResolution({
    schemaVersion: AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
    provider: input.provider,
    entityKind: input.entityKind,
    sourceIdentity: { nativeId: input.nativeId, recordedName: input.recordedName },
    canonicalId: input.canonicalId,
    reviewDecisionId: `review-decision:${reviewDecisionSha256}`,
    reviewDecisionSha256,
    decidedAt: '2026-08-09T08:05:00.000Z',
    status: 'current_approved',
  });
}

export function createLocalAflTradePromotionBackedEvidence() {
  const fixture = createLocalAflTradeArchiveFixture();
  const sourceShapedTrade = fixture.trades[0];
  if (!sourceShapedTrade) throw new TypeError('The local source fixture has no trade.');
  const clubById = new Map(fixture.clubs.map((club) => [club.id, club]));
  const clubBySlug = new Map(fixture.clubs.map((club) => [club.slug, club]));
  const entity = (clubId: string) => {
    const club = clubById.get(clubId);
    if (!club) throw new TypeError(`Unknown local club ${clubId}.`);
    return { nativeId: club.slug, recordedName: club.name };
  };

  const archiveClaims: Claim[] = fixture.trades.flatMap((trade) => [
    {
      kind: 'transaction' as const,
      nativeEventId: trade.id,
      seasonYear: trade.seasonYear,
      occurredOn: trade.occurredOn,
      transactionType: 'trade' as const,
      title: trade.title,
    },
    ...trade.parties.map((clubSlug) => {
      const club = clubBySlug.get(clubSlug);
      if (!club) throw new TypeError(`Unknown local party ${clubSlug}.`);
      return {
        kind: 'transaction_party' as const,
        nativeEventId: trade.id,
        nativePartyId: club.slug,
        club: { nativeId: club.slug, recordedName: club.name },
      };
    }),
    ...trade.assets.map((asset) => ({
      kind: 'directed_transfer' as const,
      nativeEventId: trade.id,
      nativeTransferId: asset.id,
      fromClub: entity(asset.fromClubId),
      toClub: entity(asset.toClubId),
      asset:
        asset.kind === 'future_pick'
          ? {
              kind: 'future_pick' as const,
              draftYear: asset.draftSeasonYear,
              draftType: 'national' as const,
              roundNumber: asset.nominalRound,
              originalClub: entity(asset.originalClubId),
            }
          : asset.kind === 'current_pick'
            ? {
                kind: 'current_pick' as const,
                draftYear: asset.draftSeasonYear,
                draftType: 'national' as const,
                recordedPickNumber: asset.nominalPick,
                recordedRoundNumber: asset.nominalRound,
                recordedLabel: asset.rawDescription,
              }
            : {
                kind: 'player' as const,
                player: {
                  nativeId: asset.selectedPlayerId,
                  recordedName: asset.selectedPlayer,
                },
              },
    })),
    ...trade.assets.flatMap((asset) =>
      asset.kind === 'current_pick'
        ? [
            {
              kind: 'draft_selection' as const,
              draftYear: asset.draftSeasonYear,
              draftType: 'national' as const,
              selectionNumber: asset.selectionNumber,
              roundNumber: asset.nominalRound,
              player: {
                nativeId: asset.selectedPlayerId,
                recordedName: asset.selectedPlayer,
              },
              selectedByClub: entity(asset.toClubId),
            },
          ]
        : []
    ),
  ]);
  const custodyClaims: Claim[] = sourceShapedTrade.assets.flatMap((asset) =>
    asset.kind === 'player'
      ? []
      : [
          {
            kind: 'pick_custody' as const,
            observedAt: '2025-11-01T00:00:00.000Z',
            draftYear: asset.draftSeasonYear,
            draftType: 'national' as const,
            roundNumber: asset.nominalRound,
            recordedPickNumber: asset.kind === 'current_pick' ? asset.selectionNumber : null,
            originalClub: entity(asset.originalClubId),
            currentClub: entity(asset.toClubId),
          },
        ]
  );
  const sourceBatches = [
    evidenceBatch({
      provider: 'statly_local_fixture',
      sourceUrl: 'fixture://statly/local-afl-trade-archive-v2',
      effectiveAt: `${sourceShapedTrade.occurredOn}T00:00:00.000Z`,
      claims: archiveClaims,
    }),
    evidenceBatch({
      provider: 'statly_local_fixture',
      sourceUrl: 'fixture://statly/local-afl-trade-custody-v2',
      effectiveAt: '2025-11-01T00:00:00.000Z',
      claims: custodyClaims,
    }),
  ];
  const clubResolutions = fixture.clubs.map((club) =>
    identityResolution({
      provider: 'statly_local_fixture',
      entityKind: 'club',
      nativeId: club.slug,
      recordedName: club.name,
      canonicalId: club.id,
    })
  );
  const playerResolutions = fixture.trades.flatMap((trade) =>
    trade.assets.flatMap((asset) =>
      asset.kind === 'current_pick' || asset.kind === 'player'
        ? [
            identityResolution({
              provider: 'statly_local_fixture',
              entityKind: 'player',
              nativeId: asset.selectedPlayerId,
              recordedName: asset.selectedPlayer,
              canonicalId: asset.selectedPlayerId,
            }),
          ]
        : []
    )
  );
  const identityResolutions = [...clubResolutions, ...playerResolutions];
  const candidate = reconcileAflTradeExternalEvidence({
    environment: fixture.environment,
    competition: fixture.competition,
    anchorSeasonYear: sourceShapedTrade.seasonYear,
    sourceBatches,
    identityResolutions,
    reconciledAt,
  });
  return { fixture, sourceBatches, identityResolutions, candidate };
}
