import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const addressed = (prefix: string) => z.string().regex(new RegExp(`^${prefix}:[a-f0-9]{64}$`, 'u'));
const use = z.enum([
  'model_training',
  'derived_feature_creation',
  'public_derived_output',
  'public_fact_display',
  'live_product_activation',
  'other_documented_methods',
]);
const field = z
  .object({
    sourceField: z.string().min(1),
    normalizedField: z.string().min(1),
    attributionRequired: z.boolean(),
    notes: z.string().nullable(),
    uses: z
      .object({
        archive_fact: z.enum(['allowed', 'blocked', 'not_applicable']),
        model_training: z.enum(['allowed', 'blocked', 'not_applicable']),
        derived_feature: z.enum(['allowed', 'blocked', 'not_applicable']),
        public_display: z.enum(['allowed', 'blocked', 'not_applicable']),
      })
      .strict(),
  })
  .strict();
const captureBinding = z
  .object({
    captureId: addressed('source-capture'),
    recordedAt: z.iso.datetime({ offset: true }),
    recordSha256: digest,
    gateDecisionId: addressed('gate-decision'),
    rightsArtifactId: addressed('source-rights'),
    sourceSnapshotId: addressed('source-snapshot'),
  })
  .strict();
const originalRights = z
  .object({
    rightsArtifactId: addressed('source-rights'),
    provider: z.string().min(1),
    dataset: z.string().min(1),
    fields: z.array(field).min(1),
  })
  .strict();
const inputSchema = z
  .object({
    schemaVersion: z.literal('statly-retained-source-use-successor-input/v1'),
    recordedAt: z.iso.datetime({ offset: true }),
    state: z.literal('exact_input_prepared_technical_admission_pending'),
    factualReleaseId: addressed('outcome-release'),
    sourceCaptureSetSha256: digest,
    ownerApprovalPath: z.string().min(1),
    ownerApprovalSha256: digest,
    ownerApprovedUses: z.array(use).min(1),
    condition: z.string().min(1),
    captureBindings: z.array(captureBinding).min(1).max(1_000),
    originalRights: z.array(originalRights).min(1).max(1_000),
    captureCount: z.number().int().positive(),
    rightsCount: z.number().int().positive(),
  })
  .strict();
const approvalSchema = z
  .object({
    decision: z.literal('approved'),
    approvedBy: z.literal('statly-product-owner'),
    approvedAt: z.iso.datetime({ offset: true }),
    ownerAuthorization: z
      .object({
        approvedUses: z.array(z.string()).min(1),
        condition: z.string().min(1),
        scope: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();

const requiredUses = use.options;
const expectedOwnerUses = [
  'factual evaluation',
  'model training and approval',
  'valuation and grading',
  'public data and grade publication',
  'live product activation',
  'retained source evidence as a basis for other documented methods',
];

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Seals the owner's decision to one factual release and its exact retained capture/field set.
 * This is a source-use successor candidate. Durable custody and consuming gates must authenticate
 * the original release/captures and this record before it grants any technical authority.
 */
export function createAflTradeRetainedSourceUseSuccessor(
  rawInput: unknown,
  rawOwnerApproval: string
) {
  const input = inputSchema.parse(rawInput);
  const approval = approvalSchema.parse(JSON.parse(rawOwnerApproval) as unknown);
  const captures = [...input.captureBindings].sort((a, b) =>
    a.captureId.localeCompare(b.captureId)
  );
  const rights = [...input.originalRights].sort((a, b) =>
    a.rightsArtifactId.localeCompare(b.rightsArtifactId)
  );
  const captureIds = captures.map(({ captureId }) => captureId);
  const rightsIds = rights.map(({ rightsArtifactId }) => rightsArtifactId);
  const observedRightsIds = [
    ...new Set(captures.map(({ rightsArtifactId }) => rightsArtifactId)),
  ].sort();
  if (
    input.captureCount !== captures.length ||
    input.rightsCount !== rights.length ||
    new Set(captureIds).size !== captureIds.length ||
    new Set(rightsIds).size !== rightsIds.length ||
    canonicalizeAflTradeJson(rightsIds) !== canonicalizeAflTradeJson(observedRightsIds) ||
    sha256(canonicalizeAflTradeJson(captures)) !== input.sourceCaptureSetSha256
  ) {
    throw new TypeError('Retained source-use successor does not cover the exact capture set.');
  }
  if (
    sha256(rawOwnerApproval) !== input.ownerApprovalSha256 ||
    requiredUses.length !== input.ownerApprovedUses.length ||
    requiredUses.some((operation) => !input.ownerApprovedUses.includes(operation)) ||
    canonicalizeAflTradeJson(approval.ownerAuthorization.approvedUses) !==
      canonicalizeAflTradeJson(expectedOwnerUses)
  ) {
    throw new TypeError('Retained source-use successor lacks the exact owner approval.');
  }
  for (const proposal of rights) {
    const sourceFields = proposal.fields.map(({ sourceField }) => sourceField);
    const normalizedFields = proposal.fields.map(({ normalizedField }) => normalizedField);
    if (
      new Set(sourceFields).size !== sourceFields.length ||
      new Set(normalizedFields).size !== normalizedFields.length
    ) {
      throw new TypeError('Retained source-use successor contains duplicate source fields.');
    }
  }

  const content = {
    schemaVersion: 'afl-trade-retained-source-use-successor/v1' as const,
    factualReleaseId: input.factualReleaseId,
    sourceCaptureSetSha256: input.sourceCaptureSetSha256,
    ownerApprovalSha256: input.ownerApprovalSha256,
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
    approvedUses: [...input.ownerApprovedUses].sort(),
    ownerCondition: approval.ownerAuthorization.condition,
    methodCondition: input.condition,
    originalRights: rights,
    captureBindings: captures,
    rawFieldRedistributionPermitted: false as const,
    state: 'candidate_requires_durable_authentication' as const,
  };
  return {
    successorId: createAflTradeContentAddress('retained-source-use-successor', content),
    content,
  };
}

export type AflTradeRetainedSourceUseSuccessor = ReturnType<
  typeof createAflTradeRetainedSourceUseSuccessor
>;
