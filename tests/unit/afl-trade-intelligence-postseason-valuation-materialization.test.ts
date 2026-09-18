import { createAflTradeLineageGraphId } from '@/server/aflTradeIntelligence/valuation/valuationCaseContracts';
import { createAflTradeRealizedContributionLedger } from '@/server/aflTradeIntelligence/valuation/realizedContributionLedger';
import { beforeEach, expect, it, vi } from 'vitest';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradePromotionBackedCorpus } from '@/server/aflTradeIntelligence/artifacts/promotionBackedCorpusContracts';
import { createAflTradePostseasonYearContext } from '@/server/aflTradeIntelligence/domain/postseasonYearContext';
import { createAflTradePostseasonMaterializationReview } from '@/server/aflTradeIntelligence/modeling/postseasonMaterializationReview';
import { createAflTradePromotionBackedFactualRelease } from '@/server/aflTradeIntelligence/outcomes/promotionBackedFactualReleaseContracts';
import {
  createAflTradePromotionBackedPublicArchive,
  type AflTradePromotionBackedPublicArchiveRecordInput,
} from '@/server/aflTradeIntelligence/outcomes/promotionBackedPublicArchiveContracts';
import { assessAuthenticatedCompleteAflTrade } from '@/server/aflTradeIntelligence/valuation/completeTradeAssessment';
import { materializeAflTradePostseasonValuation } from '@/server/aflTradeIntelligence/valuation/postgresPostseasonValuationMaterialization';
import { postseasonValuationParentsSchema } from '@/server/aflTradeIntelligence/valuation/postseasonValuationParents';
import { calculateAflTradeValuation } from '@/server/aflTradeIntelligence/valuation/tradeValuationCalculation';
import { createFabricatedAflTradeValuationFixture } from '@/server/aflTradeIntelligence/valuation/tradeValuationFixtures';

// SQL authority readers have separate PostgreSQL coverage. These tests isolate case assembly.
const owners = vi.hoisted(() => ({ observation: vi.fn(), archive: vi.fn() }));
vi.mock(
  '@/server/aflTradeIntelligence/modeling/postgresPostseasonObservationMaterialization',
  () => ({ materializeAflTradePostseasonObservation: owners.observation })
);
vi.mock(
  '@/server/aflTradeIntelligence/outcomes/postgresPromotionBackedPublicArchiveRepository',
  () => ({ loadAflTradePromotionBackedArchiveFromRelease: owners.archive })
);
beforeEach(() => vi.clearAllMocks());
const at = '2026-09-01T00:00:00.000Z';
const id = (kind: string) => `${kind}:${'a'.repeat(64)}`;
const sha = (value: unknown) => sha256AflTradeCanonicalJson(value);

function sealedArchive(
  source: ReturnType<typeof createFabricatedAflTradeValuationFixture>,
  eventVersionId: string,
  tradeDate: string | null,
  promotionId: string,
  futurePickDraftYear: number
) {
  const parties = source.valuationCase.content.parties;
  const club = (party: (typeof parties)[number]) => ({
    clubId: party.aflClubId,
    name: party.clubName,
    abbreviation: null,
  });
  const records: AflTradePromotionBackedPublicArchiveRecordInput[] = [
    {
      recordKind: 'transaction',
      recordId: eventVersionId,
      eventId: source.valuationCase.content.tradeId,
      eventVersionId,
      seasonYear: 2024,
      occurredOn: tradeDate,
      officialName: 'Synthetic postseason valuation trade',
      transactionType: 'trade',
      parties: parties.map((party, index) => ({
        club: club(party),
        role: 'party',
        ordinal: index + 1,
      })),
    },
  ];
  for (const [receiverIndex, party] of parties.entries()) {
    const sender = parties[(receiverIndex + 1) % parties.length]!;
    for (const assetId of party.receivedRootAssetIds) {
      const component = source.componentDrawSet.content.assets.find(
        (asset) => asset.assetId === assetId
      );
      if (!component) throw new Error('Fixture component asset is missing.');
      const assetKind =
        component.assetKind === 'player'
          ? ('player' as const)
          : component.assetKind === 'future_pick_entitlement'
            ? ('future_pick' as const)
            : ('current_pick' as const);
      records.push({
        recordKind: 'transfer',
        recordId: assetId,
        assetVersionId: assetId,
        eventVersionId,
        assetKey: assetId,
        assetKind,
        rawDescription: `Fixture ${assetId}`,
        player:
          assetKind === 'player' ? { playerId: assetId, displayName: `Player ${assetId}` } : null,
        pick:
          assetKind === 'player'
            ? null
            : {
                pickId: assetId,
                draftSeasonYear: assetKind === 'future_pick' ? futurePickDraftYear : 2025,
                draftKind: 'national_draft',
                nominalRound: 1,
                nominalPick: 10 + receiverIndex,
                originalClub: club(sender),
              },
        fromClub: club(sender),
        toClub: club(party),
      });
    }
  }
  const canonicalMembers = records.map((record) => ({
    recordKind: record.recordKind,
    canonicalRecordId: record.recordId,
    canonicalRecordSha256: sha(record),
  }));
  const corpus = createAflTradePromotionBackedCorpus({
    environment: 'test_fixture',
    competition: 'AFLM',
    createdAt: '2026-08-31T23:59:58.000Z',
    knowledgeCutoffAt: '2026-08-31T23:59:57.000Z',
    promotions: [
      {
        promotionId,
        promotionSha256: promotionId.slice('external-canonical-promotion:'.length),
        anchorSeasonYear: 2024,
        finalizedAt: '2026-08-31T23:59:56.000Z',
        promotionRecordCount: records.length,
      },
    ],
    members: records.map((record, index) => ({
      promotionId,
      recordKind: record.recordKind,
      sourceRecordId: `source:postseason:${index + 1}`,
      canonicalRecordId: record.recordId,
      recordSha256: canonicalMembers[index]!.canonicalRecordSha256,
    })),
  });
  const candidate = createAflTradePromotionBackedFactualRelease({
    corpus,
    scopeKey: 'synthetic-case',
    createdAt: '2026-08-31T23:59:59.000Z',
    effectiveThrough: corpus.content.knowledgeCutoffAt,
    sourceCaptures: [
      {
        captureId: 'capture:postseason',
        sourceSnapshotId: `source-snapshot:${sha({ source: 'postseason' })}`,
        rightsArtifactId: `source-rights:${sha({ rights: 'postseason' })}`,
        gateDecisionId: `gate-decision:${sha({ gate: 'postseason' })}`,
        recordSha256: sha({ capture: 'postseason' }),
        recordedAt: '2026-08-31T23:59:57.000Z',
      },
    ],
    promotionSources: [{ promotionId, captureIds: ['capture:postseason'] }],
    canonicalMembers,
  }).candidate;
  return createAflTradePromotionBackedPublicArchive({ candidate, createdAt: at, records });
}

function fixture(
  yearOnly = false,
  fixtureKind: Parameters<
    typeof createFabricatedAflTradeValuationFixture
  >[0] = 'two_party_player_swap',
  futurePickDraftYear = 2025
) {
  const source = createFabricatedAflTradeValuationFixture(fixtureKind);
  const retained = new Map<string, Uint8Array>();
  const retain = (value: unknown) => {
    const ref = createAflTradeCanonicalJsonArtifactRef(value, at);
    retained.set(ref.artifactId, new TextEncoder().encode(canonicalizeAflTradeJson(value)));
    return ref;
  };
  const evidence = { read: async (ref: { artifactId: string }) => retained.get(ref.artifactId)! };
  const review = createAflTradePostseasonMaterializationReview({
    schemaVersion: 'afl-trade-postseason-materialization-review/v2',
    authorityBoundary: 'private_factual_materialization_no_numerical_admission',
    environment: 'test_fixture',
    competition: 'AFLM',
    scopeKey: 'synthetic-case',
    releaseId: id('outcome-release'),
    spellVersionId: id('acquisition-spell-version'),
    tradeId: source.valuationCase.content.tradeId,
    promotionId: id('external-canonical-promotion'),
    eventVersionId: 'synthetic-event',
    tradeYear: 2024,
    tradeDate: yearOnly ? null : source.valuationCase.content.tradeEffectiveAt.slice(0, 10),
    period: 'established_postseason',
    reviewEvidence: retain({ synthetic: true }),
    createdAt: at,
    valuation: {
      componentDrawSetArtifact: retain(source.componentDrawSet),
      realizedContributionLedgerArtifact: retain(source.realizedContributionLedger),
      packagePolicyArtifact: retain(source.packagePolicy),
      lineageGraphArtifact: retain(source.lineageGraph),
      laterEffectiveAt: at,
    },
  });
  const context = createAflTradePostseasonYearContext({
    schemaVersion: 'afl-trade-postseason-year-context/v1',
    environment: 'test_fixture',
    competition: 'AFLM',
    tradeId: review.content.tradeId,
    promotionId: review.content.promotionId,
    eventVersionId: review.content.eventVersionId,
    tradeYear: 2024,
    tradeDate: review.content.tradeDate,
    period: 'established_postseason',
    reviewDecisionId: 'synthetic-reviewed-case',
    reviewEvidence: review.content.reviewEvidence,
    recordedAt: at,
    knowledgeCutoffAt: at,
    knowledgePolicy: 'retrospective_as_recorded_by_dataset_creation',
  });
  const archive = sealedArchive(
    source,
    review.content.eventVersionId,
    review.content.tradeDate,
    review.content.promotionId,
    futurePickDraftYear
  );
  const transfers = archive.content.records
    .map(({ record }) => record)
    .filter((record) => record.recordKind === 'transfer');
  const selection = {
    context,
    review,
    release: { releaseId: review.content.releaseId, content: { createdAt: at } },
  };
  const observation = { selection, observation: { content: { context } }, coverageBindings: [] };
  owners.observation.mockResolvedValue(observation);
  owners.archive.mockResolvedValue(archive);
  const query = vi.fn().mockResolvedValue({
    rows: transfers.map((t) => ({ asset_version_id: t.assetVersionId })),
    rowCount: transfers.length,
  });
  const run = () =>
    materializeAflTradePostseasonValuation(
      { query },
      {},
      { loadMethod: vi.fn() } as never,
      evidence
    );
  return { source, review, context, archive, transfers, retained, retain, observation, query, run };
}

it.each([false, true])(
  'binds complete canonical parties to the same context, yearOnly=%s',
  async (yearOnly) => {
    const f = fixture(yearOnly);
    const result = await f.run();
    expect(result.valuationParents).toEqual({
      componentDrawSet: f.source.componentDrawSet,
      realizedContributionLedger: f.source.realizedContributionLedger,
      packagePolicy: f.source.packagePolicy,
      lineageGraph: f.source.lineageGraph,
    });
    expect(result.valuationCase.content.context).toEqual(f.context);
    expect(result.valuationCase.content.parties).toEqual(f.source.valuationCase.content.parties);
    expect(result.valuationCase.content.outcomeSeasons).toEqual([2025, 2026, 2027]);
    expect(result.valuationCase.content.context.content.tradeDate).toBe(f.review.content.tradeDate);
    expect(await f.run()).toEqual(result);
  }
);
it.each([false, true])(
  'replays a postseason case through calculation and complete assessment, yearOnly=%s',
  async (yearOnly) => {
    const f = fixture(yearOnly);
    const result = await f.run();
    const calculation = calculateAflTradeValuation(
      result.valuationCase,
      result.valuationParents.componentDrawSet,
      result.valuationParents.realizedContributionLedger,
      result.valuationParents.packagePolicy
    );
    const assessmentInput = {
      archive: f.archive,
      valuationCase: result.valuationCase,
      lineageGraph: result.valuationParents.lineageGraph,
      componentDrawSet: result.valuationParents.componentDrawSet,
      realizedContributionLedger: result.valuationParents.realizedContributionLedger,
      packagePolicy: result.valuationParents.packagePolicy,
      valuationCalculation: calculation,
      selectedLayer: 'scarcityAdjusted' as const,
      valueUnit: {
        valueUnitId: result.valuationCase.content.valueUnitId,
        shortLabel: 'PAV',
        explanation: 'Estimated AFL contribution in the publication value unit.',
      },
      assessedAt: at,
    };
    const assessment = assessAuthenticatedCompleteAflTrade(assessmentInput);

    expect(result.valuationCase.content).not.toHaveProperty('tradeEffectiveAt');
    expect(result.valuationCase.content).not.toHaveProperty('viewContexts');
    expect(calculation.content.draws).toEqual(f.source.calculation.content.draws);
    expect(calculation.valuationCalculationId).not.toBe(
      f.source.calculation.valuationCalculationId
    );
    expect(assessment.content.source).toMatchObject({
      archiveId: f.archive.archiveId,
      valuationCaseId: result.valuationCase.valuationCaseId,
      valuationCalculationId: calculation.valuationCalculationId,
    });
    expect(assessment.content.partyAssessments[0]?.views.map(({ view }) => view)).toEqual([
      'at_trade',
      'realized',
      'remaining',
      'current',
    ]);
    expect(assessAuthenticatedCompleteAflTrade(assessmentInput)).toEqual(assessment);
    expect(() =>
      assessAuthenticatedCompleteAflTrade({
        ...assessmentInput,
        assessedAt: '2026-08-31T23:59:59.999Z',
      })
    ).toThrow('cannot predate the valuation evidence');
  }
);
it('supports an authenticated future pick whose draft year is inside the original horizon', async () => {
  const f = fixture(false, 'future_pick_resolution');
  const result = await f.run();
  const calculation = calculateAflTradeValuation(
    result.valuationCase,
    result.valuationParents.componentDrawSet,
    result.valuationParents.realizedContributionLedger,
    result.valuationParents.packagePolicy
  );
  expect(
    assessAuthenticatedCompleteAflTrade({
      archive: f.archive,
      valuationCase: result.valuationCase,
      lineageGraph: result.valuationParents.lineageGraph,
      componentDrawSet: result.valuationParents.componentDrawSet,
      realizedContributionLedger: result.valuationParents.realizedContributionLedger,
      packagePolicy: result.valuationParents.packagePolicy,
      valuationCalculation: calculation,
      selectedLayer: 'scarcityAdjusted',
      valueUnit: {
        valueUnitId: result.valuationCase.content.valueUnitId,
        shortLabel: 'PAV',
        explanation: 'Estimated AFL contribution in the publication value unit.',
      },
      assessedAt: at,
    }).content.source.valuationCaseId
  ).toBe(result.valuationCase.valuationCaseId);
});
it('rejects a supported future pick whose draft year is outside the original horizon', async () => {
  await expect(fixture(false, 'future_pick_resolution', 2028).run()).rejects.toThrow(
    'future picks require a draft year inside the original horizon'
  );
});
it('rejects incomplete current transfer authority', async () => {
  const f = fixture();
  f.query.mockResolvedValue({ rows: [], rowCount: 0 });
  await expect(f.run()).rejects.toThrow('transfer authority is incomplete');
});
it('rejects changed retained parent bytes', async () => {
  const f = fixture();
  if (f.review.content.schemaVersion !== 'afl-trade-postseason-materialization-review/v2')
    throw new Error();
  f.retained.set(
    f.review.content.valuation.componentDrawSetArtifact.artifactId,
    new TextEncoder().encode('{}')
  );
  await expect(f.run()).rejects.toThrow('parent bytes differ');
});
it('rejects caller substitution of the selected event', async () => {
  const f = fixture();
  f.observation.selection.review.content.eventVersionId = 'another-event';
  await expect(f.run()).rejects.toThrow('trade differs');
});

it('rejects retained parents with an invalid lineage even when the case is not executed', async () => {
  const result = await fixture().run();
  const parents = structuredClone(result.valuationParents);
  parents.lineageGraph.assets.push({ ...parents.lineageGraph.assets[0]! });
  expect(() => postseasonValuationParentsSchema.parse(parents)).toThrow();
});
it('rejects mixing separately valid retained model parents', async () => {
  const result = await fixture().run();
  const other = createFabricatedAflTradeValuationFixture('two_party_player_swap');
  const parents = structuredClone(result.valuationParents);
  // A resealed parent remains structurally valid but must not change the shared value unit.
  const { createAflTradePackagePolicy } =
    await import('@/server/aflTradeIntelligence/valuation/packagePolicy');
  parents.packagePolicy = createAflTradePackagePolicy({
    ...other.packagePolicy.content,
    valueUnitId: 'different-unit',
  });
  expect(() => postseasonValuationParentsSchema.parse(parents)).toThrow('one exact model');
});

it.each([false, true])('rejects reviewed custody contradictions, yearOnly=%s', async (yearOnly) => {
  for (const mismatch of ['sender', 'missing', 'expired', 'not-yet-known'] as const) {
    const f = fixture(yearOnly);
    const graph = structuredClone(f.source.lineageGraph);
    const transfer = f.transfers[0]!;
    const spell = graph.custodySpells.find((s) => s.assetId === transfer.assetVersionId)!;
    if (mismatch === 'sender') spell.aflClubId = transfer.fromClub.clubId;
    if (mismatch === 'missing')
      graph.custodySpells = graph.custodySpells.filter((s) => s !== spell);
    if (mismatch === 'expired') spell.effectiveFrom = '2024-01-01T00:00:00.000Z';
    if (mismatch === 'expired')
      spell.effectiveTo = yearOnly
        ? '2025-01-01T00:00:00.000Z'
        : f.source.valuationCase.content.tradeEffectiveAt;
    if (mismatch === 'not-yet-known') spell.knownFrom = '2027-01-01T00:00:00.000Z';
    const ledger = createAflTradeRealizedContributionLedger({
      ...f.source.realizedContributionLedger.content,
      lineageGraphId: createAflTradeLineageGraphId(graph),
    });
    if (f.review.content.schemaVersion !== 'afl-trade-postseason-materialization-review/v2')
      throw new Error();
    f.observation.selection.review = createAflTradePostseasonMaterializationReview({
      ...f.review.content,
      valuation: {
        ...f.review.content.valuation,
        lineageGraphArtifact: f.retain(graph),
        realizedContributionLedgerArtifact: f.retain(ledger),
      },
    });
    await expect(f.run(), mismatch).rejects.toThrow('lineage custody differs');
  }
});
