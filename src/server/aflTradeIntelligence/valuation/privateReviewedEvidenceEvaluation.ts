import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

export const AFL_TRADE_PRIVATE_REVIEWED_EVIDENCE_BUNDLE_SCHEMA_VERSION =
  'afl-trade-private-reviewed-evidence-bundle/v1' as const;
export const AFL_TRADE_PRIVATE_REVIEWED_EVIDENCE_DECISION_SCHEMA_VERSION =
  'afl-trade-private-reviewed-evidence-evaluation-decision/v1' as const;
export const AFL_TRADE_PRIVATE_REVIEWED_EVIDENCE_AUTHORITY_BOUNDARY =
  'exact_current_private_review_sets_and_retained_source_artifacts_for_internal_nonproduction_calculation_only' as const;

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);

const reviewSetSchema = z
  .object({
    reviewSetId: aflTradeSha256Schema,
    reviewSetDecisionId: publicIdSchema,
    reviewerId: publicIdSchema,
    candidateCount: z.number().int().positive().max(1_000_000),
    decisionCount: z.number().int().positive().max(3_000_000),
    reviewSetArtifact: aflTradeArtifactRefSchema,
  })
  .strict();

const sourceCaptureSchema = z
  .object({
    captureId: publicIdSchema,
    provider: publicIdSchema,
    capabilityId: publicIdSchema,
    seasonYear: z.number().int().min(1897).max(2200),
    sourceArtifact: aflTradeArtifactRefSchema,
  })
  .strict();

const bundleContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PRIVATE_REVIEWED_EVIDENCE_BUNDLE_SCHEMA_VERSION),
    authorityBoundary: z.literal(AFL_TRADE_PRIVATE_REVIEWED_EVIDENCE_AUTHORITY_BOUNDARY),
    environment: z.literal('non_production'),
    evidenceKind: z.literal('retained_private_review'),
    evidenceScopeKey: publicIdSchema,
    reviewSets: z.array(reviewSetSchema).min(1).max(20),
    sourceCaptures: z.array(sourceCaptureSchema).min(1).max(1_000),
    sourceRightsEvidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(1_000),
    candidateCount: z.number().int().positive().max(1_000_000),
    decisionCount: z.number().int().positive().max(3_000_000),
    createdAt: z.iso.datetime({ offset: true }),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(
      'Exact retained private review evidence only; not a factual release, model-training input, public fact set, publication candidate, production authority, or live-capture authority.'
    ),
  })
  .strict()
  .superRefine((content, context) => {
    const reviewSetIds = content.reviewSets.map(({ reviewSetId }) => reviewSetId);
    const captureIds = content.sourceCaptures.map(({ captureId }) => captureId);
    const rightsIds = content.sourceRightsEvidenceRefs.map(({ artifactId }) => artifactId);
    const sortedUnique = (values: readonly string[]) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value);
    if (!sortedUnique(reviewSetIds)) {
      context.addIssue({
        code: 'custom',
        path: ['reviewSets'],
        message: 'Review sets must be unique and canonically ordered.',
      });
    }
    if (!sortedUnique(captureIds)) {
      context.addIssue({
        code: 'custom',
        path: ['sourceCaptures'],
        message: 'Source captures must be unique and canonically ordered.',
      });
    }
    if (!sortedUnique(rightsIds)) {
      context.addIssue({
        code: 'custom',
        path: ['sourceRightsEvidenceRefs'],
        message: 'Source-rights evidence must be unique and canonically ordered.',
      });
    }
    if (
      content.candidateCount !==
        content.reviewSets.reduce((total, reviewSet) => total + reviewSet.candidateCount, 0) ||
      content.decisionCount !==
        content.reviewSets.reduce((total, reviewSet) => total + reviewSet.decisionCount, 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Reviewed evidence bundle counts must equal the exact review-set totals.',
      });
    }
  });

export const aflTradePrivateReviewedEvidenceBundleSchema = z
  .object({
    evidenceBundleId: aflTradeContentAddressedIdSchema('private-reviewed-evidence-bundle'),
    content: bundleContentSchema,
  })
  .strict()
  .superRefine((bundle, context) => {
    addAflTradeContentAddressIssue(
      'private-reviewed-evidence-bundle',
      bundle.evidenceBundleId,
      bundle.content,
      context,
      ['evidenceBundleId']
    );
  });

const decisionContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PRIVATE_REVIEWED_EVIDENCE_DECISION_SCHEMA_VERSION),
    authorityBoundary: z.literal(AFL_TRADE_PRIVATE_REVIEWED_EVIDENCE_AUTHORITY_BOUNDARY),
    environment: z.literal('non_production'),
    operation: z.literal('private_nonproduction_derived_calculation'),
    evidenceKind: z.literal('retained_private_review'),
    status: z.enum(['authorized', 'withdrawn']),
    valuationScopeKey: publicIdSchema,
    evidenceBundleId: aflTradeContentAddressedIdSchema('private-reviewed-evidence-bundle'),
    evidenceBundleArtifact: aflTradeArtifactRefSchema,
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
      'private-reviewed-evidence-evaluation-decision'
    ).nullable(),
    reviewerId: publicIdSchema,
    rationale: z.string().trim().min(1).max(2_000),
    decidedAt: z.iso.datetime({ offset: true }),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(
      'This decision authorizes only private local non-production derived calculations from the exact retained reviewed evidence bundle for internal evaluation. It grants no model-training, public-display, redistribution, production-activation, live-capture, factual-release, or publication authority.'
    ),
  })
  .strict()
  .superRefine((content, context) => {
    if ((content.revision === 1) !== (content.supersedesDecisionId === null)) {
      context.addIssue({
        code: 'custom',
        path: ['supersedesDecisionId'],
        message: 'The decision must form an explicit append-only revision chain.',
      });
    }
  });

export const aflTradePrivateReviewedEvidenceEvaluationDecisionSchema = z
  .object({
    decisionId: aflTradeContentAddressedIdSchema('private-reviewed-evidence-evaluation-decision'),
    content: decisionContentSchema,
  })
  .strict()
  .superRefine((decision, context) => {
    addAflTradeContentAddressIssue(
      'private-reviewed-evidence-evaluation-decision',
      decision.decisionId,
      decision.content,
      context,
      ['decisionId']
    );
  });

export type AflTradePrivateReviewedEvidenceBundle = z.infer<
  typeof aflTradePrivateReviewedEvidenceBundleSchema
>;
export type AflTradePrivateReviewedEvidenceEvaluationDecision = z.infer<
  typeof aflTradePrivateReviewedEvidenceEvaluationDecisionSchema
>;

export function createAflTradePrivateReviewedEvidenceBundle(input: {
  readonly evidenceScopeKey: string;
  readonly reviewSets: readonly z.input<typeof reviewSetSchema>[];
  readonly sourceCaptures: readonly z.input<typeof sourceCaptureSchema>[];
  readonly sourceRightsEvidenceRefs: readonly AflTradeArtifactRef[];
  readonly createdAt: string;
}): AflTradePrivateReviewedEvidenceBundle {
  const reviewSets = [...input.reviewSets].sort((left, right) =>
    left.reviewSetId.localeCompare(right.reviewSetId)
  );
  const sourceCaptures = [...input.sourceCaptures].sort((left, right) =>
    left.captureId.localeCompare(right.captureId)
  );
  const sourceRightsEvidenceRefs = [...input.sourceRightsEvidenceRefs].sort((left, right) =>
    left.artifactId.localeCompare(right.artifactId)
  );
  const content = bundleContentSchema.parse({
    schemaVersion: AFL_TRADE_PRIVATE_REVIEWED_EVIDENCE_BUNDLE_SCHEMA_VERSION,
    authorityBoundary: AFL_TRADE_PRIVATE_REVIEWED_EVIDENCE_AUTHORITY_BOUNDARY,
    environment: 'non_production',
    evidenceKind: 'retained_private_review',
    evidenceScopeKey: input.evidenceScopeKey,
    reviewSets,
    sourceCaptures,
    sourceRightsEvidenceRefs,
    candidateCount: reviewSets.reduce((total, reviewSet) => total + reviewSet.candidateCount, 0),
    decisionCount: reviewSets.reduce((total, reviewSet) => total + reviewSet.decisionCount, 0),
    createdAt: input.createdAt,
    publicationEligible: false,
    publicationProhibited: true,
    limitation:
      'Exact retained private review evidence only; not a factual release, model-training input, public fact set, publication candidate, production authority, or live-capture authority.',
  });
  return aflTradePrivateReviewedEvidenceBundleSchema.parse({
    evidenceBundleId: createAflTradeContentAddress('private-reviewed-evidence-bundle', content),
    content,
  });
}

export function createAflTradePrivateReviewedEvidenceEvaluationDecision(input: {
  readonly status: 'authorized' | 'withdrawn';
  readonly valuationScopeKey: string;
  readonly evidenceBundle: AflTradePrivateReviewedEvidenceBundle;
  readonly evidenceBundleArtifact: AflTradeArtifactRef;
  readonly revision: number;
  readonly supersedesDecisionId: string | null;
  readonly reviewerId: string;
  readonly rationale: string;
  readonly decidedAt: string;
}): AflTradePrivateReviewedEvidenceEvaluationDecision {
  const evidenceBundle = aflTradePrivateReviewedEvidenceBundleSchema.parse(input.evidenceBundle);
  const content = decisionContentSchema.parse({
    schemaVersion: AFL_TRADE_PRIVATE_REVIEWED_EVIDENCE_DECISION_SCHEMA_VERSION,
    authorityBoundary: AFL_TRADE_PRIVATE_REVIEWED_EVIDENCE_AUTHORITY_BOUNDARY,
    environment: 'non_production',
    operation: 'private_nonproduction_derived_calculation',
    evidenceKind: 'retained_private_review',
    status: input.status,
    valuationScopeKey: input.valuationScopeKey,
    evidenceBundleId: evidenceBundle.evidenceBundleId,
    evidenceBundleArtifact: input.evidenceBundleArtifact,
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
    revision: input.revision,
    supersedesDecisionId: input.supersedesDecisionId,
    reviewerId: input.reviewerId,
    rationale: input.rationale,
    decidedAt: input.decidedAt,
    publicationEligible: false,
    publicationProhibited: true,
    limitation:
      'This decision authorizes only private local non-production derived calculations from the exact retained reviewed evidence bundle for internal evaluation. It grants no model-training, public-display, redistribution, production-activation, live-capture, factual-release, or publication authority.',
  });
  return aflTradePrivateReviewedEvidenceEvaluationDecisionSchema.parse({
    decisionId: createAflTradeContentAddress(
      'private-reviewed-evidence-evaluation-decision',
      content
    ),
    content,
  });
}

export function parseAflTradePrivateReviewedEvidenceEvaluationDecision(
  input: unknown
): AflTradePrivateReviewedEvidenceEvaluationDecision {
  try {
    return aflTradePrivateReviewedEvidenceEvaluationDecisionSchema.parse(input);
  } catch {
    throw new TypeError(
      'Private reviewed-evidence evaluation decision failed exact authentication.'
    );
  }
}

export type AflTradePrivateReviewedEvidenceEvaluationAdmission =
  | {
      readonly state: 'authorized';
      readonly authority: {
        readonly kind: 'private_nonproduction_derived_calculation';
        readonly evidenceKind: 'retained_private_review';
        readonly decisionId: string;
        readonly valuationScopeKey: string;
        readonly evidenceBundleId: string;
        readonly evidenceBundleArtifact: AflTradeArtifactRef;
        readonly publicationEligible: false;
        readonly publicationProhibited: true;
      };
    }
  | {
      readonly state: 'blocked';
      readonly reason: 'not_authorized' | 'withdrawn';
      readonly decisionId: string | null;
    };

export function createAflTradePrivateReviewedEvidenceEvaluationAdmission(
  currentDecision: AflTradePrivateReviewedEvidenceEvaluationDecision | null
): AflTradePrivateReviewedEvidenceEvaluationAdmission {
  if (currentDecision === null) {
    return { state: 'blocked', reason: 'not_authorized', decisionId: null };
  }
  const decision = parseAflTradePrivateReviewedEvidenceEvaluationDecision(currentDecision);
  if (decision.content.status === 'withdrawn') {
    return { state: 'blocked', reason: 'withdrawn', decisionId: decision.decisionId };
  }
  return {
    state: 'authorized',
    authority: {
      kind: 'private_nonproduction_derived_calculation',
      evidenceKind: 'retained_private_review',
      decisionId: decision.decisionId,
      valuationScopeKey: decision.content.valuationScopeKey,
      evidenceBundleId: decision.content.evidenceBundleId,
      evidenceBundleArtifact: decision.content.evidenceBundleArtifact,
      publicationEligible: false,
      publicationProhibited: true,
    },
  };
}
