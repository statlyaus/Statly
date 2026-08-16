import { z } from 'zod';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

export const AFL_TRADE_PRIVATE_VALUATION_EVALUATION_DECISION_SCHEMA_VERSION =
  'afl-trade-private-valuation-evaluation-decision/v1' as const;

export const AFL_TRADE_PRIVATE_VALUATION_EVALUATION_AUTHORITY_BOUNDARY =
  'private_local_nonproduction_derived_calculation_internal_evaluation_only_no_training_public_redistribution_production_or_capture' as const;

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);

const contentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PRIVATE_VALUATION_EVALUATION_DECISION_SCHEMA_VERSION),
    authorityBoundary: z.literal(AFL_TRADE_PRIVATE_VALUATION_EVALUATION_AUTHORITY_BOUNDARY),
    environment: z.literal('non_production'),
    operation: z.literal('private_nonproduction_derived_calculation'),
    status: z.enum(['authorized', 'withdrawn']),
    valuationScopeKey: publicIdSchema,
    factualReleaseScopeKey: publicIdSchema,
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    factualReleaseArtifact: aflTradeArtifactRefSchema,
    releaseMembershipArtifact: aflTradeArtifactRefSchema,
    sourceRightsEvidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(1_000),
    sourceRightsEffect: z.literal('supplemental_evaluation_authority_does_not_amend_source_rights'),
    permissions: z
      .object({
        derivedCalculations: z.literal(true),
        internalEvaluation: z.literal(true),
        modelTraining: z.literal(false),
        publicDisplay: z.literal(false),
        redistribution: z.literal(false),
        productionActivation: z.literal(false),
        liveCapture: z.literal(false),
      })
      .strict(),
    revision: z.number().int().positive(),
    supersedesDecisionId: aflTradeContentAddressedIdSchema(
      'private-valuation-evaluation-decision'
    ).nullable(),
    reviewerId: publicIdSchema,
    rationale: z.string().trim().min(1).max(2_000),
    decidedAt: z.iso.datetime({ offset: true }),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(
      'This decision authorizes only private local non-production derived calculations from the exact retained source artifacts for internal evaluation. It grants no model-training, public-display, redistribution, production-activation, live-capture, or publication authority.'
    ),
  })
  .strict()
  .superRefine((content, context) => {
    const evidenceIds = content.sourceRightsEvidenceRefs.map(({ artifactId }) => artifactId);
    if (new Set(evidenceIds).size !== evidenceIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['sourceRightsEvidenceRefs'],
        message: 'Source-rights evidence references must be unique.',
      });
    }
    if (
      evidenceIds.some((artifactId, index) => index > 0 && evidenceIds[index - 1]! > artifactId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceRightsEvidenceRefs'],
        message: 'Source-rights evidence references must use canonical order.',
      });
    }
    if ((content.revision === 1) !== (content.supersedesDecisionId === null)) {
      context.addIssue({
        code: 'custom',
        path: ['supersedesDecisionId'],
        message: 'The decision must form an explicit append-only revision chain.',
      });
    }
  });

export const aflTradePrivateValuationEvaluationDecisionSchema = z
  .object({
    decisionId: aflTradeContentAddressedIdSchema('private-valuation-evaluation-decision'),
    content: contentSchema,
  })
  .strict()
  .superRefine((decision, context) => {
    addAflTradeContentAddressIssue(
      'private-valuation-evaluation-decision',
      decision.decisionId,
      decision.content,
      context,
      ['decisionId']
    );
  });

export type AflTradePrivateValuationEvaluationDecision = z.infer<
  typeof aflTradePrivateValuationEvaluationDecisionSchema
>;

export type CreateAflTradePrivateValuationEvaluationDecisionInput = Omit<
  z.input<typeof contentSchema>,
  | 'schemaVersion'
  | 'authorityBoundary'
  | 'environment'
  | 'operation'
  | 'sourceRightsEffect'
  | 'permissions'
  | 'publicationEligible'
  | 'publicationProhibited'
  | 'limitation'
>;

export function parseAflTradePrivateValuationEvaluationDecision(
  input: unknown
): AflTradePrivateValuationEvaluationDecision {
  try {
    return aflTradePrivateValuationEvaluationDecisionSchema.parse(input);
  } catch {
    throw new TypeError('Private valuation evaluation decision failed exact authentication.');
  }
}

export function createAflTradePrivateValuationEvaluationDecision(
  input: CreateAflTradePrivateValuationEvaluationDecisionInput
): AflTradePrivateValuationEvaluationDecision {
  const sourceRightsEvidenceRefs = [...input.sourceRightsEvidenceRefs].sort((left, right) =>
    left.artifactId.localeCompare(right.artifactId)
  );
  if (
    new Set(sourceRightsEvidenceRefs.map(({ artifactId }) => artifactId)).size !==
    sourceRightsEvidenceRefs.length
  ) {
    throw new TypeError('Source-rights evidence references must be unique.');
  }
  if ((input.revision === 1) !== (input.supersedesDecisionId === null)) {
    throw new TypeError('The decision must form an explicit append-only revision chain.');
  }
  const content = contentSchema.parse({
    ...input,
    schemaVersion: AFL_TRADE_PRIVATE_VALUATION_EVALUATION_DECISION_SCHEMA_VERSION,
    authorityBoundary: AFL_TRADE_PRIVATE_VALUATION_EVALUATION_AUTHORITY_BOUNDARY,
    environment: 'non_production',
    operation: 'private_nonproduction_derived_calculation',
    sourceRightsEvidenceRefs,
    sourceRightsEffect: 'supplemental_evaluation_authority_does_not_amend_source_rights',
    permissions: {
      derivedCalculations: true,
      internalEvaluation: true,
      modelTraining: false,
      publicDisplay: false,
      redistribution: false,
      productionActivation: false,
      liveCapture: false,
    },
    publicationEligible: false,
    publicationProhibited: true,
    limitation:
      'This decision authorizes only private local non-production derived calculations from the exact retained source artifacts for internal evaluation. It grants no model-training, public-display, redistribution, production-activation, live-capture, or publication authority.',
  });
  return aflTradePrivateValuationEvaluationDecisionSchema.parse({
    decisionId: createAflTradeContentAddress('private-valuation-evaluation-decision', content),
    content,
  });
}
