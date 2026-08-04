import { z } from 'zod';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { AFL_TRADE_DECISION_ENVIRONMENTS } from '../governance/gateDecisionTypes';

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const boundedTextSchema = z.string().trim().min(1).max(1_000);
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

export const AFL_TRADE_MODEL_CHANGE_AREAS = [
  'training_window',
  'source_data',
  'feature_definition',
  'estimand',
  'algorithm',
  'calibration',
  'uncertainty',
  'value_unit',
  'subgroup_policy',
  'code',
  'dependency',
] as const;

export const AFL_TRADE_MODEL_CHANGE_REVIEW_DECISIONS = [
  'reject',
  'revise',
  'shadow_only',
  'recommend_gate_3_review',
] as const;

const modelComponentSchema = z
  .object({
    component: z.enum(['player_contribution', 'draft_pick_distribution']),
    modelProtocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    modelRunId: aflTradeContentAddressedIdSchema('model-run'),
  })
  .strict();

const componentSetSchema = z
  .array(modelComponentSchema)
  .length(2)
  .superRefine((components, context) => {
    if (new Set(components.map((component) => component.component)).size !== components.length) {
      context.addIssue({
        code: 'custom',
        message: 'A model release must identify each governed component exactly once.',
      });
    }
  });

const changeSchema = z
  .object({
    area: z.enum(AFL_TRADE_MODEL_CHANGE_AREAS),
    materiality: z.enum(['minor', 'material']),
    summary: boundedTextSchema,
    rationaleArtifact: aflTradeArtifactRefSchema,
  })
  .strict();

const reviewerSchema = z
  .object({
    reviewer: publicIdSchema,
    responsibility: z.enum([
      'model_reviewer',
      'data_reviewer',
      'product_reviewer',
      'risk_reviewer',
    ]),
    reviewedAt: isoDateTimeSchema,
    recommendation: z.enum(['reject', 'revise', 'shadow_only', 'advance']),
    attestationArtifact: aflTradeArtifactRefSchema,
  })
  .strict();

export const aflTradeModelChangeReviewContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-model-change-review/v1'),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    scopeKey: publicIdSchema,
    reviewKind: z.enum([
      'scheduled_recalibration',
      'material_model_change',
      'emergency_remediation',
    ]),
    reviewSequence: z.number().int().positive(),
    previousReviewId: aflTradeContentAddressedIdSchema('model-change-review').nullable(),
    proposedAt: isoDateTimeSchema,
    proposedBy: publicIdSchema,
    reviewedAt: isoDateTimeSchema,
    currentRelease: z
      .object({
        valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
        components: componentSetSchema,
      })
      .strict(),
    candidateRelease: z
      .object({
        valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
        components: componentSetSchema,
      })
      .strict(),
    preRegisteredChangePlanArtifact: aflTradeArtifactRefSchema,
    changes: z.array(changeSchema).min(1).max(AFL_TRADE_MODEL_CHANGE_AREAS.length),
    compatibilityDisposition: z.enum([
      'same_value_unit_compatible',
      'new_value_unit_required',
      'incompatible_reject',
    ]),
    evidence: z
      .object({
        baselineComparisonArtifact: aflTradeArtifactRefSchema,
        temporalValidationArtifact: aflTradeArtifactRefSchema,
        calibrationAndCoverageArtifact: aflTradeArtifactRefSchema,
        subgroupPerformanceArtifact: aflTradeArtifactRefSchema,
        sensitivityArtifact: aflTradeArtifactRefSchema,
        leakageAuditArtifact: aflTradeArtifactRefSchema,
        lineageInvariantArtifact: aflTradeArtifactRefSchema,
        publicContractParityArtifact: aflTradeArtifactRefSchema,
        shadowEvaluationArtifact: aflTradeArtifactRefSchema,
        rollbackRehearsalArtifact: aflTradeArtifactRefSchema,
      })
      .strict(),
    reviewers: z.array(reviewerSchema).min(2).max(20),
    decision: z.enum(AFL_TRADE_MODEL_CHANGE_REVIEW_DECISIONS),
    decisionRationale: boundedTextSchema,
    monitoringPlanArtifact: aflTradeArtifactRefSchema,
    rollbackPlanArtifact: aflTradeArtifactRefSchema,
    nextAuthority: z.literal('gate_3_decision_ledger'),
  })
  .strict()
  .superRefine((review, context) => {
    if ((review.reviewSequence === 1) !== (review.previousReviewId === null)) {
      context.addIssue({
        code: 'custom',
        path: ['previousReviewId'],
        message: 'Only the first review may omit its append-only predecessor.',
      });
    }
    if (Date.parse(review.reviewedAt) < Date.parse(review.proposedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['reviewedAt'],
        message: 'A model-change review cannot finish before it is proposed.',
      });
    }
    if (
      Date.parse(review.preRegisteredChangePlanArtifact.createdAt) > Date.parse(review.proposedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['preRegisteredChangePlanArtifact', 'createdAt'],
        message: 'The change plan must exist no later than proposal time.',
      });
    }
    if (review.currentRelease.valuationBundleId === review.candidateRelease.valuationBundleId) {
      context.addIssue({
        code: 'custom',
        path: ['candidateRelease', 'valuationBundleId'],
        message: 'Recalibration and model changes require a distinct candidate release.',
      });
    }
    const changeAreas = review.changes.map((change) => change.area);
    if (new Set(changeAreas).size !== changeAreas.length) {
      context.addIssue({
        code: 'custom',
        path: ['changes'],
        message: 'Each declared model-change area must be unique.',
      });
    }
    const reviewerIds = review.reviewers.map((reviewer) => reviewer.reviewer);
    const reviewerResponsibilities = review.reviewers.map((reviewer) => reviewer.responsibility);
    if (
      new Set(reviewerIds).size !== reviewerIds.length ||
      reviewerIds.includes(review.proposedBy) ||
      new Set(reviewerResponsibilities).size !== reviewerResponsibilities.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reviewers'],
        message:
          'Reviewers and responsibilities must be unique, and reviewers must be independent from the proposer.',
      });
    }
    if (
      review.reviewers.some(
        (reviewer) =>
          Date.parse(reviewer.reviewedAt) < Date.parse(review.proposedAt) ||
          Date.parse(reviewer.reviewedAt) > Date.parse(review.reviewedAt)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reviewers'],
        message: 'Reviewer attestations must fall inside the review window.',
      });
    }
    const allAdvance = review.reviewers.every((reviewer) => reviewer.recommendation === 'advance');
    if (review.decision === 'recommend_gate_3_review' && !allAdvance) {
      context.addIssue({
        code: 'custom',
        path: ['decision'],
        message: 'Every independent reviewer must recommend advance before Gate 3 review.',
      });
    }
    const changesValueUnit = review.changes.some((change) => change.area === 'value_unit');
    if (
      changesValueUnit !== (review.compatibilityDisposition === 'new_value_unit_required') &&
      review.compatibilityDisposition !== 'incompatible_reject'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['compatibilityDisposition'],
        message:
          'Value-unit changes require a new value unit; unchanged units must remain compatible.',
      });
    }
    if (
      review.decision === 'recommend_gate_3_review' &&
      review.compatibilityDisposition === 'incompatible_reject'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['decision'],
        message: 'An incompatible candidate cannot advance to Gate 3 review.',
      });
    }
  });

export const aflTradeModelChangeReviewSchema = z
  .object({
    reviewId: aflTradeContentAddressedIdSchema('model-change-review'),
    content: aflTradeModelChangeReviewContentSchema,
  })
  .strict()
  .superRefine((review, context) => {
    addAflTradeContentAddressIssue(
      'model-change-review',
      review.reviewId,
      review.content,
      context,
      ['reviewId']
    );
  });

export type AflTradeModelChangeReviewContent = z.infer<
  typeof aflTradeModelChangeReviewContentSchema
>;
export type AflTradeModelChangeReview = z.infer<typeof aflTradeModelChangeReviewSchema>;

export function createAflTradeModelChangeReview(
  unparsedContent: AflTradeModelChangeReviewContent
): AflTradeModelChangeReview {
  const content = aflTradeModelChangeReviewContentSchema.parse(unparsedContent);
  return aflTradeModelChangeReviewSchema.parse({
    reviewId: createAflTradeContentAddress('model-change-review', content),
    content,
  });
}
