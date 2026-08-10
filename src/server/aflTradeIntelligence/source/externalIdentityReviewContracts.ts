import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';

export const AFL_TRADE_EXTERNAL_IDENTITY_SUBJECT_SCHEMA_VERSION =
  'afl-trade-external-identity-subject/v1' as const;
export const AFL_TRADE_EXTERNAL_IDENTITY_REVIEW_WORK_ITEM_SCHEMA_VERSION =
  'afl-trade-external-identity-review-work-item/v1' as const;
export const AFL_TRADE_EXTERNAL_IDENTITY_REVIEW_PACKAGE_SCHEMA_VERSION =
  'afl-trade-external-identity-review-package/v1' as const;
export const AFL_TRADE_EXTERNAL_IDENTITY_REVIEW_DECISION_SCHEMA_VERSION =
  'afl-trade-external-identity-review-decision/v1' as const;

const environmentSchema = z.enum(['test_fixture', 'non_production', 'production']);
const providerSchema = z.enum([
  'draftguru',
  'footywire',
  'official_afl',
  'fitzroy_official_afl_player_details',
]);
const entityKindSchema = z.enum(['club', 'player']);
const seasonSchema = z.number().int().min(1897).max(2200);
const instantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid UTC instant.');
const boundedTextSchema = z.string().trim().min(1).max(500);
const sourceIdentitySchema = z
  .object({
    nativeId: z.string().trim().min(1).max(240).nullable(),
    recordedName: boundedTextSchema,
  })
  .strict();

const identityScopeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('provider_native_id'),
      nativeId: z.string().trim().min(1).max(240),
    })
    .strict(),
  z
    .object({
      kind: z.literal('exact_recorded_name'),
      recordedName: boundedTextSchema,
      seasonYear: seasonSchema,
    })
    .strict(),
]);

const subjectContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_EXTERNAL_IDENTITY_SUBJECT_SCHEMA_VERSION),
    environment: environmentSchema,
    competition: z.string().trim().min(1).max(40),
    provider: providerSchema,
    entityKind: entityKindSchema,
    identityScope: identityScopeSchema,
  })
  .strict();

export const aflTradeExternalIdentitySubjectSchema = z
  .object({
    subjectId: aflTradeContentAddressedIdSchema('external-identity-subject'),
    content: subjectContentSchema,
  })
  .strict()
  .superRefine((subject, context) => {
    addAflTradeContentAddressIssue(
      'external-identity-subject',
      subject.subjectId,
      subject.content,
      context,
      ['subjectId']
    );
  });

export type AflTradeExternalIdentitySubject = z.infer<typeof aflTradeExternalIdentitySubjectSchema>;

const observationSchema = z
  .object({
    evidenceId: aflTradeContentAddressedIdSchema('external-evidence'),
    batchId: aflTradeContentAddressedIdSchema('external-evidence-batch'),
    sourceIdentity: sourceIdentitySchema,
    seasonYear: seasonSchema,
    capturedAt: instantSchema,
  })
  .strict();

function observationKey(observation: z.infer<typeof observationSchema>): string {
  return [
    observation.evidenceId,
    observation.sourceIdentity.nativeId ?? '',
    observation.sourceIdentity.recordedName,
    String(observation.seasonYear),
  ].join('\0');
}

const workItemContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_EXTERNAL_IDENTITY_REVIEW_WORK_ITEM_SCHEMA_VERSION),
    subject: aflTradeExternalIdentitySubjectSchema,
    observations: z.array(observationSchema).min(1).max(100_000),
    observedNames: z.array(boundedTextSchema).min(1).max(10_000),
    validFromSeason: seasonSchema,
    validThroughSeason: seasonSchema,
    publicationEligible: z.literal(false),
  })
  .strict()
  .superRefine((item, context) => {
    const observationKeys = item.observations.map(observationKey);
    if (
      new Set(observationKeys).size !== observationKeys.length ||
      observationKeys.some((value, index) => index > 0 && observationKeys[index - 1]! > value)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message: 'Identity observations must be unique and canonically ordered.',
      });
    }
    const observedNames = [
      ...new Set(item.observations.map(({ sourceIdentity }) => sourceIdentity.recordedName)),
    ].sort();
    if (
      sha256AflTradeCanonicalJson(observedNames) !== sha256AflTradeCanonicalJson(item.observedNames)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['observedNames'],
        message: 'Observed names must equal the exact canonical observation-name set.',
      });
    }
    const seasons = item.observations.map(({ seasonYear }) => seasonYear);
    if (
      item.validFromSeason !== Math.min(...seasons) ||
      item.validThroughSeason !== Math.max(...seasons)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['validFromSeason'],
        message: 'Identity validity must equal the exact observed season bounds.',
      });
    }
    const scope = item.subject.content.identityScope;
    item.observations.forEach((observation, index) => {
      if (
        scope.kind === 'provider_native_id' &&
        observation.sourceIdentity.nativeId !== scope.nativeId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['observations', index, 'sourceIdentity', 'nativeId'],
          message: 'Observation native ID must match the provider-native identity subject.',
        });
      }
      if (
        scope.kind === 'exact_recorded_name' &&
        (observation.sourceIdentity.nativeId !== null ||
          observation.sourceIdentity.recordedName !== scope.recordedName ||
          observation.seasonYear !== scope.seasonYear)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['observations', index, 'sourceIdentity', 'recordedName'],
          message: 'Name-only observations must match the exact recorded name and season subject.',
        });
      }
    });
  });

export const aflTradeExternalIdentityReviewWorkItemSchema = z
  .object({
    workItemId: aflTradeContentAddressedIdSchema('external-identity-review-work-item'),
    content: workItemContentSchema,
  })
  .strict()
  .superRefine((item, context) => {
    addAflTradeContentAddressIssue(
      'external-identity-review-work-item',
      item.workItemId,
      item.content,
      context,
      ['workItemId']
    );
  });

export type AflTradeExternalIdentityReviewWorkItem = z.infer<
  typeof aflTradeExternalIdentityReviewWorkItemSchema
>;

const packageItemSchema = z
  .object({
    ordinal: z.number().int().positive().max(100_000),
    subjectId: aflTradeContentAddressedIdSchema('external-identity-subject'),
    workItemId: aflTradeContentAddressedIdSchema('external-identity-review-work-item'),
    workItemSha256: aflTradeSha256Schema,
    workItem: aflTradeExternalIdentityReviewWorkItemSchema,
  })
  .strict()
  .superRefine((item, context) => {
    if (
      item.subjectId !== item.workItem.content.subject.subjectId ||
      item.workItemId !== item.workItem.workItemId ||
      item.workItemId !== `external-identity-review-work-item:${item.workItemSha256}`
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Review package membership must bind the exact subject and work item.',
      });
    }
  });

const reviewPackageContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_EXTERNAL_IDENTITY_REVIEW_PACKAGE_SCHEMA_VERSION),
    completionId: aflTradeContentAddressedIdSchema('external-historical-capture-completion'),
    completionSha256: aflTradeSha256Schema,
    environment: environmentSchema,
    competition: z.string().trim().min(1).max(40),
    completedAt: instantSchema,
    items: z.array(packageItemSchema).min(1).max(100_000),
    itemCount: z.number().int().positive().max(100_000),
    itemSetSha256: aflTradeSha256Schema,
    publicationEligible: z.literal(false),
  })
  .strict()
  .superRefine((reviewPackage, context) => {
    if (
      reviewPackage.completionId !==
      `external-historical-capture-completion:${reviewPackage.completionSha256}`
    ) {
      context.addIssue({
        code: 'custom',
        path: ['completionId'],
        message: 'Completion digest mismatch.',
      });
    }
    if (reviewPackage.itemCount !== reviewPackage.items.length) {
      context.addIssue({
        code: 'custom',
        path: ['itemCount'],
        message: 'Review item count mismatch.',
      });
    }
    const ids = reviewPackage.items.map(({ subjectId }) => subjectId);
    if (
      new Set(ids).size !== ids.length ||
      ids.some((value, index) => index > 0 && reviewPackage.items[index - 1]!.subjectId > value) ||
      reviewPackage.items.some((item, index) => item.ordinal !== index + 1)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Review items must be unique, canonically ordered, and contiguous.',
      });
    }
    if (reviewPackage.itemSetSha256 !== sha256AflTradeCanonicalJson(reviewPackage.items)) {
      context.addIssue({
        code: 'custom',
        path: ['itemSetSha256'],
        message: 'Review item-set digest mismatch.',
      });
    }
  });

export const aflTradeExternalIdentityReviewPackageSchema = z
  .object({
    packageId: aflTradeContentAddressedIdSchema('external-identity-review-package'),
    content: reviewPackageContentSchema,
  })
  .strict()
  .superRefine((reviewPackage, context) => {
    addAflTradeContentAddressIssue(
      'external-identity-review-package',
      reviewPackage.packageId,
      reviewPackage.content,
      context,
      ['packageId']
    );
  });

export type AflTradeExternalIdentityReviewPackage = z.infer<
  typeof aflTradeExternalIdentityReviewPackageSchema
>;

const canonicalTargetSchema = z
  .object({
    entityKind: entityKindSchema,
    canonicalId: z.string().trim().min(1).max(240),
    recordedLabel: boundedTextSchema,
    status: z.literal('approved'),
    snapshotSha256: aflTradeSha256Schema,
  })
  .strict()
  .superRefine((target, context) => {
    const snapshot = {
      entityKind: target.entityKind,
      canonicalId: target.canonicalId,
      recordedLabel: target.recordedLabel,
      status: target.status,
    };
    if (target.snapshotSha256 !== sha256AflTradeCanonicalJson(snapshot)) {
      context.addIssue({
        code: 'custom',
        path: ['snapshotSha256'],
        message: 'Canonical-target snapshot digest mismatch.',
      });
    }
  });

const reviewDecisionContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_EXTERNAL_IDENTITY_REVIEW_DECISION_SCHEMA_VERSION),
    subject: aflTradeExternalIdentitySubjectSchema,
    reviewPackageId: aflTradeContentAddressedIdSchema('external-identity-review-package'),
    reviewPackageSha256: aflTradeSha256Schema,
    workItemId: aflTradeContentAddressedIdSchema('external-identity-review-work-item'),
    workItemSha256: aflTradeSha256Schema,
    workItem: aflTradeExternalIdentityReviewWorkItemSchema,
    revision: z.number().int().positive().max(1_000_000),
    supersedesDecisionId: aflTradeContentAddressedIdSchema('review-decision').nullable(),
    decision: z.enum(['approved', 'rejected', 'withdrawn']),
    canonicalTarget: canonicalTargetSchema.nullable(),
    rationale: z.string().trim().min(1).max(4_000),
    authorityEvidenceId: aflTradeContentAddressedIdSchema('reviewer-authority-evidence'),
    decidedBy: z.string().trim().min(1).max(240),
    decidedAt: instantSchema,
    publicationEligible: z.literal(false),
  })
  .strict()
  .superRefine((decision, context) => {
    if (
      decision.reviewPackageId !==
      `external-identity-review-package:${decision.reviewPackageSha256}`
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reviewPackageId'],
        message: 'Review-package digest mismatch.',
      });
    }
    if (
      decision.workItemId !== `external-identity-review-work-item:${decision.workItemSha256}` ||
      decision.workItemId !== decision.workItem.workItemId ||
      decision.subject.subjectId !== decision.workItem.content.subject.subjectId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['workItemId'],
        message: 'Decision must bind the exact work item and its reviewed identity subject.',
      });
    }
    if ((decision.revision === 1) !== (decision.supersedesDecisionId === null)) {
      context.addIssue({
        code: 'custom',
        path: ['revision'],
        message: 'Decision revision one must start the chain; later revisions must supersede it.',
      });
    }
    if (decision.decision === 'approved') {
      if (decision.canonicalTarget === null) {
        context.addIssue({
          code: 'custom',
          path: ['canonicalTarget'],
          message: 'Approval requires a canonical target.',
        });
      } else if (decision.canonicalTarget.entityKind !== decision.subject.content.entityKind) {
        context.addIssue({
          code: 'custom',
          path: ['canonicalTarget', 'entityKind'],
          message: 'Canonical target entity kind must match the reviewed subject entity kind.',
        });
      }
    } else if (decision.canonicalTarget !== null) {
      context.addIssue({
        code: 'custom',
        path: ['canonicalTarget'],
        message: 'Rejected or withdrawn decisions cannot retain a canonical target.',
      });
    }
  });

export const aflTradeExternalIdentityReviewDecisionSchema = z
  .object({
    decisionId: aflTradeContentAddressedIdSchema('review-decision'),
    content: reviewDecisionContentSchema,
  })
  .strict()
  .superRefine((decision, context) => {
    addAflTradeContentAddressIssue(
      'review-decision',
      decision.decisionId,
      decision.content,
      context,
      ['decisionId']
    );
  });

export type AflTradeExternalIdentityReviewDecision = z.infer<
  typeof aflTradeExternalIdentityReviewDecisionSchema
>;

export function createAflTradeExternalIdentitySubject(
  content: Omit<z.input<typeof subjectContentSchema>, 'schemaVersion'>
): AflTradeExternalIdentitySubject {
  const parsed = subjectContentSchema.parse({
    schemaVersion: AFL_TRADE_EXTERNAL_IDENTITY_SUBJECT_SCHEMA_VERSION,
    ...content,
  });
  return aflTradeExternalIdentitySubjectSchema.parse({
    subjectId: createAflTradeContentAddress('external-identity-subject', parsed),
    content: parsed,
  });
}

export function createAflTradeExternalIdentityReviewWorkItem(input: {
  subject: AflTradeExternalIdentitySubject;
  observations: readonly z.input<typeof observationSchema>[];
}): AflTradeExternalIdentityReviewWorkItem {
  const observations = z
    .array(observationSchema)
    .parse(input.observations)
    .sort((left, right) => observationKey(left).localeCompare(observationKey(right)));
  const seasons = observations.map(({ seasonYear }) => seasonYear);
  const content = workItemContentSchema.parse({
    schemaVersion: AFL_TRADE_EXTERNAL_IDENTITY_REVIEW_WORK_ITEM_SCHEMA_VERSION,
    subject: input.subject,
    observations,
    observedNames: [
      ...new Set(observations.map(({ sourceIdentity }) => sourceIdentity.recordedName)),
    ].sort(),
    validFromSeason: Math.min(...seasons),
    validThroughSeason: Math.max(...seasons),
    publicationEligible: false,
  });
  return aflTradeExternalIdentityReviewWorkItemSchema.parse({
    workItemId: createAflTradeContentAddress('external-identity-review-work-item', content),
    content,
  });
}

export function createAflTradeExternalIdentityReviewPackage(input: {
  completionId: string;
  completionSha256: string;
  environment: z.input<typeof environmentSchema>;
  competition: string;
  completedAt: string;
  items: readonly AflTradeExternalIdentityReviewWorkItem[];
}): AflTradeExternalIdentityReviewPackage {
  const items = input.items
    .map((workItem) => aflTradeExternalIdentityReviewWorkItemSchema.parse(workItem))
    .sort((left, right) =>
      left.content.subject.subjectId.localeCompare(right.content.subject.subjectId)
    )
    .map((workItem, index) => ({
      ordinal: index + 1,
      subjectId: workItem.content.subject.subjectId,
      workItemId: workItem.workItemId,
      workItemSha256: workItem.workItemId.slice('external-identity-review-work-item:'.length),
      workItem,
    }));
  const content = reviewPackageContentSchema.parse({
    schemaVersion: AFL_TRADE_EXTERNAL_IDENTITY_REVIEW_PACKAGE_SCHEMA_VERSION,
    completionId: input.completionId,
    completionSha256: input.completionSha256,
    environment: input.environment,
    competition: input.competition,
    completedAt: input.completedAt,
    items,
    itemCount: items.length,
    itemSetSha256: sha256AflTradeCanonicalJson(items),
    publicationEligible: false,
  });
  return aflTradeExternalIdentityReviewPackageSchema.parse({
    packageId: createAflTradeContentAddress('external-identity-review-package', content),
    content,
  });
}

export function createAflTradeExternalIdentityReviewDecision(
  content: Omit<
    z.input<typeof reviewDecisionContentSchema>,
    'schemaVersion' | 'publicationEligible'
  >
): AflTradeExternalIdentityReviewDecision {
  const parsed = reviewDecisionContentSchema.parse({
    schemaVersion: AFL_TRADE_EXTERNAL_IDENTITY_REVIEW_DECISION_SCHEMA_VERSION,
    ...content,
    publicationEligible: false,
  });
  return aflTradeExternalIdentityReviewDecisionSchema.parse({
    decisionId: createAflTradeContentAddress('review-decision', parsed),
    content: parsed,
  });
}

export function createAflTradeExternalCanonicalIdentityTargetSnapshot(input: {
  entityKind: 'club' | 'player';
  canonicalId: string;
  recordedLabel: string;
}): z.infer<typeof canonicalTargetSchema> {
  const snapshot = {
    entityKind: input.entityKind,
    canonicalId: input.canonicalId,
    recordedLabel: input.recordedLabel,
    status: 'approved' as const,
  };
  return canonicalTargetSchema.parse({
    ...snapshot,
    snapshotSha256: sha256AflTradeCanonicalJson(snapshot),
  });
}

export function parseAflTradeExternalIdentityReviewDecision(
  input: unknown
): AflTradeExternalIdentityReviewDecision {
  return aflTradeExternalIdentityReviewDecisionSchema.parse(input);
}
