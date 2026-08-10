import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradePromotionBackedCorpus } from '@/server/aflTradeIntelligence/artifacts/promotionBackedCorpusContracts';
import { createAflTradePromotionBackedFactualRelease } from '@/server/aflTradeIntelligence/outcomes/promotionBackedFactualReleaseContracts';
import {
  createAflTradePromotionBackedPublicArchive,
  type AflTradePromotionBackedPublicArchiveRecordInput,
} from '@/server/aflTradeIntelligence/outcomes/promotionBackedPublicArchiveContracts';
import {
  assessAuthenticatedCompleteAflTrade,
  type AflTradeCompleteAssessmentV2VerificationInput,
} from '@/server/aflTradeIntelligence/valuation/completeTradeAssessment';
import { createAflTradeComponentDrawSet } from '@/server/aflTradeIntelligence/valuation/componentDrawSet';
import { createAflTradePackagePolicy } from '@/server/aflTradeIntelligence/valuation/packagePolicy';
import { createAflTradeRealizedContributionLedger } from '@/server/aflTradeIntelligence/valuation/realizedContributionLedger';
import {
  createFabricatedAflTradeValuationFixture,
  type AflTradeValuationFixtureKind,
} from '@/server/aflTradeIntelligence/valuation/tradeValuationFixtures';
import type { AflTradeValuationOutputInventoryVerifyInput } from '@/server/aflTradeIntelligence/valuation/valuationOutputInventory';

const ASSESSED_AT = '2026-08-05T04:30:00.000Z';
const sha = (value: unknown) => sha256AflTradeCanonicalJson(value);

function club(input: { aflClubId: string; clubName: string }) {
  return { clubId: input.aflClubId, name: input.clubName, abbreviation: null };
}

function archiveFor(
  fixtureKind: AflTradeValuationFixtureKind,
  valuationCase: AflTradeValuationOutputInventoryVerifyInput['valuationCase']['valuationCase'],
  componentDrawSet: ReturnType<typeof createAflTradeComponentDrawSet>
) {
  const transactionVersionId = `event-version:${sha({ tradeId: valuationCase.content.tradeId })}`;
  const records: AflTradePromotionBackedPublicArchiveRecordInput[] = [
    {
      recordKind: 'transaction',
      recordId: transactionVersionId,
      eventId: valuationCase.content.tradeId,
      eventVersionId: transactionVersionId,
      seasonYear: 2024,
      occurredOn: valuationCase.content.tradeEffectiveAt.slice(0, 10),
      officialName: `Fixture ${fixtureKind}`,
      transactionType: 'trade',
      parties: [...valuationCase.content.parties].reverse().map((party, index) => ({
        club: club(party),
        role: 'party',
        ordinal: index + 1,
      })),
    },
  ];
  for (const [receiverIndex, party] of valuationCase.content.parties.entries()) {
    const fromParty =
      valuationCase.content.parties[
        (receiverIndex + valuationCase.content.parties.length - 1) %
          valuationCase.content.parties.length
      ]!;
    for (const assetId of party.receivedRootAssetIds) {
      const componentAsset = componentDrawSet.content.assets.find(
        (asset) => asset.assetId === assetId
      );
      if (!componentAsset) throw new Error('Assessment fixture component asset is missing.');
      const assetKind =
        componentAsset.assetKind === 'player'
          ? ('player' as const)
          : componentAsset.assetKind === 'future_pick_entitlement'
            ? ('future_pick' as const)
            : ('current_pick' as const);
      records.push({
        recordKind: 'transfer',
        recordId: assetId,
        assetVersionId: assetId,
        eventVersionId: transactionVersionId,
        assetKey: assetId,
        assetKind,
        rawDescription: assetId,
        player:
          assetKind === 'player' ? { playerId: assetId, displayName: `Player ${assetId}` } : null,
        pick:
          assetKind === 'player'
            ? null
            : {
                pickId: assetId,
                draftSeasonYear: 2025,
                draftKind: 'national_draft',
                nominalRound: 1,
                nominalPick: 14 + receiverIndex,
                originalClub: club(fromParty),
              },
        fromClub: club(fromParty),
        toClub: club(party),
      });
    }
  }
  const promotionSha256 = sha({ fixtureKind, records });
  const promotionId = `external-canonical-promotion:${promotionSha256}`;
  const canonicalMembers = records.map((record) => ({
    recordKind: record.recordKind,
    canonicalRecordId: record.recordId,
    canonicalRecordSha256: sha(record),
  }));
  const corpus = createAflTradePromotionBackedCorpus({
    environment: 'test_fixture',
    competition: 'AFLM',
    createdAt: '2026-08-05T03:50:00.000Z',
    knowledgeCutoffAt: '2026-08-05T03:40:00.000Z',
    promotions: [
      {
        promotionId,
        promotionSha256,
        anchorSeasonYear: 2025,
        finalizedAt: '2026-08-05T03:30:00.000Z',
        promotionRecordCount: records.length,
      },
    ],
    members: records.map((record, index) => ({
      promotionId,
      recordKind: record.recordKind,
      sourceRecordId: `source:${fixtureKind}:${index + 1}`,
      canonicalRecordId: record.recordId,
      recordSha256: canonicalMembers[index]!.canonicalRecordSha256,
    })),
  });
  const candidate = createAflTradePromotionBackedFactualRelease({
    corpus,
    scopeKey: 'public-afl-draft-trade-outcomes',
    createdAt: '2026-08-05T04:00:00.000Z',
    effectiveThrough: corpus.content.knowledgeCutoffAt,
    sourceCaptures: [
      {
        captureId: `capture:${fixtureKind}`,
        sourceSnapshotId: `source-snapshot:${sha({ fixtureKind })}`,
        rightsArtifactId: `source-rights:${sha({ fixtureKind, kind: 'rights' })}`,
        gateDecisionId: `gate-decision:${sha({ fixtureKind, kind: 'gate' })}`,
        recordSha256: sha({ fixtureKind, kind: 'capture' }),
        recordedAt: '2026-08-05T03:40:00.000Z',
      },
    ],
    promotionSources: [{ promotionId, captureIds: [`capture:${fixtureKind}`] }],
    canonicalMembers,
  }).candidate;
  return createAflTradePromotionBackedPublicArchive({
    candidate,
    createdAt: ASSESSED_AT,
    records,
  });
}

export function createAflTradeCompleteAssessmentVerificationFixture(
  inventory: AflTradeValuationOutputInventoryVerifyInput,
  fixtureKind: AflTradeValuationFixtureKind = 'two_party_player_swap'
): AflTradeCompleteAssessmentV2VerificationInput {
  const fabricated = createFabricatedAflTradeValuationFixture(fixtureKind);
  const valuationBundleId = inventory.valuationBundle.valuationBundleManifest.valuationBundleId;
  const componentDrawSet = createAflTradeComponentDrawSet({
    ...structuredClone(fabricated.componentDrawSet.content),
    valuationBundleId,
  });
  const realizedContributionLedger = createAflTradeRealizedContributionLedger({
    ...structuredClone(fabricated.realizedContributionLedger.content),
    valuationBundleId,
  });
  const packagePolicy = createAflTradePackagePolicy({
    ...structuredClone(fabricated.packagePolicy.content),
    valuationBundleId,
  });
  const input = {
    archive: archiveFor(fixtureKind, inventory.valuationCase.valuationCase, componentDrawSet),
    valuationCase: inventory.valuationCase.valuationCase,
    lineageGraph: fabricated.lineageGraph,
    componentDrawSet,
    realizedContributionLedger,
    packagePolicy,
    valuationCalculation: inventory.valuationCalculation.valuationCalculation,
    selectedLayer: 'scarcityAdjusted' as const,
    valueUnit: {
      valueUnitId: inventory.valuationCase.valuationCase.content.valueUnitId,
      shortLabel: 'PAV',
      explanation: 'Estimated AFL contribution in the publication value unit.',
    },
    assessedAt: ASSESSED_AT,
  };
  return { assessmentInput: input, output: assessAuthenticatedCompleteAflTrade(input) };
}
