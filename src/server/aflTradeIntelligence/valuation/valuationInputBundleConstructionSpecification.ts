import { z } from 'zod';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

const instantSchema = z.iso.datetime({ offset: true });
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);

export const AFL_TRADE_VALUATION_INPUT_BUNDLE_CONSTRUCTION_SPECIFICATION_VERSION =
  'afl-trade-valuation-input-bundle-construction-specification/v1' as const;
export const AFL_TRADE_VALUATION_INPUT_BUNDLE_CONSTRUCTION_SPECIFICATION_LIMITATION =
  'Retained non-production calculation configuration only; model, execution, activation, publication, and production authority remain separate.' as const;

const contentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_VALUATION_INPUT_BUNDLE_CONSTRUCTION_SPECIFICATION_VERSION),
    environment: z.literal('non_production'),
    scopeKey: publicIdSchema,
    valueUnitId: publicIdSchema,
    createdAt: instantSchema,
    currentView: z
      .object({
        effectiveAt: instantSchema,
        knowledgeCutoffAt: instantSchema,
        valuationAsOf: instantSchema,
      })
      .strict(),
    policies: z
      .object({
        listSpot: aflTradeArtifactRefSchema,
        scarcity: aflTradeArtifactRefSchema,
        roleCongestion: aflTradeArtifactRefSchema,
        lowReturn: aflTradeArtifactRefSchema,
        eliteOutcome: aflTradeArtifactRefSchema,
        practicalEquivalence: aflTradeArtifactRefSchema,
        explanation: aflTradeArtifactRefSchema,
      })
      .strict(),
    simulation: z
      .object({
        draws: z.number().int().positive().max(100_000),
        seed: publicIdSchema,
        samplingAlgorithmVersion: z.literal('counter_sha256_rejection_v1'),
      })
      .strict(),
    publicationEligible: z.literal(false),
    limitation: z.literal(AFL_TRADE_VALUATION_INPUT_BUNDLE_CONSTRUCTION_SPECIFICATION_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    const valuationAsOf = Date.parse(content.currentView.valuationAsOf);
    if (
      Date.parse(content.currentView.effectiveAt) > valuationAsOf ||
      Date.parse(content.currentView.knowledgeCutoffAt) > valuationAsOf
    ) {
      context.addIssue({
        code: 'custom',
        path: ['currentView'],
        message: 'Current effective and knowledge-cutoff times cannot follow valuation time.',
      });
    }
    const policies = Object.values(content.policies);
    if (new Set(policies.map(({ artifactId }) => artifactId)).size !== policies.length) {
      context.addIssue({
        code: 'custom',
        path: ['policies'],
        message: 'Bundle construction policies require distinct retained artifacts.',
      });
    }
    if (policies.some(({ createdAt }) => Date.parse(createdAt) > Date.parse(content.createdAt))) {
      context.addIssue({
        code: 'custom',
        path: ['policies'],
        message: 'Every construction policy artifact must exist before specification creation.',
      });
    }
  });

export const aflTradeValuationInputBundleConstructionSpecificationSchema = z
  .object({
    specificationId: aflTradeContentAddressedIdSchema(
      'valuation-input-bundle-construction-specification'
    ),
    content: contentSchema,
  })
  .strict()
  .superRefine((specification, context) => {
    addAflTradeContentAddressIssue(
      'valuation-input-bundle-construction-specification',
      specification.specificationId,
      specification.content,
      context,
      ['specificationId']
    );
  });

export type AflTradeValuationInputBundleConstructionSpecification = z.infer<
  typeof aflTradeValuationInputBundleConstructionSpecificationSchema
>;

export function createAflTradeValuationInputBundleConstructionSpecification(
  input: Omit<
    z.input<typeof contentSchema>,
    'schemaVersion' | 'environment' | 'publicationEligible' | 'limitation'
  >
): AflTradeValuationInputBundleConstructionSpecification {
  const content = contentSchema.parse({
    schemaVersion: AFL_TRADE_VALUATION_INPUT_BUNDLE_CONSTRUCTION_SPECIFICATION_VERSION,
    environment: 'non_production',
    ...input,
    publicationEligible: false,
    limitation: AFL_TRADE_VALUATION_INPUT_BUNDLE_CONSTRUCTION_SPECIFICATION_LIMITATION,
  });
  return aflTradeValuationInputBundleConstructionSpecificationSchema.parse({
    specificationId: createAflTradeContentAddress(
      'valuation-input-bundle-construction-specification',
      content
    ),
    content,
  });
}

export function parseAflTradeValuationInputBundleConstructionSpecification(
  input: unknown
): AflTradeValuationInputBundleConstructionSpecification {
  return aflTradeValuationInputBundleConstructionSpecificationSchema.parse(input);
}
