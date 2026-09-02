import { z } from 'zod';

import { AFL_TRADE_DECISION_ENVIRONMENTS } from '../governance/gateDecisionTypes';
import { aflTradeArtifactRefSchema } from './artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from './contentAddress';
import { aflTradeDatasetManifestSchema } from './datasetManifest';

export const AFL_TRADE_VALUATION_DATASET_SPECIFICATION_SCHEMA_VERSION =
  'afl-trade-valuation-dataset-specification/v1' as const;
export const AFL_TRADE_VALUATION_DATASET_ROW_SCHEMA_VERSION =
  'afl-trade-valuation-dataset-row/v3' as const;
export const AFL_TRADE_VALUATION_DATASET_CANDIDATE_SCHEMA_VERSION =
  'afl-trade-valuation-dataset/v4' as const;
export const AFL_TRADE_VALUATION_DATASET_ADMISSION_SCHEMA_VERSION =
  'afl-trade-dataset-admission/v3' as const;
export const AFL_TRADE_CORPUS_FACTUAL_LINEAGE_SCHEMA_VERSION =
  'afl-trade-corpus-factual-lineage/v2' as const;
export const AFL_TRADE_CONSUMED_FIELD_SET_SCHEMA_VERSION =
  'afl-trade-consumed-field-set/v1' as const;
export const AFL_TRADE_DATASET_OPERATION_AUTHORIZATION_SCHEMA_VERSION =
  'afl-trade-architecture-operation-authorization/v1' as const;

const utcInstantSchema = z
  .string()
  .datetime({ offset: true, precision: 3 })
  .regex(/Z$/, 'Valuation dataset instants must use UTC Z notation.');
const publicIdSchema = z.string().trim().min(1).max(400);
const dateSchema = z.string().date();
const factualTimeBoundarySchema = z.union([dateSchema, utcInstantSchema]);
const seasonSchema = z.number().int().min(1897).max(2200);
const contentAddressSchema = z.string().regex(/^[a-z][a-z0-9-]*:[a-f0-9]{64}$/);

function exactUniqueSorted<T>(values: readonly T[], identity: (value: T) => string): boolean {
  const identities = values.map(identity);
  return (
    new Set(identities).size === identities.length &&
    identities.every((value, index) => index === 0 || identities[index - 1] < value)
  );
}

function addContentAddressIssue(
  prefix: string,
  id: string,
  content: unknown,
  context: z.RefinementCtx,
  path: string
) {
  addAflTradeContentAddressIssue(prefix, id, content, context, [path]);
}

const splitRoleSchema = z.enum(['train', 'calibration', 'validation', 'final_test']);
const splitWindowSchema = z
  .object({ role: splitRoleSchema, from: dateSchema, to: dateSchema })
  .strict()
  .superRefine((window, context) => {
    if (Date.parse(window.to) <= Date.parse(window.from)) {
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'Split window must be non-empty.',
      });
    }
  });

const valuationDatasetSpecificationContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_VALUATION_DATASET_SPECIFICATION_SCHEMA_VERSION),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    scopeKey: publicIdSchema,
    competition: z.enum(['AFLM', 'AFLW']),
    modelKind: z.literal('player_contribution_and_availability'),
    createdAt: utcInstantSchema,
    rowGrain: z.literal('player_acquisition_spell_prediction'),
    featurePolicy: z
      .object({
        knowledgeJoin: z.enum([
          'point_in_time_as_known_at_prediction_cutoff',
          'retrospective_as_captured_at_dataset_creation',
        ]),
        correctionAvailability: z.literal('only_after_known_from'),
        unknownAndZero: z.literal('distinct'),
        targetDerivedFeatures: z.literal('prohibited'),
        postOutcomeFeatures: z.literal('prohibited'),
      })
      .strict(),
    targetPolicy: z
      .object({
        targetKind: z.literal('future_real_club_contribution'),
        targetStarts: z.literal('strictly_after_prediction_origin'),
        activeCareerTreatment: z.literal('right_censored'),
        unavailableObservationTreatment: z.literal('explicit_unavailable_not_zero'),
      })
      .strict(),
    splits: z.array(splitWindowSchema).length(4),
    embargoDays: z.number().int().positive().max(3650),
    leakageGroupKinds: z.tuple([
      z.literal('acquisition_spell'),
      z.literal('event'),
      z.literal('player'),
    ]),
    featureDefinitions: z.array(aflTradeArtifactRefSchema).min(1).max(1000),
    targetDefinition: aflTradeArtifactRefSchema,
    valueUnitDefinition: aflTradeArtifactRefSchema,
    roleTaxonomy: aflTradeArtifactRefSchema,
    eraDefinition: aflTradeArtifactRefSchema,
    censoringDefinition: aflTradeArtifactRefSchema,
    inclusionPolicy: aflTradeArtifactRefSchema,
  })
  .strict()
  .superRefine((specification, context) => {
    const roles = specification.splits.map(({ role }) => role);
    const requiredRoles = splitRoleSchema.options;
    if (
      new Set(roles).size !== roles.length ||
      requiredRoles.some((role) => !roles.includes(role))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['splits'],
        message: 'Dataset splits must include each partition exactly once.',
      });
    }
    const ordered = specification.splits
      .slice()
      .sort((left, right) => requiredRoles.indexOf(left.role) - requiredRoles.indexOf(right.role));
    for (let index = 1; index < ordered.length; index += 1) {
      const minimumStart =
        Date.parse(`${ordered[index - 1].to}T00:00:00.000Z`) +
        specification.embargoDays * 86_400_000;
      if (Date.parse(`${ordered[index].from}T00:00:00.000Z`) < minimumStart) {
        context.addIssue({
          code: 'custom',
          path: ['splits', index, 'from'],
          message: 'Dataset splits must be chronological and respect the embargo.',
        });
      }
    }
    if (!exactUniqueSorted(specification.leakageGroupKinds, (value) => value)) {
      context.addIssue({
        code: 'custom',
        path: ['leakageGroupKinds'],
        message: 'Leakage group kinds must be unique and sorted.',
      });
    }
    if (!exactUniqueSorted(specification.featureDefinitions, ({ artifactId }) => artifactId)) {
      context.addIssue({
        code: 'custom',
        path: ['featureDefinitions'],
        message: 'Feature definitions must be unique and sorted.',
      });
    }
  });

export const aflTradeValuationDatasetSpecificationSchema = z
  .object({
    specificationId: aflTradeContentAddressedIdSchema('valuation-dataset-specification'),
    content: valuationDatasetSpecificationContentSchema,
  })
  .strict()
  .superRefine((specification, context) => {
    addContentAddressIssue(
      'valuation-dataset-specification',
      specification.specificationId,
      specification.content,
      context,
      'specificationId'
    );
  });

const factualInputBaseShape = {
  memberId: contentAddressSchema,
  recordSha256: aflTradeSha256Schema,
  headRevision: z.number().int().positive(),
  effectiveFrom: factualTimeBoundarySchema,
  effectiveThrough: factualTimeBoundarySchema,
  recordedAt: utcInstantSchema,
};

export const factualInputSchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        ...factualInputBaseShape,
        kind: z.literal('acquisition_spell_metric'),
        state: z.literal('complete'),
        playerId: publicIdSchema,
        clubId: publicIdSchema,
        spellVersionId: aflTradeContentAddressedIdSchema('acquisition-spell-version'),
        metricCode: z.enum(['games', 'goals', 'brownlow_votes', 'coaches_votes']),
      })
      .strict(),
    z
      .object({
        ...factualInputBaseShape,
        kind: z.literal('reconciled_achievement'),
        state: z.literal('affirmed'),
        playerId: publicIdSchema,
        clubId: publicIdSchema.nullable(),
        competition: z.enum(['AFLM', 'AFLW']),
        seasonYear: seasonSchema,
        achievementCode: z.enum([
          'all_australian_team',
          'all_australian_squad',
          'rising_star_nomination',
          'rising_star_winner',
        ]),
      })
      .strict(),
  ])
  .superRefine((input, context) => {
    if (Date.parse(input.effectiveThrough) < Date.parse(input.effectiveFrom)) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveThrough'],
        message: 'Factual input valid time must be non-empty and ordered.',
      });
    }
  });

const consumedFieldSchema = z
  .object({
    sourceField: z.string().trim().min(1).max(200),
    uses: z.tuple([z.literal('derived_feature'), z.literal('model_training')]),
  })
  .strict();

const consumedFieldSetContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_CONSUMED_FIELD_SET_SCHEMA_VERSION),
    captureId: publicIdSchema,
    sourceSnapshotId: aflTradeContentAddressedIdSchema('source-snapshot'),
    createdAt: utcInstantSchema,
    fields: z.array(consumedFieldSchema).min(1).max(1000),
    fieldSetSha256: aflTradeSha256Schema,
  })
  .strict()
  .superRefine((fieldSet, context) => {
    if (
      !exactUniqueSorted(fieldSet.fields, ({ sourceField }) => sourceField) ||
      fieldSet.fieldSetSha256 !== sha256AflTradeCanonicalJson(fieldSet.fields)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['fields'],
        message: 'Consumed source fields must be unique, sorted, and sealed by their exact root.',
      });
    }
  });

export const aflTradeConsumedFieldSetSchema = z
  .object({
    fieldSetId: aflTradeContentAddressedIdSchema('consumed-field-set'),
    content: consumedFieldSetContentSchema,
  })
  .strict()
  .superRefine((fieldSet, context) => {
    addContentAddressIssue(
      'consumed-field-set',
      fieldSet.fieldSetId,
      fieldSet.content,
      context,
      'fieldSetId'
    );
  });

const corpusFactualMemberMappingSchema = z
  .object({
    kind: z.enum([
      'source_capture',
      'event_version',
      'lineage_edge',
      'acquisition_spell',
      'factual_run',
      'reconciled_metric',
      'achievement_run',
      'reconciled_achievement',
      'spell_metric',
      'review_decision',
    ]),
    memberId: publicIdSchema,
    recordSha256: aflTradeSha256Schema,
  })
  .strict();

const corpusDomainLineageMappingSchema = z
  .object({
    eventId: publicIdSchema,
    eventVersionId: publicIdSchema,
    acquisitionSpellId: publicIdSchema,
    acquisitionSpellVersionId: aflTradeContentAddressedIdSchema('acquisition-spell-version'),
    playerId: publicIdSchema,
    clubId: publicIdSchema,
    lineageEdgeIds: z.array(publicIdSchema).max(100),
  })
  .strict()
  .superRefine((mapping, context) => {
    if (!exactUniqueSorted(mapping.lineageEdgeIds, (value) => value)) {
      context.addIssue({
        code: 'custom',
        path: ['lineageEdgeIds'],
        message: 'Domain lineage edges must be unique and sorted.',
      });
    }
  });

const corpusSourceMappingSchema = z
  .object({
    captureId: publicIdSchema,
    sourceSnapshotId: aflTradeContentAddressedIdSchema('source-snapshot'),
    consumedFieldSetId: aflTradeContentAddressedIdSchema('consumed-field-set'),
    consumedFieldSetSha256: aflTradeSha256Schema,
  })
  .strict();

const corpusFactualLineageContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_CORPUS_FACTUAL_LINEAGE_SCHEMA_VERSION),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    scopeKey: publicIdSchema,
    competition: z.enum(['AFLM', 'AFLW']),
    createdAt: utcInstantSchema,
    corpusId: aflTradeContentAddressedIdSchema('corpus'),
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    factualCandidateId: aflTradeContentAddressedIdSchema('factual-release-candidate'),
    sourceMemberSetSha256: aflTradeSha256Schema,
    memberMappings: z.array(corpusFactualMemberMappingSchema).min(1).max(1_000_000),
    memberMappingSetSha256: aflTradeSha256Schema,
    sourceMappings: z.array(corpusSourceMappingSchema).min(1).max(1000),
    domainLineageMappings: z.array(corpusDomainLineageMappingSchema).min(1).max(100_000),
  })
  .strict()
  .superRefine((lineage, context) => {
    if (
      !exactUniqueSorted(lineage.memberMappings, ({ kind, memberId }) => `${kind}|${memberId}`) ||
      lineage.memberMappingSetSha256 !== sha256AflTradeCanonicalJson(lineage.memberMappings)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['memberMappings'],
        message: 'Corpus member mappings must be unique, sorted, and exactly sealed.',
      });
    }
    if (!exactUniqueSorted(lineage.sourceMappings, ({ captureId }) => captureId)) {
      context.addIssue({
        code: 'custom',
        path: ['sourceMappings'],
        message: 'Corpus source mappings must be unique and sorted by capture.',
      });
    }
    if (
      !exactUniqueSorted(
        lineage.domainLineageMappings,
        ({ eventVersionId, acquisitionSpellVersionId }) =>
          `${eventVersionId}|${acquisitionSpellVersionId}`
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['domainLineageMappings'],
        message: 'Domain lineage mappings must be unique and sorted.',
      });
    }
  });

export const aflTradeCorpusFactualLineageSchema = z
  .object({
    lineageId: aflTradeContentAddressedIdSchema('corpus-factual-lineage'),
    content: corpusFactualLineageContentSchema,
  })
  .strict()
  .superRefine((lineage, context) => {
    addContentAddressIssue(
      'corpus-factual-lineage',
      lineage.lineageId,
      lineage.content,
      context,
      'lineageId'
    );
  });

const valuationDatasetRowContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_VALUATION_DATASET_ROW_SCHEMA_VERSION),
    ordinal: z.number().int().positive().max(1_000_000),
    rowKey: publicIdSchema,
    competition: z.enum(['AFLM', 'AFLW']),
    seasonYear: seasonSchema,
    cohortIds: z.array(publicIdSchema).min(1).max(100),
    predictionOriginAt: utcInstantSchema,
    featureKnownThrough: utcInstantSchema,
    targetFrom: utcInstantSchema,
    targetThrough: utcInstantSchema,
    splitRole: splitRoleSchema,
    leakageGroups: z.record(z.string(), publicIdSchema),
    identity: z
      .object({
        playerId: publicIdSchema,
        playerResolutionDecisionId: aflTradeContentAddressedIdSchema(
          'provider-resolution-decision'
        ),
        playerAssignmentRevision: z.number().int().positive(),
        clubId: publicIdSchema,
        clubResolutionDecisionId: aflTradeContentAddressedIdSchema('provider-resolution-decision'),
        clubAssignmentRevision: z.number().int().positive(),
      })
      .strict(),
    lineage: z
      .object({
        eventId: publicIdSchema,
        eventVersionId: publicIdSchema,
        acquisitionSpellId: publicIdSchema,
        acquisitionSpellVersionId: aflTradeContentAddressedIdSchema('acquisition-spell-version'),
        lineageEdgeIds: z.array(contentAddressSchema).max(100),
      })
      .strict(),
    featureInputs: z.array(factualInputSchema).min(1).max(1000),
    targetInputs: z.array(factualInputSchema).min(1).max(1000),
  })
  .strict()
  .superRefine((row, context) => {
    if (!exactUniqueSorted(row.cohortIds, (value) => value)) {
      context.addIssue({
        code: 'custom',
        path: ['cohortIds'],
        message: 'Row cohorts must be unique and sorted.',
      });
    }
    if (
      Date.parse(row.targetFrom) <= Date.parse(row.predictionOriginAt) ||
      Date.parse(row.targetThrough) < Date.parse(row.targetFrom)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['targetFrom'],
        message: 'Target evidence must occur strictly after the prediction origin.',
      });
    }
    if (
      row.featureInputs.some(
        (input) => Date.parse(input.recordedAt) > Date.parse(row.featureKnownThrough)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['featureInputs'],
        message: 'Feature input was not known by the feature cutoff.',
      });
    }
    if (
      row.featureInputs.some(
        (input) => Date.parse(input.effectiveThrough) > Date.parse(row.predictionOriginAt)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['featureInputs'],
        message: 'Feature input valid time cannot extend beyond the prediction origin.',
      });
    }
    if (
      row.targetInputs.some(
        (input) =>
          Date.parse(input.effectiveFrom) < Date.parse(row.targetFrom) ||
          Date.parse(input.effectiveThrough) > Date.parse(row.targetThrough)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['targetInputs'],
        message: 'Target input valid time lies outside the target observation window.',
      });
    }
    for (const [path, values] of [
      ['featureInputs', row.featureInputs],
      ['targetInputs', row.targetInputs],
    ] as const) {
      if (!exactUniqueSorted(values, ({ memberId }) => memberId)) {
        context.addIssue({
          code: 'custom',
          path: [path],
          message: 'Factual inputs must be unique and sorted.',
        });
      }
    }
    const featureMemberIds = new Set(row.featureInputs.map(({ memberId }) => memberId));
    if (row.targetInputs.some(({ memberId }) => featureMemberIds.has(memberId))) {
      context.addIssue({
        code: 'custom',
        path: ['targetInputs'],
        message: 'A factual member cannot be both a feature and a target in the same row.',
      });
    }
  });

export const aflTradeValuationDatasetRowSchema = z
  .object({
    rowId: aflTradeContentAddressedIdSchema('valuation-dataset-row'),
    content: valuationDatasetRowContentSchema,
  })
  .strict()
  .superRefine((row, context) => {
    addContentAddressIssue('valuation-dataset-row', row.rowId, row.content, context, 'rowId');
  });

const factualParentSchema = z
  .object({
    corpusId: aflTradeContentAddressedIdSchema('corpus'),
    corpusToCandidateLineageId: aflTradeContentAddressedIdSchema('corpus-factual-lineage'),
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    factualCandidateId: aflTradeContentAddressedIdSchema('factual-release-candidate'),
    sourceMemberSetSha256: aflTradeSha256Schema,
    archiveDatasetId: aflTradeContentAddressedIdSchema('archive-dataset'),
    sourceSnapshotSetId: aflTradeContentAddressedIdSchema('source-snapshot-set'),
    metricRegistryVersion: publicIdSchema,
    acquisitionSpellRuleId: aflTradeContentAddressedIdSchema('acquisition-spell-rule'),
    factualEffectiveThrough: utcInstantSchema,
    releaseRecordStateId: aflTradeContentAddressedIdSchema('outcome-release-record-state'),
    releaseApprovalEventId: aflTradeContentAddressedIdSchema('outcome-release-event'),
    releaseRegistryRevision: z.number().int().positive(),
  })
  .strict();

const requiredSourceUsesSchema = z
  .object({
    operations: z.tuple([z.literal('derived_feature_creation'), z.literal('model_training')]),
    fieldUses: z.tuple([z.literal('derived_feature'), z.literal('model_training')]),
    publicDerivedOutput: z.literal('not_authorized_by_dataset_admission'),
    revalidateAtModelRunStart: z.literal(true),
  })
  .strict();

const valuationDatasetCandidateContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_VALUATION_DATASET_CANDIDATE_SCHEMA_VERSION),
    authorityBoundary: z.literal(
      'private_factual_feature_dataset_no_model_fit_grade_publication_or_fantasy_ownership'
    ),
    publicationEligible: z.literal(false),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    scopeKey: publicIdSchema,
    competition: z.enum(['AFLM', 'AFLW']),
    createdAt: utcInstantSchema,
    knowledgeCutoffAt: utcInstantSchema,
    factualParent: factualParentSchema,
    specification: aflTradeValuationDatasetSpecificationSchema,
    requiredSourceUses: requiredSourceUsesSchema,
    includedCohorts: z.array(publicIdSchema).min(1).max(500),
    excludedCohorts: z.array(publicIdSchema).max(500),
    rows: z.array(aflTradeValuationDatasetRowSchema).min(1).max(1_000_000),
    rowCount: z.number().int().positive().max(1_000_000),
    rowSetSha256: aflTradeSha256Schema,
    exclusionReport: aflTradeArtifactRefSchema,
    datasetArtifact: aflTradeArtifactRefSchema,
    extractor: z
      .object({
        codeArtifact: aflTradeArtifactRefSchema,
        configurationArtifact: aflTradeArtifactRefSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((candidate, context) => {
    const specification = candidate.specification.content;
    if (
      specification.environment !== candidate.environment ||
      specification.scopeKey !== candidate.scopeKey ||
      specification.competition !== candidate.competition
    ) {
      context.addIssue({
        code: 'custom',
        path: ['specification'],
        message: 'Dataset specification must match candidate scope and environment.',
      });
    }
    if (
      Date.parse(candidate.knowledgeCutoffAt) > Date.parse(candidate.createdAt) ||
      Date.parse(candidate.factualParent.factualEffectiveThrough) >
        Date.parse(candidate.knowledgeCutoffAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['knowledgeCutoffAt'],
        message: 'Dataset knowledge cutoff must cover the factual parent and precede creation.',
      });
    }
    if (
      candidate.rowCount !== candidate.rows.length ||
      candidate.rowSetSha256 !== sha256AflTradeCanonicalJson(candidate.rows)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rowSetSha256'],
        message: 'Dataset row count and root must seal the exact ordered row set.',
      });
    }
    const rowIds = candidate.rows.map(({ rowId }) => rowId);
    if (
      !exactUniqueSorted(candidate.rows, ({ content }) => content.rowKey) ||
      candidate.rows.some(({ content }, index) => content.ordinal !== index + 1)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rows'],
        message: 'Dataset rows must have unique sorted row keys and contiguous ordinals.',
      });
    }
    if (rowIds.length !== new Set(rowIds).size) {
      context.addIssue({ code: 'custom', path: ['rows'], message: 'Dataset rows must be unique.' });
    }
    if (
      !exactUniqueSorted(candidate.includedCohorts, (value) => value) ||
      !exactUniqueSorted(candidate.excludedCohorts, (value) => value)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['includedCohorts'],
        message: 'Included and excluded cohorts must be unique and sorted.',
      });
    }
    const excluded = new Set(candidate.excludedCohorts);
    if (
      candidate.includedCohorts.some((cohort) => excluded.has(cohort)) ||
      candidate.rows.some(({ content }) =>
        content.cohortIds.some(
          (cohort) => !candidate.includedCohorts.includes(cohort) || excluded.has(cohort)
        )
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['includedCohorts'],
        message: 'Rows may use only explicitly included, supported cohorts.',
      });
    }
    const splitByLeakageGroup = new Map<string, string>();
    for (const { content: row } of candidate.rows) {
      const retrospective =
        specification.featurePolicy.knowledgeJoin ===
        'retrospective_as_captured_at_dataset_creation';
      if (
        row.competition !== candidate.competition ||
        (!retrospective &&
          Date.parse(row.featureKnownThrough) > Date.parse(row.predictionOriginAt)) ||
        (retrospective && Date.parse(row.featureKnownThrough) > Date.parse(candidate.createdAt)) ||
        Date.parse(row.targetThrough) >
          Date.parse(candidate.factualParent.factualEffectiveThrough) ||
        [...row.featureInputs, ...row.targetInputs].some(
          ({ recordedAt }) => Date.parse(recordedAt) > Date.parse(candidate.knowledgeCutoffAt)
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['rows'],
          message: 'Rows must match the candidate competition and factual cutoff.',
        });
      }
      const expectedGroupKinds = specification.leakageGroupKinds;
      const actualGroupKinds = Object.keys(row.leakageGroups).sort();
      const authoritativeLeakageGroups = {
        acquisition_spell: row.lineage.acquisitionSpellId,
        event: row.lineage.eventId,
        player: row.identity.playerId,
      } as const;
      if (
        actualGroupKinds.length !== expectedGroupKinds.length ||
        actualGroupKinds.some((kind, index) => kind !== expectedGroupKinds[index]) ||
        expectedGroupKinds.some(
          (kind) => row.leakageGroups[kind] !== authoritativeLeakageGroups[kind]
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['rows'],
          message:
            'Every row must bind each required leakage group to its authoritative player, event, or acquisition spell identity.',
        });
      }
      const split = specification.splits.find(({ role }) => role === row.splitRole);
      const predictionDate = row.predictionOriginAt.slice(0, 10);
      if (!split || predictionDate < split.from || predictionDate >= split.to) {
        context.addIssue({
          code: 'custom',
          path: ['rows'],
          message: 'Row prediction origin must lie within its assigned split.',
        });
      }
      for (const [kind, value] of Object.entries(row.leakageGroups)) {
        const key = `${kind}|${value}`;
        const prior = splitByLeakageGroup.get(key);
        if (prior && prior !== row.splitRole) {
          context.addIssue({
            code: 'custom',
            path: ['rows'],
            message: 'A leakage group cannot appear in multiple dataset partitions.',
          });
        }
        splitByLeakageGroup.set(key, row.splitRole);
      }
    }
    const orderedRoles = splitRoleSchema.options;
    for (let index = 1; index < orderedRoles.length; index += 1) {
      if (
        specification.featurePolicy.knowledgeJoin ===
        'retrospective_as_captured_at_dataset_creation'
      ) {
        break;
      }
      const priorRole = orderedRoles[index - 1];
      const nextRole = orderedRoles[index];
      const priorTargetKnowledge = candidate.rows
        .filter(({ content }) => content.splitRole === priorRole)
        .flatMap(({ content }) =>
          content.targetInputs.map(({ recordedAt }) => Date.parse(recordedAt))
        );
      const nextPredictionOrigins = candidate.rows
        .filter(({ content }) => content.splitRole === nextRole)
        .map(({ content }) => Date.parse(content.predictionOriginAt));
      if (priorTargetKnowledge.length > 0 && nextPredictionOrigins.length > 0) {
        const priorLabelsKnownAt = Math.max(...priorTargetKnowledge);
        const nextPredictionOrigin = Math.min(...nextPredictionOrigins);
        const embargoMilliseconds = specification.embargoDays * 86_400_000;
        if (priorLabelsKnownAt + embargoMilliseconds >= nextPredictionOrigin) {
          context.addIssue({
            code: 'custom',
            path: ['rows'],
            message:
              'Prior-partition targets must be known before the next partition prediction origin and embargo.',
          });
        }
      }
    }
  });

export const aflTradeValuationDatasetCandidateSchema = z
  .object({
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    content: valuationDatasetCandidateContentSchema,
  })
  .strict()
  .superRefine((dataset, context) => {
    addContentAddressIssue('dataset', dataset.datasetId, dataset.content, context, 'datasetId');
  });

export const aflTradeAnyDatasetManifestSchema = z.union([
  aflTradeDatasetManifestSchema,
  aflTradeValuationDatasetCandidateSchema,
]);

const sourceRightsEvaluationSchema = z
  .object({
    captureId: publicIdSchema,
    sourceSnapshotId: aflTradeContentAddressedIdSchema('source-snapshot'),
    consumedFieldSetId: aflTradeContentAddressedIdSchema('consumed-field-set'),
    proposalId: aflTradeContentAddressedIdSchema('source-rights'),
    derivationDecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    derivationEvaluationReceiptId: aflTradeContentAddressedIdSchema('gate0a-evaluation'),
    derivationEvaluatedAt: utcInstantSchema,
    admissionDecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    admissionEvaluationReceiptId: aflTradeContentAddressedIdSchema('gate0a-evaluation'),
    admissionEvaluatedAt: utcInstantSchema,
    consumedFieldSetSha256: aflTradeSha256Schema,
    operations: z.tuple([z.literal('derived_feature_creation'), z.literal('model_training')]),
    fieldUses: z.tuple([z.literal('derived_feature'), z.literal('model_training')]),
    status: z.literal('approved'),
    termsValidThrough: utcInstantSchema.nullable(),
  })
  .strict();

const datasetOperationAuthorizationContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_DATASET_OPERATION_AUTHORIZATION_SCHEMA_VERSION),
    operation: z.literal('materialize_feature_dataset'),
    authorityKind: z.enum(['analytical_authority', 'operational_authorization']),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    scopeKey: publicIdSchema,
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    factualCandidateId: aflTradeContentAddressedIdSchema('factual-release-candidate'),
    authorizedAt: utcInstantSchema,
    validThrough: utcInstantSchema,
    principalRef: publicIdSchema,
  })
  .strict()
  .superRefine((authorization, context) => {
    if (Date.parse(authorization.validThrough) <= Date.parse(authorization.authorizedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['validThrough'],
        message: 'Dataset operation authorization must have a non-empty validity window.',
      });
    }
  });

export const aflTradeDatasetOperationAuthorizationSchema = z
  .object({
    receiptId: aflTradeContentAddressedIdSchema('architecture-operation-receipt'),
    content: datasetOperationAuthorizationContentSchema,
  })
  .strict()
  .superRefine((authorization, context) => {
    addContentAddressIssue(
      'architecture-operation-receipt',
      authorization.receiptId,
      authorization.content,
      context,
      'receiptId'
    );
  });

const valuationDatasetAdmissionContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_VALUATION_DATASET_ADMISSION_SCHEMA_VERSION),
    authorityBoundary: z.literal(
      'dataset_admission_only_no_model_fit_grade_publication_or_fantasy_ownership'
    ),
    publicationEligible: z.literal(false),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    admittedAt: utcInstantSchema,
    datasetCreatedAt: utcInstantSchema,
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    datasetSha256: aflTradeSha256Schema,
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    factualCandidateId: aflTradeContentAddressedIdSchema('factual-release-candidate'),
    sourceMemberSetSha256: aflTradeSha256Schema,
    corpusId: aflTradeContentAddressedIdSchema('corpus'),
    corpusToCandidateLineageId: aflTradeContentAddressedIdSchema('corpus-factual-lineage'),
    gate2Decision: z
      .object({
        decisionId: aflTradeContentAddressedIdSchema('gate-decision'),
        state: z.literal('approved'),
        effectiveAt: utcInstantSchema,
        evaluatedAt: utcInstantSchema,
        revalidateAt: utcInstantSchema,
        pinnedCorpusId: aflTradeContentAddressedIdSchema('corpus'),
        pinnedCorpusToCandidateLineageId:
          aflTradeContentAddressedIdSchema('corpus-factual-lineage'),
        pinnedFactualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
        pinnedFactualCandidateId: aflTradeContentAddressedIdSchema('factual-release-candidate'),
      })
      .strict(),
    sourceRightsEvaluations: z.array(sourceRightsEvaluationSchema).min(1).max(1000),
    analyticalAuthorityReceiptId: aflTradeContentAddressedIdSchema(
      'architecture-operation-receipt'
    ),
    operationalAuthorizationReceiptId: aflTradeContentAddressedIdSchema(
      'architecture-operation-receipt'
    ),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.datasetId !== `dataset:${receipt.datasetSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['datasetSha256'],
        message: 'Admission must bind the exact dataset candidate digest.',
      });
    }
    const decision = receipt.gate2Decision;
    if (
      decision.pinnedCorpusId !== receipt.corpusId ||
      decision.pinnedCorpusToCandidateLineageId !== receipt.corpusToCandidateLineageId ||
      decision.pinnedFactualReleaseId !== receipt.factualReleaseId ||
      decision.pinnedFactualCandidateId !== receipt.factualCandidateId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['gate2Decision'],
        message: 'Gate 2 must pin the exact corpus-to-factual-candidate lineage.',
      });
    }
    if (
      Date.parse(receipt.datasetCreatedAt) > Date.parse(receipt.admittedAt) ||
      Date.parse(decision.effectiveAt) > Date.parse(receipt.admittedAt) ||
      decision.evaluatedAt !== receipt.admittedAt ||
      Date.parse(decision.revalidateAt) <= Date.parse(receipt.admittedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['gate2Decision'],
        message: 'Dataset creation and Gate 2 eligibility must cover the admission instant.',
      });
    }
    if (!exactUniqueSorted(receipt.sourceRightsEvaluations, ({ captureId }) => captureId)) {
      context.addIssue({
        code: 'custom',
        path: ['sourceRightsEvaluations'],
        message: 'Source-rights evaluations must be unique and sorted.',
      });
    }
    for (const evaluation of receipt.sourceRightsEvaluations) {
      if (
        Date.parse(evaluation.derivationEvaluatedAt) > Date.parse(receipt.datasetCreatedAt) ||
        evaluation.admissionEvaluatedAt !== receipt.admittedAt ||
        (evaluation.termsValidThrough !== null &&
          Date.parse(evaluation.termsValidThrough) <= Date.parse(receipt.admittedAt))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['sourceRightsEvaluations'],
          message:
            'Derived-feature rights must predate extraction and remain current through admission.',
        });
      }
    }
  });

export const aflTradeValuationDatasetAdmissionReceiptSchema = z
  .object({
    admissionId: aflTradeContentAddressedIdSchema('dataset-admission'),
    content: valuationDatasetAdmissionContentSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    addContentAddressIssue(
      'dataset-admission',
      receipt.admissionId,
      receipt.content,
      context,
      'admissionId'
    );
  });

export function createAflTradeValuationDatasetSpecification(
  content: z.input<typeof valuationDatasetSpecificationContentSchema>
) {
  const parsed = valuationDatasetSpecificationContentSchema.parse(content);
  return aflTradeValuationDatasetSpecificationSchema.parse({
    specificationId: createAflTradeContentAddress('valuation-dataset-specification', parsed),
    content: parsed,
  });
}

export function createAflTradeValuationDatasetRow(
  content: z.input<typeof valuationDatasetRowContentSchema>
) {
  const parsed = valuationDatasetRowContentSchema.parse(content);
  return aflTradeValuationDatasetRowSchema.parse({
    rowId: createAflTradeContentAddress('valuation-dataset-row', parsed),
    content: parsed,
  });
}

export function createAflTradeConsumedFieldSet(
  input: Omit<z.input<typeof consumedFieldSetContentSchema>, 'fieldSetSha256'>
) {
  const content = consumedFieldSetContentSchema.parse({
    ...input,
    fieldSetSha256: sha256AflTradeCanonicalJson(input.fields),
  });
  return aflTradeConsumedFieldSetSchema.parse({
    fieldSetId: createAflTradeContentAddress('consumed-field-set', content),
    content,
  });
}

export function createAflTradeCorpusFactualLineage(
  input: Omit<z.input<typeof corpusFactualLineageContentSchema>, 'memberMappingSetSha256'>
) {
  const content = corpusFactualLineageContentSchema.parse({
    ...input,
    memberMappingSetSha256: sha256AflTradeCanonicalJson(input.memberMappings),
  });
  return aflTradeCorpusFactualLineageSchema.parse({
    lineageId: createAflTradeContentAddress('corpus-factual-lineage', content),
    content,
  });
}

type CandidateCreatorInput = Omit<
  z.input<typeof valuationDatasetCandidateContentSchema>,
  'rowCount' | 'rowSetSha256'
>;

export function createAflTradeValuationDatasetCandidate(input: CandidateCreatorInput) {
  const content = valuationDatasetCandidateContentSchema.parse({
    ...input,
    rowCount: input.rows.length,
    rowSetSha256: sha256AflTradeCanonicalJson(input.rows),
  });
  return aflTradeValuationDatasetCandidateSchema.parse({
    datasetId: createAflTradeContentAddress('dataset', content),
    content,
  });
}

export function listAflTradeValuationDatasetArtifactMemberships(
  candidate: AflTradeValuationDatasetCandidate
) {
  const content = candidate.content;
  const specification = content.specification.content;
  return [
    { role: 'dataset' as const, ordinal: 1, reference: content.datasetArtifact },
    { role: 'exclusion_report' as const, ordinal: 1, reference: content.exclusionReport },
    { role: 'extractor_code' as const, ordinal: 1, reference: content.extractor.codeArtifact },
    {
      role: 'extractor_configuration' as const,
      ordinal: 1,
      reference: content.extractor.configurationArtifact,
    },
    ...specification.featureDefinitions.map((reference, index) => ({
      role: 'feature_definition' as const,
      ordinal: index + 1,
      reference,
    })),
    {
      role: 'target_definition' as const,
      ordinal: 1,
      reference: specification.targetDefinition,
    },
    {
      role: 'value_unit_definition' as const,
      ordinal: 1,
      reference: specification.valueUnitDefinition,
    },
    { role: 'role_taxonomy' as const, ordinal: 1, reference: specification.roleTaxonomy },
    { role: 'era_definition' as const, ordinal: 1, reference: specification.eraDefinition },
    {
      role: 'censoring_definition' as const,
      ordinal: 1,
      reference: specification.censoringDefinition,
    },
    { role: 'inclusion_policy' as const, ordinal: 1, reference: specification.inclusionPolicy },
  ];
}

export function createAflTradeValuationDatasetAdmissionReceipt(
  content: z.input<typeof valuationDatasetAdmissionContentSchema>
) {
  const parsed = valuationDatasetAdmissionContentSchema.parse(content);
  return aflTradeValuationDatasetAdmissionReceiptSchema.parse({
    admissionId: createAflTradeContentAddress('dataset-admission', parsed),
    content: parsed,
  });
}

export function createAflTradeDatasetOperationAuthorization(
  content: z.input<typeof datasetOperationAuthorizationContentSchema>
) {
  const parsed = datasetOperationAuthorizationContentSchema.parse(content);
  return aflTradeDatasetOperationAuthorizationSchema.parse({
    receiptId: createAflTradeContentAddress('architecture-operation-receipt', parsed),
    content: parsed,
  });
}

export function parseAflTradeAnyDatasetManifest(value: unknown) {
  return aflTradeAnyDatasetManifestSchema.parse(value);
}

export type AflTradeValuationDatasetSpecification = z.infer<
  typeof aflTradeValuationDatasetSpecificationSchema
>;
export type AflTradeValuationDatasetRow = z.infer<typeof aflTradeValuationDatasetRowSchema>;
export type AflTradeValuationDatasetCandidate = z.infer<
  typeof aflTradeValuationDatasetCandidateSchema
>;
export type AflTradeValuationDatasetAdmissionReceipt = z.infer<
  typeof aflTradeValuationDatasetAdmissionReceiptSchema
>;
export type AflTradeConsumedFieldSet = z.infer<typeof aflTradeConsumedFieldSetSchema>;
export type AflTradeCorpusFactualLineage = z.infer<typeof aflTradeCorpusFactualLineageSchema>;
export type AflTradeDatasetOperationAuthorization = z.infer<
  typeof aflTradeDatasetOperationAuthorizationSchema
>;
