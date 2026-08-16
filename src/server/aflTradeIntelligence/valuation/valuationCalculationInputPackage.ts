import { z } from 'zod';

import {
  AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  createAflTradeByteArtifactRef,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradeComponentDrawSetSchema } from './componentDrawSet';
import { aflTradePackagePolicySchema } from './packagePolicy';
import { aflTradeRealizedContributionLedgerSchema } from './realizedContributionLedger';
import { aflTradeValuationCaseSchema } from './valuationCaseContracts';

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

const authoritySchema = z
  .object({
    kind: z.literal('fabricated_test_fixture'),
    evidenceClassification: z.literal('fabricated_test_evidence_not_real_afl_data'),
    publicationProhibited: z.literal(true),
  })
  .strict();

export const AFL_TRADE_VALUATION_CALCULATION_INPUT_PACKAGE_SCHEMA_VERSION =
  'afl-trade-valuation-calculation-input-package/v1' as const;

export const aflTradeValuationCalculationInputPackageContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_VALUATION_CALCULATION_INPUT_PACKAGE_SCHEMA_VERSION),
    authority: authoritySchema,
    tradeId: publicIdSchema,
    valuationInputBundleId: aflTradeContentAddressedIdSchema('valuation-input-bundle'),
    valuationCase: aflTradeValuationCaseSchema,
    componentDrawSet: aflTradeComponentDrawSetSchema,
    realizedContributionLedger: aflTradeRealizedContributionLedgerSchema,
    packagePolicy: aflTradePackagePolicySchema,
    createdAt: z.iso.datetime({ offset: true }),
    publicationEligible: z.literal(false),
    limitation: z.literal(
      'Calculation input only; not a result, model approval, publication approval, or activation authority.'
    ),
  })
  .strict()
  .superRefine((input, context) => {
    const valuationCase = input.valuationCase.content;
    const drawSet = input.componentDrawSet.content;
    const ledger = input.realizedContributionLedger.content;
    const policy = input.packagePolicy.content;
    if (input.tradeId !== valuationCase.tradeId) {
      context.addIssue({ code: 'custom', message: 'Calculation input trade identity mismatch.' });
    }
    if (
      [
        valuationCase.valuationBundleId,
        drawSet.valuationBundleId,
        ledger.valuationBundleId,
        policy.valuationBundleId,
      ].some((valuationBundleId) => valuationBundleId !== valuationCase.valuationBundleId) ||
      [valuationCase, drawSet, ledger, policy].some(
        ({ valuationInputBundleId }) => valuationInputBundleId !== input.valuationInputBundleId
      )
    ) {
      context.addIssue({ code: 'custom', message: 'Calculation input bundle ancestry mismatch.' });
    }
    if (
      valuationCase.componentDrawSetId !== input.componentDrawSet.componentDrawSetId ||
      valuationCase.realizedContributionLedgerId !==
        input.realizedContributionLedger.realizedContributionLedgerId ||
      valuationCase.packagePolicyId !== input.packagePolicy.packagePolicyId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Valuation case must reference the exact packaged calculation inputs.',
      });
    }
    if (
      valuationCase.lineageGraphId !== ledger.lineageGraphId ||
      [drawSet.valueUnitId, ledger.valueUnitId, policy.valueUnitId].some(
        (valueUnitId) => valueUnitId !== valuationCase.valueUnitId
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Calculation input lineage or value-unit identity mismatch.',
      });
    }
  });

export const aflTradeValuationCalculationInputPackageSchema = z
  .object({
    calculationInputPackageId: aflTradeContentAddressedIdSchema('valuation-calculation-input'),
    content: aflTradeValuationCalculationInputPackageContentSchema,
  })
  .strict()
  .superRefine((input, context) => {
    addAflTradeContentAddressIssue(
      'valuation-calculation-input',
      input.calculationInputPackageId,
      input.content,
      context,
      ['calculationInputPackageId']
    );
  });

export type AflTradeValuationCalculationInputPackageContent = z.infer<
  typeof aflTradeValuationCalculationInputPackageContentSchema
>;
export type AflTradeValuationCalculationInputPackage = z.infer<
  typeof aflTradeValuationCalculationInputPackageSchema
>;

export function createAflTradeValuationCalculationInputPackage(
  input: z.input<typeof aflTradeValuationCalculationInputPackageContentSchema>
): AflTradeValuationCalculationInputPackage {
  const content = aflTradeValuationCalculationInputPackageContentSchema.parse(input);
  return aflTradeValuationCalculationInputPackageSchema.parse({
    calculationInputPackageId: createAflTradeContentAddress('valuation-calculation-input', content),
    content,
  });
}

export function createAflTradeValuationCalculationInputPackageArtifact(
  input: z.input<typeof aflTradeValuationCalculationInputPackageContentSchema>
) {
  const calculationInputPackage = createAflTradeValuationCalculationInputPackage(input);
  const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(calculationInputPackage));
  return {
    calculationInputPackage,
    bytes,
    artifact: createAflTradeByteArtifactRef(
      bytes,
      AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
      calculationInputPackage.content.createdAt
    ),
  };
}
