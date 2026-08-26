import {
  authenticateGovernedPrivateEvaluationAuthorityInspection,
  createReadyGovernedPrivateEvaluationAuthorityInspectionV3,
  createReadyGovernedPrivateEvaluationAuthorityInspection,
  createReadyFixtureGovernedPrivateEvaluationAuthorityInspection,
  createUnavailableNonProductionGovernedPrivateEvaluationAuthorityInspection,
  createUnavailableGovernedPrivateEvaluationAuthorityInspection,
} from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationAuthoritySnapshot';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';

const selector = {
  valuationScopeKey: 'afl-trade-history:test-fixture',
  tradeId: 'trade:adelaide-st-kilda',
};
const generationId = `local-private-trade-evaluation-generation:${'a'.repeat(64)}`;
const transitionId = `private-evaluation-transition:${'b'.repeat(64)}`;
const capturedAt = '2026-08-19T10:00:00.000Z';

function artifact(label: string) {
  return createAflTradeCanonicalJsonArtifactRef({ label }, '2026-08-19T09:00:00.000Z');
}

function readyAuthorityInput() {
  return {
    selector,
    capturedAt,
    validThrough: '2026-08-19T10:05:00.000Z',
    head: { status: 'absent' as const, revision: 0, generationId: null },
    lastTransitionId: null,
    preparedInputSetId: `prepared-valuation-input-set:${'1'.repeat(64)}`,
    preparedInputSetArtifact: artifact('prepared-input-set'),
    factualReleaseId: `outcome-release:${'2'.repeat(64)}`,
    valuationInputBundleId: `valuation-input-bundle:${'3'.repeat(64)}`,
    valuationInputBundleArtifact: artifact('valuation-input-bundle'),
    calculationInputPackageId: `valuation-calculation-input:${'4'.repeat(64)}`,
    calculationInputArtifact: artifact('calculation-input'),
    inputTraceId: `private-evaluation-input-trace:${'5'.repeat(64)}`,
    inputTraceArtifact: artifact('input-trace'),
    gateLedgerRevision: 17,
    components: [
      {
        role: 'player_contribution_and_availability' as const,
        runId: `model-run:${'6'.repeat(64)}`,
        protocolId: `model-protocol:${'7'.repeat(64)}`,
        datasetId: `dataset:${'8'.repeat(64)}`,
        datasetAdmissionId: `dataset-admission:${'9'.repeat(64)}`,
        datasetAdmissionGateLedgerRevision: 11,
        gate3DecisionId: `gate-decision:${'a'.repeat(64)}`,
        gate3DecisionVersion: 3,
        qualificationId: `model-qualification:${'a'.repeat(64)}`,
        qualificationPolicyVersion: `model-qualification-policy:${'b'.repeat(64)}`,
      },
      {
        role: 'draft_pick_and_future_pick_distribution' as const,
        runId: `model-run:${'b'.repeat(64)}`,
        protocolId: `model-protocol:${'c'.repeat(64)}`,
        datasetId: `dataset:${'d'.repeat(64)}`,
        datasetAdmissionId: `dataset-admission:${'e'.repeat(64)}`,
        datasetAdmissionGateLedgerRevision: 12,
        gate3DecisionId: `gate-decision:${'f'.repeat(64)}`,
        gate3DecisionVersion: 2,
        qualificationId: `model-qualification:${'a'.repeat(64)}`,
        qualificationPolicyVersion: `model-qualification-policy:${'b'.repeat(64)}`,
      },
    ],
  };
}

describe('governed private evaluation authority snapshot', () => {
  it('retains unavailable real authority as non-production rather than a synthetic fixture', () => {
    const retained = createUnavailableNonProductionGovernedPrivateEvaluationAuthorityInspection({
      selector: { valuationScopeKey: 'afl-men:2026-trades', tradeId: 'trade:real-three-club' },
      capturedAt,
      validThrough: '2026-08-19T10:05:00.000Z',
      head: { status: 'absent', revision: 0, generationId: null },
      lastTransitionId: null,
      blockers: [{ code: 'model_not_approved', message: 'Pick model Gate 3 is absent.' }],
    });

    expect(retained.snapshot.content).toMatchObject({
      schemaVersion: 'private-evaluation-authority-snapshot/v3',
      environment: 'non_production',
      calculationAuthority: {
        state: 'unavailable',
        playerModelRunId: null,
        pickModelRunId: null,
      },
    });
    expect(retained.inspection.content).toMatchObject({
      schemaVersion: 'private-evaluation-inspection/v3',
      state: 'unavailable',
      environment: 'non_production',
    });
  });

  it('retains unavailable model authority with the exact active head needed for withdrawal', () => {
    const retained = createUnavailableGovernedPrivateEvaluationAuthorityInspection({
      selector,
      capturedAt: '2026-08-19T10:00:00.000Z',
      validThrough: '2026-08-19T10:05:00.000Z',
      head: { status: 'active', revision: 4, generationId },
      lastTransitionId: transitionId,
      blockers: [
        {
          code: 'model_not_approved',
          message:
            'Externally approved player and pick model runs are not both available for this trade.',
        },
      ],
    });

    expect(authenticateGovernedPrivateEvaluationAuthorityInspection(retained)).toEqual(retained);
    expect(retained.snapshot.content).toMatchObject({
      selector,
      head: { status: 'active', revision: 4, generationId },
      lastTransitionId: transitionId,
      calculationAuthority: {
        state: 'unavailable',
        playerModelRunId: null,
        pickModelRunId: null,
      },
    });
    expect(retained.result).toEqual({
      state: 'unavailable',
      selector,
      inspectionId: retained.inspection.inspectionId,
      validThrough: '2026-08-19T10:05:00.000Z',
      head: { status: 'active', revision: 4, generationId },
      blockers: retained.inspection.content.blockers,
    });
  });

  it('rejects changed blockers and invalid predecessor/head combinations', () => {
    const retained = createUnavailableGovernedPrivateEvaluationAuthorityInspection({
      selector,
      capturedAt: '2026-08-19T10:00:00.000Z',
      validThrough: '2026-08-19T10:05:00.000Z',
      head: { status: 'absent', revision: 0, generationId: null },
      lastTransitionId: null,
      blockers: [{ code: 'model_not_approved', message: 'No approved component runs.' }],
    });
    const tampered = structuredClone(retained);
    tampered.inspection.content.blockers[0]!.message = 'Pretend the models are approved.';
    expect(() => authenticateGovernedPrivateEvaluationAuthorityInspection(tampered)).toThrow(
      /content|inspection|authenticate/i
    );
    expect(() =>
      createUnavailableGovernedPrivateEvaluationAuthorityInspection({
        selector,
        capturedAt: '2026-08-19T10:00:00.000Z',
        validThrough: '2026-08-19T10:05:00.000Z',
        head: { status: 'absent', revision: 0, generationId: null },
        lastTransitionId: transitionId,
        blockers: [{ code: 'model_not_approved', message: 'No approved component runs.' }],
      })
    ).toThrow(/predecessor|head/i);
  });

  it('authenticates synthetic-ready component runs and rejects changed model authority', () => {
    const retained = createReadyFixtureGovernedPrivateEvaluationAuthorityInspection({
      selector,
      capturedAt: '2026-08-19T10:00:00.000Z',
      validThrough: '2026-08-19T10:05:00.000Z',
      head: { status: 'absent', revision: 0, generationId: null },
      lastTransitionId: null,
      playerModelRunId: `model-run:${'c'.repeat(64)}`,
      pickModelRunId: `model-run:${'d'.repeat(64)}`,
    });

    expect(retained.result).toEqual({
      state: 'ready',
      selector,
      inspectionId: retained.inspection.inspectionId,
      validThrough: '2026-08-19T10:05:00.000Z',
      head: { status: 'absent', revision: 0, generationId: null },
      blockers: [],
    });
    const tampered = structuredClone(retained);
    const syntheticAuthority = tampered.snapshot.content.calculationAuthority;
    if (!('playerModelRunId' in syntheticAuthority)) {
      throw new Error('Expected synthetic-ready authority.');
    }
    syntheticAuthority.playerModelRunId = `model-run:${'e'.repeat(64)}`;
    expect(() => authenticateGovernedPrivateEvaluationAuthorityInspection(tampered)).toThrow();
  });

  it('authenticates the exact non-production calculation ancestry needed for construction', () => {
    const input = readyAuthorityInput();
    const retained = createReadyGovernedPrivateEvaluationAuthorityInspection(input);

    expect(retained.result).toEqual({
      state: 'ready',
      selector,
      inspectionId: retained.inspection.inspectionId,
      validThrough: input.validThrough,
      head: input.head,
      blockers: [],
    });
    expect(retained.snapshot.content).toMatchObject({
      schemaVersion: 'private-evaluation-authority-snapshot/v2',
      environment: 'non_production',
      calculationAuthority: {
        state: 'ready',
        preparedInputSetId: input.preparedInputSetId,
        factualReleaseId: input.factualReleaseId,
        valuationInputBundleId: input.valuationInputBundleId,
        calculationInputPackageId: input.calculationInputPackageId,
        inputTraceId: input.inputTraceId,
        gateLedgerRevision: 17,
        components: input.components,
      },
    });
    expect(authenticateGovernedPrivateEvaluationAuthorityInspection(retained)).toEqual(retained);
  });

  it('pins ready v3 authority to one current prepared head and its exact replay manifest', () => {
    const legacy = readyAuthorityInput();
    const qualifiedComponents = legacy.components.map((component) => ({
      ...component,
      qualificationId: `model-qualification:${'a'.repeat(64)}`,
      qualificationPolicyVersion: `model-qualification-policy:${'b'.repeat(64)}`,
    }));
    const retained = createReadyGovernedPrivateEvaluationAuthorityInspectionV3({
      selector: legacy.selector,
      capturedAt: legacy.capturedAt,
      validThrough: legacy.validThrough,
      head: legacy.head,
      lastTransitionId: legacy.lastTransitionId,
      preparedInputHeadRevision: 4,
      preparedInputSetId: legacy.preparedInputSetId,
      factualReleaseId: legacy.factualReleaseId,
      factualRegistryRevision: 21,
      activeFactualReleaseRevision: 7,
      privateValuationDecisionId: `private-valuation-evaluation-decision:${'1'.repeat(64)}`,
      privateValuationDecisionRevision: 3,
      materializationManifestId: `private-evaluation-materialization-manifest:${'0'.repeat(64)}`,
      materializationManifestArtifact: artifact('materialization-manifest'),
      valuationInputBundleId: legacy.valuationInputBundleId,
      valuationInputBundleArtifact: legacy.valuationInputBundleArtifact,
      gateLedgerRevision: legacy.gateLedgerRevision,
      components: qualifiedComponents,
    });

    expect(retained.snapshot.content).toMatchObject({
      schemaVersion: 'private-evaluation-authority-snapshot/v3',
      environment: 'non_production',
      calculationAuthority: {
        state: 'ready',
        preparedInputHeadRevision: 4,
        preparedInputSetId: legacy.preparedInputSetId,
        materializationManifestId: expect.stringMatching(
          /^private-evaluation-materialization-manifest:/
        ),
        factualReleaseId: legacy.factualReleaseId,
        factualRegistryRevision: 21,
        activeFactualReleaseRevision: 7,
        privateValuationDecisionId: expect.stringMatching(
          /^private-valuation-evaluation-decision:/
        ),
        privateValuationDecisionRevision: 3,
        valuationInputBundleId: legacy.valuationInputBundleId,
        components: qualifiedComponents,
      },
    });
    expect(authenticateGovernedPrivateEvaluationAuthorityInspection(retained)).toEqual(retained);

    const tampered = structuredClone(retained);
    const reviewedAuthority = tampered.inspection.content.calculationAuthority;
    if (!('privateValuationDecisionRevision' in reviewedAuthority)) {
      throw new Error('Expected reviewed private authority.');
    }
    reviewedAuthority.privateValuationDecisionRevision = 4;
    expect(() => authenticateGovernedPrivateEvaluationAuthorityInspection(tampered)).toThrow();
  });

  it('pins ready v3 private authority to the exact dispatch-bound factual and model tuple', () => {
    const legacy = readyAuthorityInput();
    const qualifiedComponents = legacy.components.map((component) => ({
      ...component,
      qualificationId: `model-qualification:${'a'.repeat(64)}`,
      qualificationPolicyVersion: `model-qualification-policy:${'b'.repeat(64)}`,
    }));
    const privateAuthority = {
      dispatchRequestId: `private-valuation-dispatch:${'1'.repeat(64)}`,
      factualOutputId: `private-valuation-factual-output:${'2'.repeat(64)}`,
      hpnCalculationId: `hpn-pav-season:${'3'.repeat(64)}`,
      modelOperationId: `private-valuation-model-operation:${'4'.repeat(64)}`,
      modelQualificationId: `model-qualification:${'a'.repeat(64)}`,
      modelQualificationWorkId: `model-qualification-work:${'5'.repeat(64)}`,
      modelQualificationRevision: 3,
      playerRunId: qualifiedComponents[0]!.runId,
      pickRunId: qualifiedComponents[1]!.runId,
    } as const;
    const retained = createReadyGovernedPrivateEvaluationAuthorityInspectionV3({
      selector: legacy.selector,
      capturedAt: legacy.capturedAt,
      validThrough: legacy.validThrough,
      head: legacy.head,
      lastTransitionId: legacy.lastTransitionId,
      preparationAuthority: 'dispatch_bound_private_factual_output',
      privateAuthority,
      preparedInputHeadRevision: 4,
      preparedInputSetId: legacy.preparedInputSetId,
      factualReleaseId: legacy.factualReleaseId,
      materializationManifestId: `private-evaluation-materialization-manifest:${'0'.repeat(64)}`,
      materializationManifestArtifact: artifact('private-materialization-manifest'),
      valuationInputBundleId: legacy.valuationInputBundleId,
      valuationInputBundleArtifact: legacy.valuationInputBundleArtifact,
      gateLedgerRevision: legacy.gateLedgerRevision,
      components: qualifiedComponents,
    });

    expect(retained.snapshot.content.calculationAuthority).toMatchObject({
      state: 'ready',
      preparationAuthority: 'dispatch_bound_private_factual_output',
      privateAuthority,
      preparedInputHeadRevision: 4,
      preparedInputSetId: legacy.preparedInputSetId,
    });
    expect('activeFactualReleaseRevision' in retained.snapshot.content.calculationAuthority).toBe(
      false
    );
    expect(authenticateGovernedPrivateEvaluationAuthorityInspection(retained)).toEqual(retained);
  });

  it('rejects substituted non-production authority and non-canonical component roles', () => {
    const retained = createReadyGovernedPrivateEvaluationAuthorityInspection(readyAuthorityInput());
    const substituted = structuredClone(retained);
    const authenticatedAuthority = substituted.inspection.content.calculationAuthority;
    if (!('inputTraceId' in authenticatedAuthority)) {
      throw new Error('Expected authenticated calculation authority.');
    }
    authenticatedAuthority.inputTraceId = `private-evaluation-input-trace:${'0'.repeat(64)}`;
    expect(() => authenticateGovernedPrivateEvaluationAuthorityInspection(substituted)).toThrow();

    const reordered = readyAuthorityInput();
    reordered.components.reverse();
    expect(() => createReadyGovernedPrivateEvaluationAuthorityInspection(reordered)).toThrow(
      /component|role|canonical/i
    );

    const unqualified = readyAuthorityInput();
    delete (unqualified.components[0] as { qualificationId?: string }).qualificationId;
    delete (unqualified.components[0] as { qualificationPolicyVersion?: string })
      .qualificationPolicyVersion;
    delete (unqualified.components[1] as { qualificationId?: string }).qualificationId;
    delete (unqualified.components[1] as { qualificationPolicyVersion?: string })
      .qualificationPolicyVersion;
    expect(() => createReadyGovernedPrivateEvaluationAuthorityInspection(unqualified)).toThrow(
      /qualification custody/i
    );
  });
});
