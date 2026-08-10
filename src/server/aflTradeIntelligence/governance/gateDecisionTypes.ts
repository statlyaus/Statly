import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
} from '../artifacts/contentAddress';

export const AFL_TRADE_GATE_CODES = [
  'gate_0a_permission_to_evaluate',
  'gate_0b_data_sufficiency',
  'gate_1_architecture_authority',
  'gate_2_corpus_lineage',
  'gate_3_model_validity',
  'gate_4_publication_api_readiness',
  'gate_5_comprehension_accessibility',
  'gate_6_production_verification',
] as const;

export const AFL_TRADE_GATE_DECISION_STATES = [
  'pending',
  'approved',
  'blocked',
  'expired',
  'withdrawn',
] as const;

export const AFL_TRADE_DECISION_ENVIRONMENTS = [
  'test_fixture',
  'non_production',
  'production',
] as const;

export const AFL_TRADE_GOVERNED_ARTIFACT_KINDS = [
  'source_rights',
  'gate0a_evaluation',
  'data_sufficiency_protocol',
  'evidence_manifest',
  'coverage_report',
  'corpus_manifest',
  'dataset',
  'model_protocol',
  'model_run',
  'valuation_bundle',
  'publication',
  'projection',
  'factual_release',
  'factual_release_candidate',
  'factual_projection',
  'corpus_factual_lineage',
  'architecture_current_state',
  'architecture_decision_package',
  'authority_transition',
] as const;

const governedArtifactPrefixes = {
  source_rights: 'source-rights',
  gate0a_evaluation: 'gate0a-evaluation',
  data_sufficiency_protocol: 'data-sufficiency-protocol',
  evidence_manifest: 'evidence',
  coverage_report: 'coverage-report',
  corpus_manifest: 'corpus',
  dataset: 'dataset',
  model_protocol: 'model-protocol',
  model_run: 'model-run',
  valuation_bundle: 'valuation-bundle',
  publication: 'publication',
  projection: 'projection',
  factual_release: 'outcome-release',
  factual_release_candidate: 'factual-release-candidate',
  factual_projection: 'outcome-projection',
  corpus_factual_lineage: 'corpus-factual-lineage',
  architecture_current_state: 'architecture-current-state',
  architecture_decision_package: 'architecture-decision-package',
  authority_transition: 'authority-transition',
} as const satisfies Record<(typeof AFL_TRADE_GOVERNED_ARTIFACT_KINDS)[number], string>;

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const immutableReferenceSchema = z.string().regex(/^[a-z][a-z0-9-]*:[a-f0-9]{64}$/);
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const boundedTextSchema = z.string().trim().min(1).max(1000);

export const aflTradeGateScopeSchema = z
  .object({
    scopeKey: publicIdSchema,
    description: boundedTextSchema,
    dimensions: z
      .array(
        z
          .object({
            name: publicIdSchema,
            values: z.array(publicIdSchema).min(1).max(500),
          })
          .strict()
      )
      .max(50),
    exclusions: z.array(boundedTextSchema).max(100),
  })
  .strict()
  .superRefine((scope, context) => {
    const dimensionNames = scope.dimensions.map((dimension) => dimension.name);
    if (new Set(dimensionNames).size !== dimensionNames.length) {
      context.addIssue({
        code: 'custom',
        path: ['dimensions'],
        message: 'Gate scope dimensions must be unique.',
      });
    }
    for (const [index, dimension] of scope.dimensions.entries()) {
      if (new Set(dimension.values).size !== dimension.values.length) {
        context.addIssue({
          code: 'custom',
          path: ['dimensions', index, 'values'],
          message: 'Gate scope dimension values must be unique.',
        });
      }
    }
  });

const proposedConditionSchema = z
  .object({
    conditionId: publicIdSchema,
    description: boundedTextSchema,
    required: z.boolean(),
    verificationEvidenceIds: z.array(immutableReferenceSchema).max(50),
  })
  .strict();

export const aflTradeGovernedArtifactRefSchema = z
  .object({
    kind: z.enum(AFL_TRADE_GOVERNED_ARTIFACT_KINDS),
    artifactId: immutableReferenceSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    const expectedPrefix = governedArtifactPrefixes[artifact.kind];
    if (!aflTradeContentAddressedIdSchema(expectedPrefix).safeParse(artifact.artifactId).success) {
      context.addIssue({
        code: 'custom',
        path: ['artifactId'],
        message: `Artifact kind ${artifact.kind} requires a ${expectedPrefix}: content address.`,
      });
    }
  });

const affectedArtifactsSchema = z
  .array(aflTradeGovernedArtifactRefSchema)
  .max(500)
  .superRefine((artifacts, context) => {
    const identities = artifacts.map((artifact) => `${artifact.kind}|${artifact.artifactId}`);
    if (new Set(identities).size !== identities.length) {
      context.addIssue({
        code: 'custom',
        message: 'Affected artifact references must be unique.',
      });
    }
  });

export const aflTradeGateDecisionProposalContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-gate-proposal/v1'),
    gate: z.enum(AFL_TRADE_GATE_CODES),
    decisionKey: publicIdSchema,
    version: z.number().int().positive(),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    scope: aflTradeGateScopeSchema,
    proposal: boundedTextSchema,
    alternativesConsidered: z.array(boundedTextSchema).min(1).max(20),
    accountableOwner: publicIdSchema,
    reviewRequirement: z.enum(['accountable_owner_only', 'independent_review_required']),
    requiredReviewerRoles: z.array(publicIdSchema).max(20),
    conditions: z.array(proposedConditionSchema).max(100),
    evidenceIds: z.array(immutableReferenceSchema).max(100),
    affectedArtifacts: affectedArtifactsSchema,
    proposedAt: isoDateTimeSchema,
    proposedBy: publicIdSchema,
    proposalOrigin: z.enum(['human_authored', 'agent_assisted']),
  })
  .strict()
  .superRefine((proposal, context) => {
    const conditionIds = proposal.conditions.map((condition) => condition.conditionId);
    if (new Set(conditionIds).size !== conditionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['conditions'],
        message: 'Gate proposal conditions must be unique.',
      });
    }
    if (new Set(proposal.requiredReviewerRoles).size !== proposal.requiredReviewerRoles.length) {
      context.addIssue({
        code: 'custom',
        path: ['requiredReviewerRoles'],
        message: 'Required reviewer roles must be unique.',
      });
    }
    if (
      proposal.reviewRequirement === 'independent_review_required' &&
      proposal.requiredReviewerRoles.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['requiredReviewerRoles'],
        message: 'Independent review requires at least one declared reviewer role.',
      });
    }
  });

export const aflTradeGateDecisionProposalSchema = z
  .object({
    proposalId: aflTradeContentAddressedIdSchema('gate-proposal'),
    content: aflTradeGateDecisionProposalContentSchema,
  })
  .strict()
  .superRefine((proposal, context) => {
    addAflTradeContentAddressIssue(
      'gate-proposal',
      proposal.proposalId,
      proposal.content,
      context,
      ['proposalId']
    );
  });

const decidedConditionSchema = z
  .object({
    conditionId: publicIdSchema,
    status: z.enum(['satisfied', 'unsatisfied', 'not_applicable']),
    evidenceIds: z.array(immutableReferenceSchema).max(50),
    explanation: boundedTextSchema,
  })
  .strict();

const reviewerSchema = z
  .object({
    reviewerId: publicIdSchema,
    role: publicIdSchema,
    evidenceId: immutableReferenceSchema,
  })
  .strict();

const aflTradeGateDecisionRecordContentBaseSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-gate-decision/v1'),
    proposalId: aflTradeContentAddressedIdSchema('gate-proposal'),
    gate: z.enum(AFL_TRADE_GATE_CODES),
    decisionKey: publicIdSchema,
    version: z.number().int().positive(),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    scope: aflTradeGateScopeSchema,
    state: z.enum(AFL_TRADE_GATE_DECISION_STATES),
    authorityKind: z.enum(['fixture', 'external_human_record']),
    accountableOwner: publicIdSchema,
    decidedBy: publicIdSchema.nullable(),
    reviewers: z.array(reviewerSchema).max(20),
    authorityEvidenceIds: z.array(immutableReferenceSchema).max(100),
    conditionResults: z.array(decidedConditionSchema).max(100),
    rationale: boundedTextSchema.nullable(),
    limitations: z.array(boundedTextSchema).max(100),
    decidedAt: isoDateTimeSchema.nullable(),
    effectiveAt: isoDateTimeSchema.nullable(),
    revalidateAt: isoDateTimeSchema.nullable(),
    supersedesDecisionId: aflTradeContentAddressedIdSchema('gate-decision').nullable(),
    affectedArtifacts: affectedArtifactsSchema,
    withdrawalActions: z.array(boundedTextSchema).max(50),
  })
  .strict();

type AflTradeGateDecisionRecordContent = z.infer<
  typeof aflTradeGateDecisionRecordContentBaseSchema
>;

function refineDecisionRecordUniqueness(
  decision: AflTradeGateDecisionRecordContent,
  context: z.RefinementCtx
) {
  const conditionIds = decision.conditionResults.map((condition) => condition.conditionId);
  if (new Set(conditionIds).size !== conditionIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['conditionResults'],
      message: 'Decision condition results must be unique.',
    });
  }
  const reviewerIds = decision.reviewers.map((reviewer) => reviewer.reviewerId);
  if (new Set(reviewerIds).size !== reviewerIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['reviewers'],
      message: 'Decision reviewers must be unique.',
    });
  }
}

function refinePendingDecisionRecord(
  decision: AflTradeGateDecisionRecordContent,
  context: z.RefinementCtx
) {
  if (
    decision.decidedBy !== null ||
    decision.decidedAt !== null ||
    decision.effectiveAt !== null ||
    decision.revalidateAt !== null
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Pending decisions cannot contain completed decision times or authority.',
    });
  }
}

function refineFinalizedDecisionRecord(
  decision: AflTradeGateDecisionRecordContent,
  context: z.RefinementCtx
) {
  if (
    decision.decidedBy === null ||
    decision.decidedAt === null ||
    decision.effectiveAt === null ||
    decision.rationale === null ||
    decision.authorityEvidenceIds.length === 0
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Finalized decisions require authority, evidence, rationale, and decision times.',
    });
  }
  if (
    decision.decidedAt !== null &&
    decision.effectiveAt !== null &&
    Date.parse(decision.effectiveAt) < Date.parse(decision.decidedAt)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['effectiveAt'],
      message: 'A decision cannot become effective before it is recorded.',
    });
  }
}

function refineApprovedDecisionRecord(
  decision: AflTradeGateDecisionRecordContent,
  context: z.RefinementCtx
) {
  if (decision.revalidateAt === null) {
    context.addIssue({
      code: 'custom',
      path: ['revalidateAt'],
      message: 'Approved decisions require a revalidation time.',
    });
  } else if (
    decision.effectiveAt !== null &&
    Date.parse(decision.revalidateAt) <= Date.parse(decision.effectiveAt)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['revalidateAt'],
      message: 'Revalidation must follow the effective time.',
    });
  }
  if (decision.environment === 'production' && decision.authorityKind !== 'external_human_record') {
    context.addIssue({
      code: 'custom',
      path: ['authorityKind'],
      message: 'Production approval requires an externally recorded human decision.',
    });
  }
}

function refineWithdrawnDecisionRecord(
  decision: AflTradeGateDecisionRecordContent,
  context: z.RefinementCtx
) {
  if (decision.withdrawalActions.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['withdrawalActions'],
      message: 'Withdrawn decisions require at least one downstream action.',
    });
  }
}

export const aflTradeGateDecisionRecordContentSchema =
  aflTradeGateDecisionRecordContentBaseSchema.superRefine((decision, context) => {
    refineDecisionRecordUniqueness(decision, context);
    if (decision.state === 'pending') {
      refinePendingDecisionRecord(decision, context);
      return;
    }
    refineFinalizedDecisionRecord(decision, context);
    if (decision.state === 'approved') refineApprovedDecisionRecord(decision, context);
    if (decision.state === 'withdrawn') refineWithdrawnDecisionRecord(decision, context);
  });

export const aflTradeGateDecisionRecordSchema = z
  .object({
    decisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    content: aflTradeGateDecisionRecordContentSchema,
  })
  .strict()
  .superRefine((decision, context) => {
    addAflTradeContentAddressIssue(
      'gate-decision',
      decision.decisionId,
      decision.content,
      context,
      ['decisionId']
    );
  });

export type AflTradeGateCode = (typeof AFL_TRADE_GATE_CODES)[number];
export type AflTradeGateDecisionState = (typeof AFL_TRADE_GATE_DECISION_STATES)[number];
export type AflTradeDecisionEnvironment = (typeof AFL_TRADE_DECISION_ENVIRONMENTS)[number];
export type AflTradeGovernedArtifactKind = (typeof AFL_TRADE_GOVERNED_ARTIFACT_KINDS)[number];
export type AflTradeGovernedArtifactRef = z.infer<typeof aflTradeGovernedArtifactRefSchema>;
export type AflTradeGateScope = z.infer<typeof aflTradeGateScopeSchema>;
export type AflTradeGateDecisionProposal = z.infer<typeof aflTradeGateDecisionProposalSchema>;
export type AflTradeGateDecisionRecord = z.infer<typeof aflTradeGateDecisionRecordSchema>;
