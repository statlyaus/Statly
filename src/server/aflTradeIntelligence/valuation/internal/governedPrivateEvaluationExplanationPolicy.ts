import { z } from 'zod';

import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../../artifacts/contentAddress';

export const GOVERNED_PRIVATE_EVALUATION_EXPLANATION_POLICY_SCHEMA_VERSION =
  'private-evaluation-explanation-policy/v1' as const;

const LIMITATION =
  'Private calculation explanation policy only; not model, grade, publication, or activation authority.' as const;

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

const practicalEquivalenceBandSchema = z
  .object({
    view: z.enum(AFL_TRADE_VALUATION_VIEWS),
    maximumDifference: z.number().finite().nonnegative(),
  })
  .strict();

export const governedPrivateEvaluationExplanationPolicyContentSchema = z
  .object({
    schemaVersion: z.literal(GOVERNED_PRIVATE_EVALUATION_EXPLANATION_POLICY_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    valueUnitId: publicIdSchema,
    selectedLayer: z.enum(['gross', 'listSpotAdjusted', 'scarcityAdjusted']),
    practicalEquivalence: z
      .object({
        basis: z.string().trim().min(1).max(500),
        bandByView: z.array(practicalEquivalenceBandSchema).length(
          AFL_TRADE_VALUATION_VIEWS.length
        ),
      })
      .strict(),
    createdAt: z.iso.datetime({ offset: true }),
    publicationEligible: z.literal(false),
    limitation: z.literal(LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    content.practicalEquivalence.bandByView.forEach((band, index) => {
      if (band.view !== AFL_TRADE_VALUATION_VIEWS[index]) {
        context.addIssue({
          code: 'custom',
          path: ['practicalEquivalence', 'bandByView', index, 'view'],
          message: 'Practical-equivalence bands must use canonical four-view order.',
        });
      }
    });
  });

export const governedPrivateEvaluationExplanationPolicySchema = z
  .object({
    policyId: aflTradeContentAddressedIdSchema('private-evaluation-explanation-policy'),
    content: governedPrivateEvaluationExplanationPolicyContentSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    addAflTradeContentAddressIssue(
      'private-evaluation-explanation-policy',
      policy.policyId,
      policy.content,
      context,
      ['policyId']
    );
  });

export type GovernedPrivateEvaluationExplanationPolicyContent = z.infer<
  typeof governedPrivateEvaluationExplanationPolicyContentSchema
>;
export type GovernedPrivateEvaluationExplanationPolicy = z.infer<
  typeof governedPrivateEvaluationExplanationPolicySchema
>;

export function createGovernedPrivateEvaluationExplanationPolicy(
  input: GovernedPrivateEvaluationExplanationPolicyContent
): GovernedPrivateEvaluationExplanationPolicy {
  const content = governedPrivateEvaluationExplanationPolicyContentSchema.parse(input);
  return governedPrivateEvaluationExplanationPolicySchema.parse({
    policyId: createAflTradeContentAddress(
      'private-evaluation-explanation-policy',
      content
    ),
    content,
  });
}
