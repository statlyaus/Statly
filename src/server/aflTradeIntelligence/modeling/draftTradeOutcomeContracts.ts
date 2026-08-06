import { z } from 'zod';

import {
  aflTradeIsoDateTimeSchema,
  aflTradePublicIdSchema,
} from '@/types/aflTradeIntelligence/shared';
import {
  AFL_DRAFT_TRADE_OUTCOME_METRICS,
  aflDraftTradeOutcomeSourceNativeIdSchema,
} from '@/types/aflDraftTradeOutcomes';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

export const AFL_DRAFT_TRADE_OUTCOME_METRIC_CODES = AFL_DRAFT_TRADE_OUTCOME_METRICS;

export const AFL_DRAFT_TRADE_RECONCILIATION_STATES = [
  'matched',
  'different',
  'recorded_only',
  'source_only',
  'unavailable',
  'partial',
] as const;

export const aflDraftTradeMetricCodeSchema = z.enum(AFL_DRAFT_TRADE_OUTCOME_METRIC_CODES);

const sourceNativeIdSchema = aflDraftTradeOutcomeSourceNativeIdSchema;

const identityKindSchema = z.enum(['player', 'event', 'asset']);
const unresolvedIdentityReasonSchema = z.enum([
  'source_identifier_missing',
  'no_canonical_match',
  'ambiguous_canonical_match',
  'lineage_not_resolved',
]);

export const aflDraftTradeCanonicalIdentitySchema = z.discriminatedUnion('state', [
  z
    .object({
      kind: identityKindSchema,
      state: z.literal('resolved'),
      canonicalId: sourceNativeIdSchema,
      resolutionEvidenceId: aflTradeContentAddressedIdSchema('evidence-item'),
    })
    .strict(),
  z
    .object({
      kind: identityKindSchema,
      state: z.literal('unresolved'),
      canonicalId: z.null(),
      reasonCode: unresolvedIdentityReasonSchema,
      candidateCanonicalIds: z.array(sourceNativeIdSchema).max(20),
    })
    .strict()
    .superRefine((identity, context) => {
      if (
        identity.reasonCode === 'ambiguous_canonical_match' &&
        identity.candidateCanonicalIds.length < 2
      ) {
        context.addIssue({
          code: 'custom',
          path: ['candidateCanonicalIds'],
          message: 'An ambiguous identity requires at least two canonical candidates.',
        });
      }
      if (
        identity.reasonCode !== 'ambiguous_canonical_match' &&
        identity.candidateCanonicalIds.length > 1
      ) {
        context.addIssue({
          code: 'custom',
          path: ['candidateCanonicalIds'],
          message: 'Multiple candidates must use the ambiguous identity state.',
        });
      }
    }),
]);

export const aflDraftTradeOutcomeScopeSchema = z
  .object({
    competition: z.literal('AFL'),
    basis: z.enum(['after_event', 'season']),
    clubScope: z.enum(['all_subsequent_afl_clubs', 'destination_afl_club_only']),
    season: z.number().int().min(1897).max(2200).nullable(),
    effectiveFrom: aflTradeIsoDateTimeSchema,
    effectiveThrough: aflTradeIsoDateTimeSchema,
  })
  .strict()
  .superRefine((scope, context) => {
    if (Date.parse(scope.effectiveThrough) < Date.parse(scope.effectiveFrom)) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveThrough'],
        message: 'An outcome cannot be effective through a time before its scope begins.',
      });
    }
    if ((scope.basis === 'season') !== (scope.season !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['season'],
        message: 'Season scope requires one season and after-event scope prohibits one.',
      });
    }
  });

const sourceLocatorSchema = z
  .object({
    sourceRecordId: z.string().trim().min(1).max(300),
    sheet: z.string().trim().min(1).max(200),
    row: z.number().int().positive(),
    field: z.string().trim().min(1).max(200),
  })
  .strict();

const observationProvenanceSchema = z
  .object({
    evidenceItemId: aflTradeContentAddressedIdSchema('evidence-item'),
    sourceArtifact: aflTradeArtifactRefSchema,
    rightsReceiptId: aflTradeContentAddressedIdSchema('gate0a-evaluation'),
    rightsDisposition: z.enum(['approved', 'blocked']),
    locator: sourceLocatorSchema,
    adapterVersion: aflTradePublicIdSchema,
  })
  .strict();

const observationBase = {
  metricCode: aflDraftTradeMetricCodeSchema,
  sourceRole: z.enum(['recorded', 'independently_observed']),
  scope: aflDraftTradeOutcomeScopeSchema,
};

const exactOutcomeObservationSchema = z
  .object({
    ...observationBase,
    provenance: observationProvenanceSchema,
    availability: z.literal('exact'),
    value: z.number().int().nonnegative(),
    rawValue: z.string().trim().min(1).max(200),
  })
  .strict();

const partialOutcomeObservationSchema = z
  .object({
    ...observationBase,
    provenance: observationProvenanceSchema,
    availability: z.literal('partial'),
    value: z.null(),
    rawValue: z.string().trim().min(1).max(200),
    reasonCode: z.enum([
      'ambiguous_composite_scope',
      'incomplete_source_coverage',
      'unresolved_source_semantics',
    ]),
    components: z
      .array(
        z
          .object({
            ordinal: z.number().int().positive(),
            value: z.number().int().nonnegative(),
          })
          .strict()
      )
      .max(20),
  })
  .strict()
  .superRefine((observation, context) => {
    if (
      observation.reasonCode === 'ambiguous_composite_scope' &&
      observation.components.length < 2
    ) {
      context.addIssue({
        code: 'custom',
        path: ['components'],
        message: 'An ambiguous composite value requires at least two explicit components.',
      });
    }
    if (
      new Set(observation.components.map((component) => component.ordinal)).size !==
      observation.components.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['components'],
        message: 'Partial-value component ordinals must be unique.',
      });
    }
  });

const unavailableOutcomeObservationSchema = z
  .object({
    ...observationBase,
    availability: z.literal('unavailable'),
    value: z.null(),
    rawValue: z.string().max(200),
    reasonCode: z.enum([
      'not_recorded',
      'source_not_supplied',
      'rights_approval_required',
      'identity_unresolved',
    ]),
    provenance: observationProvenanceSchema.nullable(),
  })
  .strict()
  .superRefine((observation, context) => {
    if (observation.reasonCode === 'not_recorded' && observation.provenance === null) {
      context.addIssue({
        code: 'custom',
        path: ['provenance'],
        message: 'A checked-but-empty recorded cell requires its exact source provenance.',
      });
    }
  });

export const aflDraftTradeOutcomeObservationSchema = z.discriminatedUnion('availability', [
  exactOutcomeObservationSchema,
  partialOutcomeObservationSchema,
  unavailableOutcomeObservationSchema,
]);

function deriveReconciliationState(
  recorded: z.infer<typeof aflDraftTradeOutcomeObservationSchema>,
  observed: z.infer<typeof aflDraftTradeOutcomeObservationSchema>
): (typeof AFL_DRAFT_TRADE_RECONCILIATION_STATES)[number] {
  if (recorded.availability === 'partial' || observed.availability === 'partial') return 'partial';
  if (recorded.availability === 'unavailable' && observed.availability === 'unavailable') {
    return 'unavailable';
  }
  if (recorded.availability === 'exact' && observed.availability === 'unavailable') {
    return 'recorded_only';
  }
  if (recorded.availability === 'unavailable' && observed.availability === 'exact') {
    return 'source_only';
  }
  if (recorded.availability === 'exact' && observed.availability === 'exact') {
    const scopesMatch =
      canonicalizeAflTradeJson(recorded.scope) === canonicalizeAflTradeJson(observed.scope);
    if (!scopesMatch) return 'partial';
    return recorded.value === observed.value ? 'matched' : 'different';
  }
  return 'partial';
}

export const aflDraftTradeMetricReconciliationSchema = z
  .object({
    metricCode: aflDraftTradeMetricCodeSchema,
    recorded: aflDraftTradeOutcomeObservationSchema,
    independentlyObserved: aflDraftTradeOutcomeObservationSchema,
    state: z.enum(AFL_DRAFT_TRADE_RECONCILIATION_STATES),
    publicationEligible: z.boolean(),
  })
  .strict()
  .superRefine((reconciliation, context) => {
    if (
      reconciliation.recorded.metricCode !== reconciliation.metricCode ||
      reconciliation.independentlyObserved.metricCode !== reconciliation.metricCode
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metricCode'],
        message: 'Both observations must describe the reconciled metric.',
      });
    }
    if (
      reconciliation.recorded.sourceRole !== 'recorded' ||
      reconciliation.independentlyObserved.sourceRole !== 'independently_observed'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recorded'],
        message: 'Recorded and independently observed source roles cannot be interchanged.',
      });
    }

    const expectedState = deriveReconciliationState(
      reconciliation.recorded,
      reconciliation.independentlyObserved
    );
    if (reconciliation.state !== expectedState) {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: `Reconciliation state must be ${expectedState}.`,
      });
    }

    const independentlyObservedApproved =
      reconciliation.independentlyObserved.availability === 'exact' &&
      reconciliation.independentlyObserved.provenance.rightsDisposition === 'approved';
    const recordedEvidenceApproved =
      expectedState === 'source_only' ||
      (reconciliation.recorded.availability === 'exact' &&
        reconciliation.recorded.provenance.rightsDisposition === 'approved');
    const expectedEligibility =
      (expectedState === 'matched' || expectedState === 'source_only') &&
      independentlyObservedApproved &&
      recordedEvidenceApproved;
    if (reconciliation.publicationEligible !== expectedEligibility) {
      context.addIssue({
        code: 'custom',
        path: ['publicationEligible'],
        message: 'Only exact independently observed values with no disagreement are publishable.',
      });
    }
  });

const achievementProvenanceSchema = z
  .object({
    evidenceItemId: aflTradeContentAddressedIdSchema('evidence-item'),
    sourceArtifact: aflTradeArtifactRefSchema,
    rightsReceiptId: aflTradeContentAddressedIdSchema('gate0a-evaluation'),
    rightsDisposition: z.enum(['approved', 'blocked']),
    locator: sourceLocatorSchema,
    adapterVersion: aflTradePublicIdSchema,
    effectiveThrough: aflTradeIsoDateTimeSchema,
  })
  .strict();

export const aflDraftTradeAchievementSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('resolved'),
      achievementId: sourceNativeIdSchema,
      playerId: sourceNativeIdSchema,
      awardId: sourceNativeIdSchema,
      season: z.number().int().min(1897).max(2200),
      clubId: sourceNativeIdSchema.nullable(),
      provenance: achievementProvenanceSchema,
      publicationEligible: z.boolean(),
    })
    .strict()
    .superRefine((achievement, context) => {
      const expectedEligibility = achievement.provenance.rightsDisposition === 'approved';
      if (achievement.publicationEligible !== expectedEligibility) {
        context.addIssue({
          code: 'custom',
          path: ['publicationEligible'],
          message: 'A resolved achievement is publishable only under approved source rights.',
        });
      }
    }),
  z
    .object({
      state: z.literal('unresolved'),
      achievementId: z.null(),
      playerId: sourceNativeIdSchema.nullable(),
      rawValue: z.string().trim().min(1).max(1000),
      parsedAwardToken: z.string().trim().min(1).max(160).nullable(),
      parsedSeasons: z.array(z.number().int().min(1897).max(2200)).max(50),
      reasonCodes: z
        .array(
          z.enum([
            'player_identity_unresolved',
            'award_identity_unresolved',
            'club_at_season_unresolved',
            'award_syntax_ambiguous',
          ])
        )
        .min(1)
        .max(10),
      provenance: achievementProvenanceSchema,
      publicationEligible: z.literal(false),
    })
    .strict(),
]);

const metricRecordSchema = z
  .object({
    games: aflDraftTradeMetricReconciliationSchema,
    goals: aflDraftTradeMetricReconciliationSchema,
    coaches_votes: aflDraftTradeMetricReconciliationSchema,
    brownlow_votes: aflDraftTradeMetricReconciliationSchema,
  })
  .strict()
  .superRefine((metrics, context) => {
    for (const metricCode of AFL_DRAFT_TRADE_OUTCOME_METRIC_CODES) {
      if (metrics[metricCode].metricCode !== metricCode) {
        context.addIssue({
          code: 'custom',
          path: [metricCode, 'metricCode'],
          message: `The ${metricCode} slot must reconcile ${metricCode}.`,
        });
      }
    }
  });

export const aflDraftTradeOutcomeEvaluationRecordSchema = z
  .object({
    evaluationRecordId: sourceNativeIdSchema,
    sourceRecordId: z.string().trim().min(1).max(300),
    publicAssetBoundary: z.literal('source_native_afl_assets_no_user_or_fantasy_ownership'),
    identity: z
      .object({
        player: aflDraftTradeCanonicalIdentitySchema,
        event: aflDraftTradeCanonicalIdentitySchema,
        asset: aflDraftTradeCanonicalIdentitySchema,
      })
      .strict(),
    metrics: metricRecordSchema,
    achievements: z.array(aflDraftTradeAchievementSchema).max(500),
    publicationEligible: z.boolean(),
  })
  .strict()
  .superRefine((record, context) => {
    for (const kind of ['player', 'event', 'asset'] as const) {
      if (record.identity[kind].kind !== kind) {
        context.addIssue({
          code: 'custom',
          path: ['identity', kind, 'kind'],
          message: `The ${kind} identity slot must contain a ${kind} identity.`,
        });
      }
    }
    const identitiesResolved = Object.values(record.identity).every(
      (identity) => identity.state === 'resolved'
    );
    const metricsEligible = Object.values(record.metrics).every(
      (metric) => metric.publicationEligible
    );
    const achievementsEligible = record.achievements.every(
      (achievement) => achievement.publicationEligible
    );
    const expectedEligibility = identitiesResolved && metricsEligible && achievementsEligible;
    if (record.publicationEligible !== expectedEligibility) {
      context.addIssue({
        code: 'custom',
        path: ['publicationEligible'],
        message:
          'Record eligibility requires resolved identities and publishable reconciled facts.',
      });
    }
  });

export const aflDraftTradeOutcomeEvaluationSetContentSchema = z
  .object({
    schemaVersion: z.literal('afl-draft-trade-outcome-evaluation/v1'),
    publicAssetBoundary: z.literal('source_native_afl_assets_no_user_or_fantasy_ownership'),
    createdAt: aflTradeIsoDateTimeSchema,
    metricDefinitionVersion: sourceNativeIdSchema,
    records: z.array(aflDraftTradeOutcomeEvaluationRecordSchema).max(100_000),
    missingnessPolicy: z.literal('zero_is_observed_and_missing_is_explicitly_unavailable'),
    limitation: z.literal(
      'Source-independent evaluation contract only; no record creates user or fantasy ownership and no value is publishable without independently observed, rights-approved evidence.'
    ),
  })
  .strict()
  .superRefine((set, context) => {
    const recordIds = set.records.map((record) => record.evaluationRecordId);
    if (new Set(recordIds).size !== recordIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['records'],
        message: 'Evaluation record identifiers must be unique.',
      });
    }
    if (recordIds.some((recordId, index) => recordId !== [...recordIds].sort()[index])) {
      context.addIssue({
        code: 'custom',
        path: ['records'],
        message: 'Evaluation records must be in canonical identifier order.',
      });
    }
  });

export const aflDraftTradeOutcomeEvaluationSetSchema = z
  .object({
    outcomeEvaluationSetId: aflTradeContentAddressedIdSchema('outcome-evaluation'),
    content: aflDraftTradeOutcomeEvaluationSetContentSchema,
  })
  .strict()
  .superRefine((set, context) => {
    addAflTradeContentAddressIssue(
      'outcome-evaluation',
      set.outcomeEvaluationSetId,
      set.content,
      context,
      ['outcomeEvaluationSetId']
    );
  });

export type AflDraftTradeMetricCode = z.infer<typeof aflDraftTradeMetricCodeSchema>;
export type AflDraftTradeCanonicalIdentity = z.infer<typeof aflDraftTradeCanonicalIdentitySchema>;
export type AflDraftTradeOutcomeScope = z.infer<typeof aflDraftTradeOutcomeScopeSchema>;
export type AflDraftTradeOutcomeObservation = z.infer<typeof aflDraftTradeOutcomeObservationSchema>;
export type AflDraftTradeMetricReconciliation = z.infer<
  typeof aflDraftTradeMetricReconciliationSchema
>;
export type AflDraftTradeAchievement = z.infer<typeof aflDraftTradeAchievementSchema>;
export type AflDraftTradeOutcomeEvaluationRecord = z.infer<
  typeof aflDraftTradeOutcomeEvaluationRecordSchema
>;
export type AflDraftTradeOutcomeEvaluationSetContent = z.infer<
  typeof aflDraftTradeOutcomeEvaluationSetContentSchema
>;
export type AflDraftTradeOutcomeEvaluationSet = z.infer<
  typeof aflDraftTradeOutcomeEvaluationSetSchema
>;

export function reconcileAflDraftTradeOutcomeMetric(
  metricCode: AflDraftTradeMetricCode,
  recorded: AflDraftTradeOutcomeObservation,
  independentlyObserved: AflDraftTradeOutcomeObservation
): AflDraftTradeMetricReconciliation {
  const state = deriveReconciliationState(recorded, independentlyObserved);
  const independentlyObservedApproved =
    independentlyObserved.availability === 'exact' &&
    independentlyObserved.provenance.rightsDisposition === 'approved';
  const recordedEvidenceApproved =
    state === 'source_only' ||
    (recorded.availability === 'exact' && recorded.provenance.rightsDisposition === 'approved');
  const publicationEligible =
    (state === 'matched' || state === 'source_only') &&
    independentlyObservedApproved &&
    recordedEvidenceApproved;
  return aflDraftTradeMetricReconciliationSchema.parse({
    metricCode,
    recorded,
    independentlyObserved,
    state,
    publicationEligible,
  });
}

export function createAflDraftTradeOutcomeEvaluationSet(
  unparsedContent: AflDraftTradeOutcomeEvaluationSetContent
): AflDraftTradeOutcomeEvaluationSet {
  const content = aflDraftTradeOutcomeEvaluationSetContentSchema.parse({
    ...unparsedContent,
    records: [...unparsedContent.records].sort((left, right) =>
      left.evaluationRecordId.localeCompare(right.evaluationRecordId)
    ),
  });
  return aflDraftTradeOutcomeEvaluationSetSchema.parse({
    outcomeEvaluationSetId: createAflTradeContentAddress('outcome-evaluation', content),
    content,
  });
}
