import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  GOVERNED_PRIVATE_VALUATION_CALCULATION_INPUT_SCHEMA_VERSION,
  createGovernedPrivateValuationCalculationInput,
} from '@/server/aflTradeIntelligence/valuation/governedPrivateValuationCalculationInput';
import {
  AFL_TRADE_VALUATION_CALCULATION_INPUT_PACKAGE_SCHEMA_VERSION,
  createAflTradeValuationCalculationInputPackage,
  createAflTradeValuationCalculationInputPackageArtifact,
} from '@/server/aflTradeIntelligence/valuation/valuationCalculationInputPackage';
import { createFabricatedAflTradeValuationFixture } from '@/server/aflTradeIntelligence/valuation/tradeValuationFixtures';

function bindInputBundle(
  fixture: ReturnType<typeof createFabricatedAflTradeValuationFixture>,
  valuationInputBundleId: string
) {
  const componentDrawSet = structuredClone(fixture.componentDrawSet);
  componentDrawSet.content.valuationInputBundleId = valuationInputBundleId;
  componentDrawSet.componentDrawSetId = createAflTradeContentAddress(
    'component-draw-set',
    componentDrawSet.content
  );
  const realizedContributionLedger = structuredClone(fixture.realizedContributionLedger);
  realizedContributionLedger.content.valuationInputBundleId = valuationInputBundleId;
  realizedContributionLedger.realizedContributionLedgerId = createAflTradeContentAddress(
    'realized-contribution-ledger',
    realizedContributionLedger.content
  );
  const packagePolicy = structuredClone(fixture.packagePolicy);
  packagePolicy.content.valuationInputBundleId = valuationInputBundleId;
  packagePolicy.packagePolicyId = createAflTradeContentAddress(
    'package-policy',
    packagePolicy.content
  );
  const valuationCase = structuredClone(fixture.valuationCase);
  valuationCase.content.valuationInputBundleId = valuationInputBundleId;
  valuationCase.content.componentDrawSetId = componentDrawSet.componentDrawSetId;
  valuationCase.content.realizedContributionLedgerId =
    realizedContributionLedger.realizedContributionLedgerId;
  valuationCase.content.packagePolicyId = packagePolicy.packagePolicyId;
  valuationCase.valuationCaseId = createAflTradeContentAddress(
    'valuation-case',
    valuationCase.content
  );
  return { valuationCase, componentDrawSet, realizedContributionLedger, packagePolicy };
}

describe('AFL trade valuation calculation input package', () => {
  it('admits one exact governed private kernel input before any output generation exists', () => {
    const fixture = createFabricatedAflTradeValuationFixture('future_pick_resolution');
    const valuationInputBundleId = `valuation-input-bundle:${'9'.repeat(64)}`;
    const { valuationCase, componentDrawSet, realizedContributionLedger, packagePolicy } =
      bindInputBundle(fixture, valuationInputBundleId);
    const createdAt = '2026-08-15T03:00:00.000Z';
    const evidence = createAflTradeCanonicalJsonArtifactRef({ evidence: 'governed' }, createdAt);
    const input = createGovernedPrivateValuationCalculationInput({
      schemaVersion: GOVERNED_PRIVATE_VALUATION_CALCULATION_INPUT_SCHEMA_VERSION,
      authority: {
        kind: 'governed_private_nonproduction',
        confirmedFacts: {
          resultId: `private-confirmed-valuation-result:${'1'.repeat(64)}`,
          resultArtifact: evidence,
          valuationScopeKey: 'afl-men:2025-trades',
          transactionPromotionId: `private-workbook-transaction-promotion:${'2'.repeat(64)}`,
          tradeId: valuationCase.content.tradeId,
          valueUnitId: valuationCase.content.valueUnitId,
          assetIds: componentDrawSet.content.assets.map(({ assetId }) => assetId),
        },
        sourceUseAssessments: [
          {
            assessmentId: `hpn-private-source-use-assessment:${'3'.repeat(64)}`,
            assessmentArtifact: evidence,
            state: 'permitted_private_calculation',
            operation: 'derived_feature_creation',
            valuationScopeKey: 'afl-men:2025-trades',
            modelTraining: 'blocked',
            evidenceRefs: [evidence],
          },
        ],
        privateEvaluation: {
          decisionId: `private-valuation-evaluation-decision:${'4'.repeat(64)}`,
          decisionArtifact: evidence,
          state: 'authorized_private_calculation',
          environment: 'non_production',
          modelTrainingAuthorized: false,
          liveCaptureAuthorized: false,
          publicationAuthorized: false,
          evidenceRefs: [evidence],
        },
        factualRelease: {
          releaseId: `outcome-release:${'5'.repeat(64)}`,
          releaseArtifact: evidence,
          state: 'active',
          evidenceRefs: [evidence],
        },
        components: componentDrawSet.content.components.map((component) => ({
          ...component,
          environment: 'non_production' as const,
          outcome: 'succeeded' as const,
          gate3State: 'approved' as const,
          runArtifact: evidence,
          gate3DecisionArtifact: evidence,
          evidenceRefs: [evidence],
        })),
        valuationBundle: {
          bundleId: valuationCase.content.valuationBundleId,
          bundleArtifact: evidence,
          gate3DecisionId: `gate-decision:${'6'.repeat(64)}`,
          gate3DecisionArtifact: evidence,
          environment: 'non_production' as const,
          gate3State: 'approved' as const,
          evidenceRefs: [evidence],
        },
        publicationProhibited: true,
      },
      tradeId: valuationCase.content.tradeId,
      valuationInputBundleId,
      valuationCase,
      componentDrawSet,
      realizedContributionLedger,
      packagePolicy,
      createdAt,
      publicationEligible: false,
    });

    expect(input.content.authority.confirmedFacts.resultId).toBe(
      `private-confirmed-valuation-result:${'1'.repeat(64)}`
    );
    expect(input.content.authority.components.map(({ role }) => role)).toEqual([
      'player_contribution_and_availability',
      'draft_pick_and_future_pick_distribution',
    ]);
    expect(input.content.publicationEligible).toBe(false);
  });

  it('content-addresses one complete kernel input while preserving fixture-only authority', () => {
    const fixture = createFabricatedAflTradeValuationFixture('future_pick_resolution');
    const valuationInputBundleId = `valuation-input-bundle:${'9'.repeat(64)}`;
    const { valuationCase, componentDrawSet, realizedContributionLedger, packagePolicy } =
      bindInputBundle(fixture, valuationInputBundleId);
    const input = createAflTradeValuationCalculationInputPackage({
      schemaVersion: AFL_TRADE_VALUATION_CALCULATION_INPUT_PACKAGE_SCHEMA_VERSION,
      authority: {
        kind: 'fabricated_test_fixture',
        evidenceClassification: fixture.evidenceClassification,
        publicationProhibited: true,
      },
      tradeId: fixture.valuationCase.content.tradeId,
      valuationInputBundleId,
      valuationCase,
      componentDrawSet,
      realizedContributionLedger,
      packagePolicy,
      createdAt: '2026-08-15T03:00:00.000Z',
      publicationEligible: false,
      limitation:
        'Calculation input only; not a result, model approval, publication approval, or activation authority.',
    });

    expect(input.calculationInputPackageId).toBe(
      createAflTradeContentAddress('valuation-calculation-input', input.content)
    );
    expect(input.content.authority).toMatchObject({
      kind: 'fabricated_test_fixture',
      publicationProhibited: true,
    });
    const retained = createAflTradeValuationCalculationInputPackageArtifact(input.content);
    expect(retained.calculationInputPackage).toEqual(input);
    expect(retained.artifact.byteLength).toBe(retained.bytes.byteLength);
  });

  it('rejects a package policy from another valuation bundle', () => {
    const fixture = createFabricatedAflTradeValuationFixture('future_pick_resolution');
    const valuationInputBundleId = `valuation-input-bundle:${'9'.repeat(64)}`;
    const { valuationCase, componentDrawSet, realizedContributionLedger, packagePolicy } =
      bindInputBundle(fixture, valuationInputBundleId);
    packagePolicy.content.valuationBundleId = `valuation-bundle:${'f'.repeat(64)}`;
    packagePolicy.packagePolicyId = createAflTradeContentAddress(
      'package-policy',
      packagePolicy.content
    );
    valuationCase.content.packagePolicyId = packagePolicy.packagePolicyId;
    valuationCase.valuationCaseId = createAflTradeContentAddress(
      'valuation-case',
      valuationCase.content
    );

    expect(() =>
      createAflTradeValuationCalculationInputPackage({
        schemaVersion: AFL_TRADE_VALUATION_CALCULATION_INPUT_PACKAGE_SCHEMA_VERSION,
        authority: {
          kind: 'fabricated_test_fixture',
          evidenceClassification: fixture.evidenceClassification,
          publicationProhibited: true,
        },
        tradeId: fixture.valuationCase.content.tradeId,
        valuationInputBundleId,
        valuationCase,
        componentDrawSet,
        realizedContributionLedger,
        packagePolicy,
        createdAt: '2026-08-15T03:00:00.000Z',
        publicationEligible: false,
        limitation:
          'Calculation input only; not a result, model approval, publication approval, or activation authority.',
      })
    ).toThrow();
  });
});
