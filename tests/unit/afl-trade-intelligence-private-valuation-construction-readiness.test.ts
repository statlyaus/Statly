import { describe, expect, it } from 'vitest';
import {
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { inspectLocalPrivateValuationConstructionReadiness } from '@/server/aflTradeIntelligence/development/localPrivateValuationConstructionReadiness';
import { createGovernedPrivateEvaluationAuthenticatedCalculationFixture } from '../testUtils/governedPrivateEvaluationAuthenticatedCalculationFixture';

const assessedAt = '2026-09-05T01:00:00.000Z';

function setup(
  change: Record<string, unknown> = {},
  requirementChange: Record<string, unknown> = {}
) {
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
        return { ...binding, assetKind, evidence, ...requirementChange };
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
      throw new Error('Readiness inspection must be read-only.');
    },
  };
  const expectedViewKeys = requirements
    .map((requirement) => `${requirement.assetId}/${requirement.view}`)
    .sort((a, b) => a.localeCompare(b));
  return {
    repository,
    expectedViewKeys,
    selection: {
      calculationInputPackage: retain(fixture.calculationInputPackage),
      policy: retain(policy),
      runs: selectedRuns,
    },
  };
}

const inspect = (options: ReturnType<typeof setup>) =>
  inspectLocalPrivateValuationConstructionReadiness({
    repository: options.repository,
    environment: 'test_fixture',
    assessedAt,
    selection: options.selection,
  });

describe('local private valuation construction readiness', () => {
  it('assesses a compatible selection, covering every required asset and view', async () => {
    const options = setup();
    const report = await inspect(options);

    expect(report).toMatchObject({
      schemaVersion: 'afl-private-valuation-construction-readiness/v1',
      state: 'assessed',
      assessmentState: 'compatible',
      qualificationGranted: false,
      issues: [],
      blockerCodes: [],
    });
    expect([...report.requiredViewKeys]).toEqual(options.expectedViewKeys);
  });

  it('reports each blocked asset and view with its own reason', async () => {
    const options = setup({}, { evidence: null });
    const report = await inspect(options);

    expect(report.assessmentState).toBe('incompatible');
    expect(report.issues).toHaveLength(options.expectedViewKeys.length);
    for (const issue of report.issues) {
      expect(issue.reason).toBe('evidence_reference_missing');
      expect(options.expectedViewKeys).toContain(`${issue.assetId}/${issue.view}`);
    }
    expect(report.blockerCodes).toEqual(['evidence_reference_missing']);
  });

  it('fails closed with a named reason when the policy artifact is absent', async () => {
    const options = setup();
    const missingPolicy = createAflTradeCanonicalJsonArtifactRef({ absent: true }, assessedAt);
    const report = await inspectLocalPrivateValuationConstructionReadiness({
      repository: options.repository,
      environment: 'test_fixture',
      assessedAt,
      selection: { ...options.selection, policy: missingPolicy },
    });

    expect(report).toMatchObject({
      state: 'assessed',
      assessmentState: 'unavailable',
      qualificationGranted: false,
      issues: [],
    });
    expect(report.policyArtifactId).toBe(missingPolicy.artifactId);
    expect(report.blockerCodes).toContain('policy_missing');
  });

  it('does not assess at all when the retained package is absent', async () => {
    const options = setup();
    const missingPackage = createAflTradeCanonicalJsonArtifactRef({ absent: true }, assessedAt);
    let policyReads = 0;
    const report = await inspectLocalPrivateValuationConstructionReadiness({
      repository: {
        ...options.repository,
        async loadExact(reference, maximumBytes) {
          if (reference.artifactId === options.selection.policy.artifactId) policyReads += 1;
          return options.repository.loadExact(reference, maximumBytes);
        },
      },
      environment: 'test_fixture',
      assessedAt,
      selection: { ...options.selection, calculationInputPackage: missingPackage },
    });

    expect(report).toMatchObject({
      state: 'not_assessable',
      assessmentState: 'not_attempted',
      qualificationGranted: false,
      issues: [],
    });
    expect(report.blockerCodes).toEqual(['calculation_input_package_missing']);
    expect(policyReads).toBe(0);
  });

  it('never writes, whatever the outcome', async () => {
    const compatible = setup();
    await expect(inspect(compatible)).resolves.toMatchObject({ state: 'assessed' });
    const blocked = setup({}, { evidence: null });
    await expect(inspect(blocked)).resolves.toMatchObject({ assessmentState: 'incompatible' });
  });
});
