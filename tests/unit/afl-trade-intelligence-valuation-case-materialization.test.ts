import { describe, expect, it } from 'vitest';

import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradePromotionBackedCorpus } from '@/server/aflTradeIntelligence/artifacts/promotionBackedCorpusContracts';
import { createAflTradePromotionBackedFactualRelease } from '@/server/aflTradeIntelligence/outcomes/promotionBackedFactualReleaseContracts';
import {
  createAflTradePromotionBackedPublicArchive,
  type AflTradePromotionBackedPublicArchiveRecordInput,
} from '@/server/aflTradeIntelligence/outcomes/promotionBackedPublicArchiveContracts';
import { createFabricatedAflTradeValuationFixture } from '@/server/aflTradeIntelligence/valuation/tradeValuationFixtures';
import { assessAuthenticatedCompleteAflTrade } from '@/server/aflTradeIntelligence/valuation/completeTradeAssessment';
import {
  AflTradeValuationCaseMaterializationError,
  materializeAflTradeValuationCase,
} from '@/server/aflTradeIntelligence/valuation/valuationCaseMaterialization';

const CREATED_AT = '2026-08-10T00:00:04.000Z';
const sha = (value: unknown) => sha256AflTradeCanonicalJson(value);

type Fixture = ReturnType<typeof createFabricatedAflTradeValuationFixture>;

function club(party: Fixture['valuationCase']['content']['parties'][number]) {
  return {
    clubId: party.aflClubId,
    name: party.clubName,
    abbreviation: null,
  };
}

function archiveRecords(fixture: Fixture): AflTradePromotionBackedPublicArchiveRecordInput[] {
  const parties = [...fixture.valuationCase.content.parties].reverse();
  const transactionVersionId = `event-version:${sha({
    tradeId: fixture.valuationCase.content.tradeId,
  })}`;
  const records: AflTradePromotionBackedPublicArchiveRecordInput[] = [
    {
      recordKind: 'transaction',
      recordId: transactionVersionId,
      eventId: fixture.valuationCase.content.tradeId,
      eventVersionId: transactionVersionId,
      seasonYear: 2024,
      occurredOn: fixture.valuationCase.content.tradeEffectiveAt.slice(0, 10),
      officialName: `Fixture ${fixture.fixtureKind}`,
      transactionType: 'trade',
      parties: parties.map((party, index) => ({
        club: club(party),
        role: 'party',
        ordinal: index + 1,
      })),
    },
  ];
  for (const [receiverIndex, party] of fixture.valuationCase.content.parties.entries()) {
    const fromParty =
      fixture.valuationCase.content.parties[
        (receiverIndex + fixture.valuationCase.content.parties.length - 1) %
          fixture.valuationCase.content.parties.length
      ]!;
    for (const assetId of party.receivedRootAssetIds) {
      const componentAsset = fixture.componentDrawSet.content.assets.find(
        (asset) => asset.assetId === assetId
      );
      if (!componentAsset) throw new Error('Fixture component asset is missing.');
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
  return records;
}

function archiveFor(fixture: Fixture, records = archiveRecords(fixture)) {
  const promotionSha256 = sha({
    fixtureKind: fixture.fixtureKind,
    records,
  });
  const promotionId = `external-canonical-promotion:${promotionSha256}`;
  const canonicalMembers = records.map((record) => ({
    recordKind: record.recordKind,
    canonicalRecordId: record.recordId,
    canonicalRecordSha256: sha(record),
  }));
  const corpus = createAflTradePromotionBackedCorpus({
    environment: 'test_fixture',
    competition: 'AFLM',
    createdAt: '2026-08-10T00:00:02.000Z',
    knowledgeCutoffAt: '2026-08-10T00:00:01.000Z',
    promotions: [
      {
        promotionId,
        promotionSha256,
        anchorSeasonYear: 2025,
        finalizedAt: '2026-08-10T00:00:00.000Z',
        promotionRecordCount: records.length,
      },
    ],
    members: records.map((record, index) => ({
      promotionId,
      recordKind: record.recordKind,
      sourceRecordId: `source:${fixture.fixtureKind}:${index + 1}`,
      canonicalRecordId: record.recordId,
      recordSha256: canonicalMembers[index]!.canonicalRecordSha256,
    })),
  });
  const candidate = createAflTradePromotionBackedFactualRelease({
    corpus,
    scopeKey: 'public-afl-draft-trade-outcomes',
    createdAt: '2026-08-10T00:00:03.000Z',
    effectiveThrough: corpus.content.knowledgeCutoffAt,
    sourceCaptures: [
      {
        captureId: `capture:${fixture.fixtureKind}`,
        sourceSnapshotId: `source-snapshot:${sha({ fixture: fixture.fixtureKind })}`,
        rightsArtifactId: `source-rights:${sha({ rights: fixture.fixtureKind })}`,
        gateDecisionId: `gate-decision:${sha({ gate: fixture.fixtureKind })}`,
        recordSha256: sha({ capture: fixture.fixtureKind }),
        recordedAt: '2026-08-10T00:00:01.000Z',
      },
    ],
    promotionSources: [{ promotionId, captureIds: [`capture:${fixture.fixtureKind}`] }],
    canonicalMembers,
  }).candidate;
  return createAflTradePromotionBackedPublicArchive({
    candidate,
    createdAt: CREATED_AT,
    records,
  });
}

function materialize(fixture: Fixture, records = archiveRecords(fixture)) {
  return materializeAflTradeValuationCase({
    archive: archiveFor(fixture, records),
    tradeId: fixture.valuationCase.content.tradeId,
    lineageGraph: fixture.lineageGraph,
    componentDrawSet: fixture.componentDrawSet,
    realizedContributionLedger: fixture.realizedContributionLedger,
    packagePolicy: fixture.packagePolicy,
    viewContexts: fixture.valuationCase.content.viewContexts,
  });
}

describe('AFL trade valuation-case materialization', () => {
  it.each(['two_party_player_swap', 'three_party_exchange'] as const)(
    'derives the exact complete %s exchange independently of source party order',
    (fixtureKind) => {
      const fixture = createFabricatedAflTradeValuationFixture(fixtureKind);

      const result = materialize(fixture);

      expect(result).toEqual(fixture.valuationCase);
      expect(result.content.parties.flatMap((party) => party.receivedRootAssetIds).sort()).toEqual(
        fixture.componentDrawSet.content.assets.map((asset) => asset.assetId).sort()
      );
    }
  );

  it('fails closed when the factual exchange omits a modeled asset', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const records = archiveRecords(fixture);
    const omitted = records.filter(
      (record, index) => record.recordKind !== 'transfer' || index !== records.length - 1
    );

    expect(() => materialize(fixture, omitted)).toThrowError(
      expect.objectContaining<Partial<AflTradeValuationCaseMaterializationError>>({
        code: 'INCOMPLETE_EXCHANGE',
      })
    );
  });

  it('fails closed when a factual transfer is credited to the wrong receiving club', () => {
    const fixture = createFabricatedAflTradeValuationFixture('two_party_player_swap');
    const records = archiveRecords(fixture);
    const transfers = records.filter((record) => record.recordKind === 'transfer');
    const changed = records.map((record) =>
      record === transfers[0]
        ? {
            ...record,
            toClub: transfers[1]!.toClub,
            fromClub: transfers[1]!.fromClub,
          }
        : record
    );

    expect(() => materialize(fixture, changed)).toThrowError(
      expect.objectContaining<Partial<AflTradeValuationCaseMaterializationError>>({
        code: 'LINEAGE_MISMATCH',
      })
    );
  });

  it('assesses the directed three-party exchange from received minus surrendered value', () => {
    const fixture = createFabricatedAflTradeValuationFixture('three_party_exchange');
    const parties = fixture.valuationCase.content.parties;
    const records = archiveRecords(fixture).map((record) => {
      if (record.recordKind !== 'transfer') return record;
      const receivingIndex = parties.findIndex(
        ({ aflClubId }) => aflClubId === record.toClub.clubId
      );
      const surrenderingParty = parties[(receivingIndex + 1) % parties.length]!;
      return { ...record, fromClub: club(surrenderingParty) };
    });
    const archive = archiveFor(fixture, records);
    const valuationCase = materializeAflTradeValuationCase({
      archive,
      tradeId: fixture.valuationCase.content.tradeId,
      lineageGraph: fixture.lineageGraph,
      componentDrawSet: fixture.componentDrawSet,
      realizedContributionLedger: fixture.realizedContributionLedger,
      packagePolicy: fixture.packagePolicy,
      viewContexts: fixture.valuationCase.content.viewContexts,
    });

    const assessment = assessAuthenticatedCompleteAflTrade({
      archive,
      valuationCase,
      lineageGraph: fixture.lineageGraph,
      componentDrawSet: fixture.componentDrawSet,
      realizedContributionLedger: fixture.realizedContributionLedger,
      packagePolicy: fixture.packagePolicy,
      valuationCalculation: fixture.calculation,
      selectedLayer: 'scarcityAdjusted',
      valueUnit: {
        valueUnitId: fixture.valuationCase.content.valueUnitId,
        shortLabel: 'PAV',
        explanation: 'Estimated AFL contribution in the publication value unit.',
      },
      assessedAt: CREATED_AT,
    });

    const clubB = assessment.content.partyAssessments.find(
      ({ clubId }) => clubId === 'fixture-club-b'
    );
    const clubC = assessment.content.partyAssessments.find(
      ({ clubId }) => clubId === 'fixture-club-c'
    );
    expect(assessment.content.schemaVersion).toBe('afl-trade-complete-assessment/v2');
    expect(clubB?.views.map(({ view }) => view)).toEqual([
      'at_trade',
      'realized',
      'remaining',
      'current',
    ]);
    expect(clubB?.views.find(({ view }) => view === 'at_trade')).toMatchObject({
      received: { median: 12 },
      givenUp: { median: 6 },
      netAdvantage: { median: 6 },
      finishAheadProbability: 0.5,
    });
    expect(clubC?.views.find(({ view }) => view === 'at_trade')?.finishAheadProbability).toBe(0.5);
    expect(assessment.content.viewVerdicts).toEqual([
      {
        view: 'at_trade',
        kind: 'shared_lead',
        clubIds: ['fixture-club-b', 'fixture-club-c'],
      },
      expect.objectContaining({ view: 'realized' }),
      expect.objectContaining({ view: 'remaining' }),
      expect.objectContaining({ view: 'current' }),
    ]);
    expect(assessment.content.source).toEqual({
      archiveId: archive.archiveId,
      valuationCaseId: valuationCase.valuationCaseId,
      valuationCalculationId: fixture.calculation.valuationCalculationId,
      selectedLayer: 'scarcityAdjusted',
    });
  });
});
