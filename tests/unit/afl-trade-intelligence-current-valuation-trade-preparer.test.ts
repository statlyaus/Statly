import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeCurrentValuationTradePreparer } from '@/server/aflTradeIntelligence/valuation/currentValuationTradePreparation';
import { createGovernedPrivateEvaluationAuthenticatedCalculationFixture } from '../testUtils/governedPrivateEvaluationAuthenticatedCalculationFixture';
import { createAflTradeCurrentValuationCohortFixture } from '../testUtils/currentValuationCohortFixture';

describe('current valuation trade preparation', () => {
  it('retains and registers exact constructed parents idempotently', async () => {
    const fixture = createGovernedPrivateEvaluationAuthenticatedCalculationFixture();
    const cohort = createAflTradeCurrentValuationCohortFixture();
    const artifact = createAflTradeCanonicalJsonArtifactRef(
      fixture.materializationManifest,
      fixture.materializationManifest.content.createdAt
    );
    const retained: string[] = [];
    const registered: string[] = [];
    const retainedParents = [
      {
        reference: fixture.materializationManifest.content.calculationInputArtifact,
        value: fixture.calculationInputPackage,
      },
      {
        reference: fixture.materializationManifest.content.inputTraceArtifact,
        value: fixture.trace,
      },
      {
        reference: fixture.materializationManifest.content.explanationPolicyArtifact,
        value: fixture.explanationPolicy,
      },
      {
        reference: fixture.materializationManifest.content.lineageGraphArtifact,
        value: fixture.lineageGraph,
      },
      {
        reference: fixture.materializationManifest.content.pickBenchmarks[0]!.artifact,
        value: fixture.pickBenchmarks[0],
      },
    ].map(({ reference, value }) => ({
      reference,
      bytes: new TextEncoder().encode(canonicalizeAflTradeJson(value)),
    }));
    const preparer = createAflTradeCurrentValuationTradePreparer({
      construct: async () => ({
        state: 'ready',
        manifest: fixture.materializationManifest,
        manifestArtifact: artifact,
        retainedParents,
      }),
      retainArtifact: async ({ reference }) => {
        retained.push(reference.artifactId);
        return reference;
      },
      registerManifest: async ({ manifest, artifact: registeredArtifact }) => {
        registered.push(manifest.manifestId);
        return { manifest, artifact: registeredArtifact };
      },
    });

    const input = {
      context: {
        ...cohort.context,
        scopeKey: fixture.materializationManifest.content.selector.valuationScopeKey,
        factualReleaseId: fixture.trace.content.factualReleaseId,
        releaseTradeIds: [fixture.materializationManifest.content.selector.tradeId],
        playerRunId: fixture.trace.content.components.find(
          ({ role }) => role === 'player_contribution_and_availability'
        )!.runId,
        pickRunId: fixture.trace.content.components.find(
          ({ role }) => role === 'draft_pick_and_future_pick_distribution'
        )!.runId,
        valuationInputBundleId: fixture.trace.content.valuationInputBundleId,
      },
      tradeId: fixture.materializationManifest.content.selector.tradeId,
    };
    const first = await preparer.prepare(input);
    const replay = await preparer.prepare(input);

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      tradeId: input.tradeId,
      state: 'ready',
      materializationManifestId: fixture.materializationManifest.manifestId,
      materializationManifestArtifact: artifact,
    });
    const expectedRetention = [
      ...retainedParents
        .map(({ reference }) => reference.artifactId)
        .sort((left, right) => left.localeCompare(right)),
      artifact.artifactId,
    ];
    expect(retained).toEqual([...expectedRetention, ...expectedRetention]);
    expect(registered).toEqual([
      fixture.materializationManifest.manifestId,
      fixture.materializationManifest.manifestId,
    ]);
  });

  it('rejects retained construction from a stale captured release before retention', async () => {
    const fixture = createGovernedPrivateEvaluationAuthenticatedCalculationFixture();
    const cohort = createAflTradeCurrentValuationCohortFixture();
    const manifestArtifact = createAflTradeCanonicalJsonArtifactRef(
      fixture.materializationManifest,
      fixture.materializationManifest.content.createdAt
    );
    const retainedParents = [
      [
        fixture.materializationManifest.content.calculationInputArtifact,
        fixture.calculationInputPackage,
      ],
      [fixture.materializationManifest.content.inputTraceArtifact, fixture.trace],
      [
        fixture.materializationManifest.content.explanationPolicyArtifact,
        fixture.explanationPolicy,
      ],
      [fixture.materializationManifest.content.lineageGraphArtifact, fixture.lineageGraph],
      [
        fixture.materializationManifest.content.pickBenchmarks[0]!.artifact,
        fixture.pickBenchmarks[0],
      ],
    ].map(([reference, value]) => ({
      reference: reference!,
      bytes: new TextEncoder().encode(canonicalizeAflTradeJson(value)),
    }));
    const retainArtifact = vi.fn(async ({ reference }) => reference);
    const preparer = createAflTradeCurrentValuationTradePreparer({
      construct: async () => ({
        state: 'ready',
        manifest: fixture.materializationManifest,
        manifestArtifact,
        retainedParents,
      }),
      retainArtifact,
      registerManifest: async ({ manifest, artifact }) => ({ manifest, artifact }),
    });

    await expect(
      preparer.prepare({
        context: {
          ...cohort.context,
          scopeKey: fixture.trace.content.selector.valuationScopeKey,
          releaseTradeIds: [fixture.trace.content.selector.tradeId],
          valuationInputBundleId: fixture.trace.content.valuationInputBundleId,
          playerRunId: fixture.trace.content.components.find(
            ({ role }) => role === 'player_contribution_and_availability'
          )!.runId,
          pickRunId: fixture.trace.content.components.find(
            ({ role }) => role === 'draft_pick_and_future_pick_distribution'
          )!.runId,
        },
        tradeId: fixture.trace.content.selector.tradeId,
      })
    ).rejects.toThrow(/captured release, model, or bundle authority/u);
    expect(retainArtifact).not.toHaveBeenCalled();
  });
});
