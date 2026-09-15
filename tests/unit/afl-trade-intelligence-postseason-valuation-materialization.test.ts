import { createAflTradeLineageGraphId } from '@/server/aflTradeIntelligence/valuation/valuationCaseContracts';
import { createAflTradeRealizedContributionLedger } from '@/server/aflTradeIntelligence/valuation/realizedContributionLedger';
import { beforeEach, expect, it, vi } from 'vitest';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradePostseasonYearContext } from '@/server/aflTradeIntelligence/domain/postseasonYearContext';
import { createAflTradePostseasonMaterializationReview } from '@/server/aflTradeIntelligence/modeling/postseasonMaterializationReview';
import { materializeAflTradePostseasonValuation } from '@/server/aflTradeIntelligence/valuation/postgresPostseasonValuationMaterialization';
import { postseasonValuationParentsSchema } from '@/server/aflTradeIntelligence/valuation/postseasonValuationParents';
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

function fixture(yearOnly = false) {
  const source = createFabricatedAflTradeValuationFixture('two_party_player_swap');
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
  const parties = source.valuationCase.content.parties;
  const transfers = parties.flatMap((party, i) =>
    party.receivedRootAssetIds.map((assetId) => ({
      recordKind: 'transfer',
      eventVersionId: review.content.eventVersionId,
      assetVersionId: assetId,
      assetKind: 'player',
      fromClub: { clubId: parties[(i + 1) % parties.length]!.aflClubId },
      toClub: { clubId: party.aflClubId },
    }))
  );
  const archive = {
    content: {
      records: [
        {
          record: {
            recordKind: 'transaction',
            eventId: review.content.tradeId,
            eventVersionId: review.content.eventVersionId,
            seasonYear: 2024,
            occurredOn: review.content.tradeDate,
            parties: parties.map((party) => ({
              club: { clubId: party.aflClubId, name: party.clubName },
            })),
          },
        },
        ...transfers.map((record) => ({ record })),
      ],
    },
  };
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
  return { source, review, context, transfers, retained, retain, observation, query, run };
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
