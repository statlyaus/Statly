import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_VALUATION_CALCULATION_INPUT_PACKAGE_SCHEMA_VERSION,
  AFL_TRADE_VALUATION_CALCULATION_INPUT_PACKAGE_V2_SCHEMA_VERSION,
  aflTradeValuationCalculationInputPackageSchema,
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

  it('binds authenticated non-production kernel inputs to one exact input trace', () => {
    const fixture = createFabricatedAflTradeValuationFixture('three_club_trade');
    const valuationInputBundleId = `valuation-input-bundle:${'8'.repeat(64)}`;
    const inputTraceId = `private-evaluation-input-trace:${'7'.repeat(64)}`;
    const { valuationCase, componentDrawSet, realizedContributionLedger, packagePolicy } =
      bindInputBundle(fixture, valuationInputBundleId);
    const input = createAflTradeValuationCalculationInputPackage({
      schemaVersion: AFL_TRADE_VALUATION_CALCULATION_INPUT_PACKAGE_V2_SCHEMA_VERSION,
      authority: {
        kind: 'authenticated_non_production',
        inputTraceId,
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

    expect(input.content).toMatchObject({
      schemaVersion: AFL_TRADE_VALUATION_CALCULATION_INPUT_PACKAGE_V2_SCHEMA_VERSION,
      authority: { kind: 'authenticated_non_production', inputTraceId },
    });
    expect(aflTradeValuationCalculationInputPackageSchema.parse(input)).toEqual(input);

    const tampered = structuredClone(input);
    tampered.content.authority.inputTraceId =
      `private-evaluation-input-trace:${'6'.repeat(64)}`;
    expect(() => aflTradeValuationCalculationInputPackageSchema.parse(tampered)).toThrow();
  });
});
