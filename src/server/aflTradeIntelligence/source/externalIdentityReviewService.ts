import { z } from 'zod';

import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';
import {
  aflTradeExternalIdentityReviewDecisionSchema,
  createAflTradeExternalIdentityReviewDecision,
  type AflTradeExternalIdentityReviewDecision,
  type AflTradeExternalIdentityReviewPackage,
} from './externalIdentityReviewContracts';
import { buildAflTradeExternalIdentityReviewPackage } from './externalIdentityReviewWorkBuilder';
import type { AflTradeHistoricalReconciliationSource } from './externalHistoricalReconciliationPreparation';
import type {
  PersistAflTradeExternalIdentityReviewInput,
  PersistedAflTradeExternalIdentityReview,
} from './postgresExternalIdentityReviewRepository';

const instantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid UTC instant.');

const queueInputSchema = z
  .object({
    completionId: aflTradeContentAddressedIdSchema('external-historical-capture-completion'),
  })
  .strict();

const recordInputSchema = queueInputSchema
  .extend({
    subjectId: aflTradeContentAddressedIdSchema('external-identity-subject'),
    decision: z.enum(['approved', 'rejected', 'withdrawn']),
    canonicalId: z.string().trim().min(1).max(240).nullable().optional(),
    rationale: z.string().trim().min(1).max(4_000),
    authorityEvidenceId: aflTradeContentAddressedIdSchema('reviewer-authority-evidence'),
    decidedBy: z.string().trim().min(1).max(240),
    decidedAt: instantSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.decision === 'approved' && !input.canonicalId) {
      context.addIssue({
        code: 'custom',
        path: ['canonicalId'],
        message: 'Approved identity decisions require one canonical target.',
      });
    }
    if (input.decision !== 'approved' && input.canonicalId !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['canonicalId'],
        message: 'Rejected or withdrawn identity decisions cannot name a canonical target.',
      });
    }
  });

export interface AflTradeExternalIdentityReviewRepository {
  loadCurrentDecisions(
    reviewPackage: unknown
  ): Promise<readonly AflTradeExternalIdentityReviewDecision[]>;
  loadCurrentDecision(subjectId: string): Promise<AflTradeExternalIdentityReviewDecision | null>;
  loadCanonicalTargetSnapshot(input: {
    entityKind: 'club' | 'player';
    canonicalId: string;
  }): Promise<{
    entityKind: 'club' | 'player';
    canonicalId: string;
    recordedLabel: string;
    status: 'approved';
    snapshotSha256: string;
  }>;
  persistDecision(
    input: PersistAflTradeExternalIdentityReviewInput
  ): Promise<PersistedAflTradeExternalIdentityReview>;
}

export interface AflTradeExternalIdentityReviewDependencies {
  source: AflTradeHistoricalReconciliationSource;
  reviewRepository: AflTradeExternalIdentityReviewRepository;
}

async function loadReviewPackage(
  completionId: string,
  dependencies: AflTradeExternalIdentityReviewDependencies
): Promise<AflTradeExternalIdentityReviewPackage> {
  const source = await dependencies.source.load(completionId);
  if (source.sourceAuthority.completionId !== completionId) {
    throw new TypeError('Loaded historical source does not match the requested completion.');
  }
  return buildAflTradeExternalIdentityReviewPackage({
    environment: source.environment,
    competition: source.competition,
    sourceAuthority: source.sourceAuthority,
    sourceBatches: source.sourceBatches,
  });
}

function decisionMatchesItem(
  decision: AflTradeExternalIdentityReviewDecision,
  item: AflTradeExternalIdentityReviewPackage['content']['items'][number]
): boolean {
  return (
    decision.content.workItemId === item.workItemId &&
    decision.content.workItemSha256 === item.workItemSha256
  );
}

export async function loadAflTradeExternalIdentityReviewQueue(
  unparsedInput: unknown,
  dependencies: AflTradeExternalIdentityReviewDependencies
) {
  const input = queueInputSchema.parse(unparsedInput);
  const reviewPackage = await loadReviewPackage(input.completionId, dependencies);
  const currentDecisions = await dependencies.reviewRepository.loadCurrentDecisions(reviewPackage);
  const currentBySubject = new Map(
    currentDecisions.map((decision) => {
      const parsed = aflTradeExternalIdentityReviewDecisionSchema.parse(decision);
      return [parsed.content.subject.subjectId, parsed] as const;
    })
  );
  const items = reviewPackage.content.items.map((item) => {
    const current = currentBySubject.get(item.subjectId) ?? null;
    const exact = current !== null && decisionMatchesItem(current, item);
    return {
      subjectId: item.subjectId,
      workItemId: item.workItemId,
      entityKind: item.workItem.content.subject.content.entityKind,
      provider: item.workItem.content.subject.content.provider,
      identityScope: item.workItem.content.subject.content.identityScope,
      observedNames: item.workItem.content.observedNames,
      validFromSeason: item.workItem.content.validFromSeason,
      validThroughSeason: item.workItem.content.validThroughSeason,
      observationCount: item.workItem.content.observations.length,
      status: exact ? current.content.decision : ('unresolved' as const),
      currentDecisionId: current?.decisionId ?? null,
      canonicalTarget: exact ? current.content.canonicalTarget : null,
    };
  });
  return {
    reviewPackageId: reviewPackage.packageId,
    completionId: input.completionId,
    items,
    unresolvedCount: items.filter(({ status }) => status === 'unresolved').length,
    promotionEligible: false as const,
    publicationEligible: false as const,
    reviewPackage,
  };
}

export async function recordAflTradeExternalIdentityReviewDecision(
  unparsedInput: unknown,
  dependencies: AflTradeExternalIdentityReviewDependencies
): Promise<PersistedAflTradeExternalIdentityReview> {
  const input = recordInputSchema.parse(unparsedInput);
  const reviewPackage = await loadReviewPackage(input.completionId, dependencies);
  const membership = reviewPackage.content.items.find(
    ({ subjectId }) => subjectId === input.subjectId
  );
  if (!membership) {
    throw new TypeError('Identity subject is not a member of the requested completion package.');
  }
  const current = await dependencies.reviewRepository.loadCurrentDecision(input.subjectId);
  const canonicalTarget =
    input.decision === 'approved'
      ? await dependencies.reviewRepository.loadCanonicalTargetSnapshot({
          entityKind: membership.workItem.content.subject.content.entityKind,
          canonicalId: input.canonicalId!,
        })
      : null;
  const decision = createAflTradeExternalIdentityReviewDecision({
    subject: membership.workItem.content.subject,
    reviewPackageId: reviewPackage.packageId,
    reviewPackageSha256: reviewPackage.packageId.slice('external-identity-review-package:'.length),
    workItemId: membership.workItemId,
    workItemSha256: membership.workItemSha256,
    workItem: membership.workItem,
    revision: (current?.content.revision ?? 0) + 1,
    supersedesDecisionId: current?.decisionId ?? null,
    decision: input.decision,
    canonicalTarget,
    rationale: input.rationale,
    authorityEvidenceId: input.authorityEvidenceId,
    decidedBy: input.decidedBy,
    decidedAt: input.decidedAt,
  });
  return dependencies.reviewRepository.persistDecision({ reviewPackage, decision });
}
