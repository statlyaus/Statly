import { describe, expect, it } from 'vitest';
import {
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { assessAflTradeConstructionCompatibility } from '@/server/aflTradeIntelligence/valuation/constructionCompatibility';
import { constructAflTradeCompatibleCurrentValuationTrade } from '@/server/aflTradeIntelligence/valuation/authenticatedCurrentValuationTradeConstruction';
import { createGovernedPrivateEvaluationAuthenticatedCalculationFixture } from '../testUtils/governedPrivateEvaluationAuthenticatedCalculationFixture';

const assessedAt = '2026-09-05T01:00:00.000Z';
function setup(change: Record<string, unknown> = {}) {
  const fixture = createGovernedPrivateEvaluationAuthenticatedCalculationFixture();
  const valuationCase = fixture.calculationInputPackage.content.valuationCase;
  const componentDrawSet = fixture.calculationInputPackage.content.componentDrawSet;
  const stored = new Map<string, { reference: AflTradeArtifactRef; bytes: Uint8Array }>();
  function retain(value: unknown) {
    const reference = createAflTradeCanonicalJsonArtifactRef(value, assessedAt);
    stored.set(reference.artifactId, {
      reference,
      bytes: new TextEncoder().encode(canonicalizeAflTradeJson(value)),
    });
    return reference;
  }
  const selectedRuns = {
    player: fixture.trace.content.components.find(
      (c) => c.role === 'player_contribution_and_availability'
    )!.runId,
    pick: fixture.trace.content.components.find(
      (c) => c.role === 'draft_pick_and_future_pick_distribution'
    )!.runId,
  };
  const year = Number(valuationCase.content.tradeEffectiveAt.slice(0, 4));
  const requirements = valuationCase.content.parties.flatMap((party) =>
    party.receivedRootAssetIds.flatMap((assetId) =>
      valuationCase.content.viewContexts.map((context) => {
        const assetKind = componentDrawSet.content.assets.find(
          (a) => a.assetId === assetId
        )!.assetKind;
        const binding = {
          assetId,
          view: context.view,
          runId: assetKind === 'player' ? selectedRuns.player : selectedRuns.pick,
          methodId: 'fixture-method',
          valueUnitId: valuationCase.content.valueUnitId,
          receivingClubId: party.aflClubId,
          receivingSpellId: assetKind === 'player' ? `spell:${assetId}` : null,
          seasons: [year + 2, year + 3, year + 4],
        };
        const evidence = retain({
          ...binding,
          schemaVersion: 'afl-trade-construction-compatibility-evidence/v1',
          environment: 'test_fixture',
          tradeId: valuationCase.content.tradeId,
          valuationInputBundleId: valuationCase.content.valuationInputBundleId,
          predictionCutoffAt: context.effectiveAt,
          knownAt: context.knowledgeCutoffAt,
          recordedAt: assessedAt,
          attribution: 'receiving_spell',
          pathway: assetKind === 'player' ? null : 'national',
          access: assetKind === 'player' ? null : 'open',
          draftYear: assetKind === 'player' ? null : year + 1,
          ...change,
        });
        return { ...binding, assetKind, evidence };
      })
    )
  );
  const policy = {
    schemaVersion: 'afl-trade-construction-compatibility-policy/v1',
    environment: 'test_fixture',
    tradeId: valuationCase.content.tradeId,
    valuationInputBundleId: valuationCase.content.valuationInputBundleId,
    requirements,
  };
  const repository: AflTradeImmutableArtifactRepository = {
    assurance: 'fixture_memory',
    artifactClass: 'derived_private',
    custodyProfile: null,
    async loadExact(reference) {
      return stored.get(reference.artifactId) ?? null;
    },
    async putIfAbsent() {
      throw new Error('Assessment must be read-only.');
    },
  };
  const request = {
    environment: 'test_fixture' as const,
    assessedAt,
    valuationCase,
    componentDrawSet,
    policyReference: retain(policy),
    selectedRuns,
    repository,
  };
  return { fixture, request, policy, retain, stored };
}
const reasons = (result: Awaited<ReturnType<typeof assessAflTradeConstructionCompatibility>>) =>
  result.issues.map((issue) => issue.reason);

describe('retained construction compatibility', () => {
  it('replays an exactly aligned fixture without granting qualification', async () => {
    const { request } = setup();
    const result = await assessAflTradeConstructionCompatibility(request);
    expect(result).toEqual({ state: 'compatible', qualificationGranted: false, issues: [] });
    expect(await assessAflTradeConstructionCompatibility(request)).toEqual(result);
  });
  it('rejects a December origin supplied to an earlier view and late knowledge', async () => {
    const { request } = setup({
      predictionCutoffAt: '2026-01-01T00:00:00.000Z',
      knownAt: '2026-01-01T00:00:00.000Z',
    });
    const result = await assessAflTradeConstructionCompatibility(request);
    expect(reasons(result)).toContain('origin_after_view');
    expect(reasons(result)).toContain('knowledge_after_cutoff');
    expect(result.issues.some((issue) => issue.view === 'at_trade')).toBe(true);
  });
  it.each([
    [{ attribution: 'across_spells' }, 'receiving_spell_mismatch'],
    [{ seasons: [2090, 2091, 2092] }, 'calendar_window_mismatch'],
    [{ access: 'restricted' }, 'pick_pathway_unsupported'],
    [{ pathway: 'other' }, 'pick_pathway_unsupported'],
    [{ draftYear: 2199 }, 'pick_window_before_debut'],
    [{ methodId: 'different-method' }, 'component_policy_mismatch'],
  ])('reports incompatible component semantics %j', async (change, reason) => {
    expect(reasons(await assessAflTradeConstructionCompatibility(setup(change).request))).toContain(
      reason
    );
  });
  it('reports missing references and missing retained evidence separately', async () => {
    const { request, policy, retain, stored } = setup();
    stored.delete(policy.requirements[0]!.evidence.artifactId);
    expect(reasons(await assessAflTradeConstructionCompatibility(request))).toContain(
      'evidence_missing'
    );
    request.policyReference = retain({
      ...policy,
      requirements: policy.requirements.map((item) => ({ ...item, evidence: null })),
    });
    expect(reasons(await assessAflTradeConstructionCompatibility(request))).toContain(
      'evidence_reference_missing'
    );
    stored.delete(request.policyReference.artifactId);
    expect(await assessAflTradeConstructionCompatibility(request)).toMatchObject({
      state: 'unavailable',
      reason: 'policy_missing',
    });
  });
  it('rejects tampered bytes, foreign scope and omitted asset/view requirements', async () => {
    const first = setup();
    first.stored.get(first.policy.requirements[0]!.evidence.artifactId)!.bytes =
      new TextEncoder().encode('{}');
    await expect(assessAflTradeConstructionCompatibility(first.request)).rejects.toThrow(
      'exact retained bytes'
    );
    await expect(
      assessAflTradeConstructionCompatibility(setup({ tradeId: 'foreign-trade' }).request)
    ).rejects.toThrow('different scope');
    const second = setup();
    second.request.policyReference = second.retain({
      ...second.policy,
      requirements: second.policy.requirements.slice(1),
    });
    await expect(assessAflTradeConstructionCompatibility(second.request)).rejects.toThrow(
      'exactly once'
    );
  });
  it('rejects fixture custody for non-production and independently mismatched selected runs', async () => {
    const { request } = setup();
    await expect(
      assessAflTradeConstructionCompatibility({ ...request, environment: 'non_production' })
    ).rejects.toThrow('custody');
    await expect(
      assessAflTradeConstructionCompatibility({
        ...request,
        selectedRuns: { ...request.selectedRuns, pick: 'other-run' },
      })
    ).rejects.toThrow('selected component runs or value unit');
  });
  it.each([
    ['across_spells', 'incompatible'],
    ['receiving_spell', 'ready'],
  ])('gates checked construction for %s', async (attribution, expected) => {
    const { fixture, request } = setup({ attribution });
    function retained<T>(value: T) {
      return {
        value,
        reference: createAflTradeCanonicalJsonArtifactRef(value, assessedAt),
        bytes: new TextEncoder().encode(canonicalizeAflTradeJson(value)),
      };
    }
    const result = await constructAflTradeCompatibleCurrentValuationTrade(
      {
        ...fixture.calculationInputPackage.content,
        state: 'ready',
        createdAt: assessedAt,
        factualReleaseId: fixture.trace.content.factualReleaseId,
        valuationInputBundleId: fixture.trace.content.valuationInputBundleId,
        components: fixture.trace.content.components,
        trace: retained(fixture.trace),
        explanationPolicy: retained(fixture.explanationPolicy),
        lineageGraph: retained(fixture.lineageGraph),
        pickBenchmarks: fixture.pickBenchmarks.map(retained),
        playerObservations: [],
      },
      request
    );
    expect(result.state).toBe(expected);
  });
});
