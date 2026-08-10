import { z } from 'zod';

import {
  AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
  aflDraftTradeOutcomeSourceNativeIdSchema,
} from '@/types/aflDraftTradeOutcomes';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  aflTradeReconciledFactualMetricSchema,
  createAflTradeReconciledSubjectKey,
} from './factualReconciliationContracts';

export const AFL_TRADE_ACQUISITION_SPELL_METRIC_POLICY_SCHEMA_VERSION =
  'afl-trade-acquisition-spell-metric-policy/v1' as const;
export const AFL_TRADE_ACQUISITION_SPELL_METRIC_SCHEMA_VERSION =
  'afl-trade-acquisition-spell-metric/v1' as const;
export const AFL_TRADE_ACQUISITION_SPELL_METRIC_BATCH_SCHEMA_VERSION =
  'afl-trade-acquisition-spell-metric-batch/v1' as const;
export const AFL_TRADE_ACQUISITION_SPELL_METRIC_AUTHORITY_BOUNDARY =
  'private_real_club_acquisition_spell_aggregates_no_release_valuation_or_fantasy_ownership' as const;

const publicIdSchema = aflDraftTradeOutcomeSourceNativeIdSchema;
const seasonSchema = z.number().int().min(1897).max(2200);
const dateSchema = z.string().date();
const utcInstantSchema = z
  .string()
  .datetime({ offset: true, precision: 3 })
  .regex(/Z$/, 'Canonical spell-metric instants must use UTC Z notation.');
const boundedCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
const nonNegativeIntegerTextSchema = z.string().regex(/^(0|[1-9]\d{0,19})$/);

function immutableReferenceSchema(prefix: string) {
  return z
    .object({
      id: aflTradeContentAddressedIdSchema(prefix),
      sha256: aflTradeSha256Schema,
    })
    .strict()
    .superRefine((reference, context) => {
      if (reference.id !== `${prefix}:${reference.sha256}`) {
        context.addIssue({
          code: 'custom',
          path: ['sha256'],
          message: `The ${prefix} digest must equal its content-address suffix.`,
        });
      }
    });
}

const policyApprovalSchema = immutableReferenceSchema('acquisition-spell-metric-policy-approval');
const metricDefinitionSchema = immutableReferenceSchema('metric-definition');
const acquisitionSpellRuleSchema = immutableReferenceSchema('acquisition-spell-rule');
const reconciliationFinalizationSchema = immutableReferenceSchema(
  'factual-reconciliation-finalization'
);

const aggregationRuleSchema = z
  .object({
    metricCode: z.enum(['games', 'goals', 'brownlow_votes', 'coaches_votes']),
    definitionVersion: boundedCodeSchema,
    definition: metricDefinitionSchema,
    unit: boundedCodeSchema,
    sourceGrain: z.literal('match'),
    aggregation: z.literal('sum_non_negative_integer'),
    attribution: z.literal('exact_player_real_club_and_effective_date_inside_spell'),
    noEvidenceSemantics: z.literal('unavailable_never_zero'),
    conflictSemantics: z.literal('preserve_conflict_and_withhold_numeric_total'),
  })
  .strict();

export const aflTradeAcquisitionSpellMetricPolicyContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_ACQUISITION_SPELL_METRIC_POLICY_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY),
    authorityBoundary: z.literal(AFL_TRADE_ACQUISITION_SPELL_METRIC_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.enum(['AFLM', 'AFLW']),
    validFromSeason: seasonSchema,
    validThroughSeason: seasonSchema,
    policyVersion: boundedCodeSchema,
    approval: policyApprovalSchema,
    rules: z.array(aggregationRuleSchema).min(1).max(20),
    createdAt: utcInstantSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.validThroughSeason < policy.validFromSeason) {
      context.addIssue({
        code: 'custom',
        path: ['validThroughSeason'],
        message: 'Spell-metric policy applicability cannot run backwards.',
      });
    }
    const keys = policy.rules.map(
      ({ metricCode, definitionVersion }) => `${metricCode}\u0000${definitionVersion}`
    );
    if (
      new Set(keys).size !== keys.length ||
      keys.some((key, index) => index > 0 && keys[index - 1]! > key)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rules'],
        message: 'Spell aggregation rules must be unique and canonically ordered.',
      });
    }
  });

export const aflTradeAcquisitionSpellMetricPolicySchema = z
  .object({
    policyId: aflTradeContentAddressedIdSchema('acquisition-spell-metric-policy'),
    policySha256: aflTradeSha256Schema,
    content: aflTradeAcquisitionSpellMetricPolicyContentSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    addAflTradeContentAddressIssue(
      'acquisition-spell-metric-policy',
      policy.policyId,
      policy.content,
      context,
      ['policyId']
    );
    if (policy.policyId !== `acquisition-spell-metric-policy:${policy.policySha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['policySha256'],
        message: 'Spell-metric policy digest must equal its content-address suffix.',
      });
    }
  });

export const aflTradeAcquisitionSpellSnapshotSchema = z
  .object({
    spellVersionId: aflTradeContentAddressedIdSchema('acquisition-spell-version'),
    spellId: publicIdSchema,
    version: z.number().int().positive(),
    playerId: publicIdSchema,
    clubId: publicIdSchema,
    startEventVersionId: publicIdSchema,
    startAssetVersionId: publicIdSchema,
    startDate: dateSchema,
    endDate: dateSchema.nullable(),
    rule: acquisitionSpellRuleSchema,
    status: z.literal('approved'),
    recordedAt: utcInstantSchema,
  })
  .strict()
  .superRefine((spell, context) => {
    if (spell.endDate !== null && spell.endDate < spell.startDate) {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'An acquisition spell cannot end before it starts.',
      });
    }
  });

export const aflTradeCurrentReconciledMemberSchema = z
  .object({
    factualRunId: aflTradeContentAddressedIdSchema('factual-reconciliation-run'),
    factualRunSha256: aflTradeSha256Schema,
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    finalization: reconciliationFinalizationSchema,
    finalizedAt: utcInstantSchema,
    subjectKey: aflTradeContentAddressedIdSchema('reconciled-factual-subject'),
    headRevision: z.number().int().positive(),
    result: aflTradeReconciledFactualMetricSchema,
  })
  .strict()
  .superRefine((member, context) => {
    if (member.factualRunId !== `factual-reconciliation-run:${member.factualRunSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['factualRunSha256'],
        message: 'Factual-run digest must equal its content-address suffix.',
      });
    }
    const expectedFinalizationId = createAflTradeContentAddress(
      'factual-reconciliation-finalization',
      {
        factualRunId: member.factualRunId,
        runSha256: member.factualRunSha256,
        finalizedAt: member.finalizedAt,
      }
    );
    if (member.finalization.id !== expectedFinalizationId) {
      context.addIssue({
        code: 'custom',
        path: ['finalization'],
        message: 'Spell metrics require exact immutable factual-run finalization evidence.',
      });
    }
    const result = member.result.content;
    const expectedSubjectKey = createAflTradeReconciledSubjectKey({
      environment: member.environment,
      competition: result.competition,
      seasonYear: result.seasonYear,
      playerId: result.playerId,
      clubScope: result.clubScope,
      matchId: result.matchId,
      metricCode: result.metricCode,
      definitionVersion: result.definitionVersion,
    });
    if (member.subjectKey !== expectedSubjectKey) {
      context.addIssue({
        code: 'custom',
        path: ['subjectKey'],
        message: 'Current reconciled evidence must bind its exact typed subject key.',
      });
    }
    if (Date.parse(member.result.content.recordedAt) > Date.parse(member.finalizedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['finalizedAt'],
        message: 'A factual run cannot finalize before its reconciled result was recorded.',
      });
    }
  });

const metricAvailabilitySchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('complete'),
      numericValue: nonNegativeIntegerTextSchema,
      reasonCode: z.null(),
    })
    .strict(),
  z
    .object({
      state: z.literal('partial'),
      numericValue: nonNegativeIntegerTextSchema,
      reasonCode: z.literal('some_match_facts_unavailable'),
    })
    .strict(),
  z
    .object({
      state: z.literal('unavailable'),
      numericValue: z.null(),
      reasonCode: z.enum(['no_current_match_evidence', 'no_measured_match_facts']),
    })
    .strict(),
  z
    .object({
      state: z.literal('conflicting'),
      numericValue: z.null(),
      reasonCode: z.literal('reconciled_match_facts_conflict'),
    })
    .strict(),
  z
    .object({
      state: z.literal('quarantined'),
      numericValue: z.null(),
      reasonCode: z.literal('reconciled_match_facts_quarantined'),
    })
    .strict(),
]);

export const aflTradeAcquisitionSpellMetricContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_ACQUISITION_SPELL_METRIC_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY),
    authorityBoundary: z.literal(AFL_TRADE_ACQUISITION_SPELL_METRIC_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.enum(['AFLM', 'AFLW']),
    policyId: aflTradeContentAddressedIdSchema('acquisition-spell-metric-policy'),
    policySha256: aflTradeSha256Schema,
    spell: aflTradeAcquisitionSpellSnapshotSchema,
    rule: aggregationRuleSchema,
    availability: metricAvailabilitySchema,
    coverageNumerator: z.number().int().nonnegative(),
    coverageDenominator: z.number().int().nonnegative(),
    observationCount: z.number().int().nonnegative(),
    effectiveThrough: dateSchema,
    members: z.array(aflTradeCurrentReconciledMemberSchema).max(100_000),
    recordedAt: utcInstantSchema,
  })
  .strict()
  .superRefine((metric, context) => {
    if (metric.policyId !== `acquisition-spell-metric-policy:${metric.policySha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['policySha256'],
        message: 'Spell metric must bind its exact content-addressed aggregation policy.',
      });
    }
    const memberIds = metric.members.map(({ result }) => result.reconciledFactId);
    if (
      new Set(memberIds).size !== memberIds.length ||
      memberIds.some((id, index) => index > 0 && memberIds[index - 1]! > id)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['members'],
        message: 'Current reconciled members must be unique and canonically ordered.',
      });
    }
    const measured = metric.members.filter(
      ({ result }) => result.content.availability.state === 'measured'
    );
    const hasConflict = metric.members.some(
      ({ result }) => result.content.availability.state === 'conflicting'
    );
    const hasQuarantine = metric.members.some(
      ({ result }) => result.content.availability.state === 'quarantined'
    );
    const expectedState =
      metric.members.length === 0
        ? 'unavailable'
        : hasConflict
          ? 'conflicting'
          : hasQuarantine
            ? 'quarantined'
            : measured.length === metric.members.length
              ? 'complete'
              : measured.length > 0
                ? 'partial'
                : 'unavailable';
    const measuredSum = measured.reduce(
      (sum, { result }) => sum + BigInt(result.content.availability.numericValue ?? '0'),
      0n
    );
    if (
      metric.availability.state !== expectedState ||
      ((expectedState === 'complete' || expectedState === 'partial') &&
        metric.availability.numericValue !== measuredSum.toString()) ||
      metric.coverageNumerator !== measured.length ||
      metric.coverageDenominator !== metric.members.length ||
      metric.observationCount !== measured.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['availability'],
        message: 'Spell metric state, total, and coverage must exactly reconcile its members.',
      });
    }
    for (const member of metric.members) {
      const result = member.result.content;
      const effectiveDate = result.effectiveThrough.slice(0, 10);
      if (
        member.environment !== metric.environment ||
        result.grain !== 'match' ||
        result.playerId !== metric.spell.playerId ||
        result.clubScope.kind !== 'resolved_single_club' ||
        result.clubScope.clubId !== metric.spell.clubId ||
        result.competition !== metric.competition ||
        result.metricCode !== metric.rule.metricCode ||
        result.definitionVersion !== metric.rule.definitionVersion ||
        result.definition.id !== metric.rule.definition.id ||
        result.definition.sha256 !== metric.rule.definition.sha256 ||
        result.unit !== metric.rule.unit ||
        effectiveDate < metric.spell.startDate ||
        (metric.spell.endDate !== null && effectiveDate > metric.spell.endDate)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['members'],
          message:
            'Spell evidence must be a current match fact for the exact player, real club, definition, and effective date interval.',
        });
      }
    }
    const expectedEffectiveThrough =
      metric.members.length === 0
        ? metric.spell.startDate
        : metric.members.reduce(
            (latest, { result }) =>
              result.content.effectiveThrough.slice(0, 10) > latest
                ? result.content.effectiveThrough.slice(0, 10)
                : latest,
            metric.spell.startDate
          );
    if (metric.effectiveThrough !== expectedEffectiveThrough) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveThrough'],
        message: 'Spell effective-through date must equal its latest included match fact.',
      });
    }
  });

export const aflTradeAcquisitionSpellMetricSchema = z
  .object({
    spellMetricVersionId: aflTradeContentAddressedIdSchema('acquisition-spell-metric-version'),
    factSha256: aflTradeSha256Schema,
    content: aflTradeAcquisitionSpellMetricContentSchema,
  })
  .strict()
  .superRefine((metric, context) => {
    addAflTradeContentAddressIssue(
      'acquisition-spell-metric-version',
      metric.spellMetricVersionId,
      metric.content,
      context,
      ['spellMetricVersionId']
    );
    if (metric.spellMetricVersionId !== `acquisition-spell-metric-version:${metric.factSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['factSha256'],
        message: 'Spell metric digest must equal its content-address suffix.',
      });
    }
  });

const spellMetricHeadAdvanceSchema = z
  .object({
    subjectKey: aflTradeContentAddressedIdSchema('acquisition-spell-metric-subject'),
    expectedRevision: z.number().int().nonnegative(),
    nextRevision: z.number().int().positive(),
    spellMetricVersionId: aflTradeContentAddressedIdSchema('acquisition-spell-metric-version'),
  })
  .strict()
  .superRefine((advance, context) => {
    if (advance.nextRevision !== advance.expectedRevision + 1) {
      context.addIssue({
        code: 'custom',
        path: ['nextRevision'],
        message: 'A spell-metric head advances exactly one CAS revision.',
      });
    }
  });

export const aflTradeAcquisitionSpellMetricBatchContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_ACQUISITION_SPELL_METRIC_BATCH_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY),
    authorityBoundary: z.literal(AFL_TRADE_ACQUISITION_SPELL_METRIC_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    policy: aflTradeAcquisitionSpellMetricPolicySchema,
    spell: aflTradeAcquisitionSpellSnapshotSchema,
    metrics: z.array(aflTradeAcquisitionSpellMetricSchema).min(1).max(20),
    headAdvances: z.array(spellMetricHeadAdvanceSchema).min(1).max(20),
    recordedAt: utcInstantSchema,
  })
  .strict()
  .superRefine((batch, context) => {
    const metricKeys = batch.metrics.map(
      ({ content }) => `${content.rule.metricCode}\u0000${content.rule.definitionVersion}`
    );
    const policyKeys = batch.policy.content.rules.map(
      ({ metricCode, definitionVersion }) => `${metricCode}\u0000${definitionVersion}`
    );
    const advanceByVersion = new Map(
      batch.headAdvances.map((advance) => [advance.spellMetricVersionId, advance])
    );
    if (
      batch.policy.content.environment !== batch.metrics[0]?.content.environment ||
      batch.policy.content.competition !== batch.metrics[0]?.content.competition ||
      Number(batch.spell.startDate.slice(0, 4)) < batch.policy.content.validFromSeason ||
      Number((batch.spell.endDate ?? batch.spell.startDate).slice(0, 4)) >
        batch.policy.content.validThroughSeason ||
      metricKeys.length !== policyKeys.length ||
      metricKeys.some((key, index) => key !== policyKeys[index]) ||
      batch.metrics.some(
        ({ content }) =>
          content.policyId !== batch.policy.policyId ||
          content.policySha256 !== batch.policy.policySha256 ||
          canonicalizeAflTradeJson(content.spell) !== canonicalizeAflTradeJson(batch.spell) ||
          content.recordedAt !== batch.recordedAt
      ) ||
      advanceByVersion.size !== batch.metrics.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metrics'],
        message: 'A spell batch must contain exactly one metric for every exact policy rule.',
      });
    }
    for (const metric of batch.metrics) {
      const expectedSubjectKey = createAflTradeAcquisitionSpellMetricSubjectKey({
        environment: metric.content.environment,
        competition: metric.content.competition,
        spellVersionId: metric.content.spell.spellVersionId,
        metricCode: metric.content.rule.metricCode,
        definitionVersion: metric.content.rule.definitionVersion,
      });
      if (advanceByVersion.get(metric.spellMetricVersionId)?.subjectKey !== expectedSubjectKey) {
        context.addIssue({
          code: 'custom',
          path: ['headAdvances'],
          message: 'Each spell metric requires its exact typed current-head subject.',
        });
      }
    }
  });

export const aflTradeAcquisitionSpellMetricBatchSchema = z
  .object({
    batchId: aflTradeContentAddressedIdSchema('acquisition-spell-metric-batch'),
    batchSha256: aflTradeSha256Schema,
    content: aflTradeAcquisitionSpellMetricBatchContentSchema,
  })
  .strict()
  .superRefine((batch, context) => {
    addAflTradeContentAddressIssue(
      'acquisition-spell-metric-batch',
      batch.batchId,
      batch.content,
      context,
      ['batchId']
    );
    if (batch.batchId !== `acquisition-spell-metric-batch:${batch.batchSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['batchSha256'],
        message: 'Spell metric batch digest must equal its content-address suffix.',
      });
    }
  });

export type AflTradeAcquisitionSpellMetricPolicy = z.infer<
  typeof aflTradeAcquisitionSpellMetricPolicySchema
>;
export type AflTradeAcquisitionSpellSnapshot = z.infer<
  typeof aflTradeAcquisitionSpellSnapshotSchema
>;
export type AflTradeCurrentReconciledMember = z.infer<typeof aflTradeCurrentReconciledMemberSchema>;
export type AflTradeAcquisitionSpellMetric = z.infer<typeof aflTradeAcquisitionSpellMetricSchema>;
export type AflTradeAcquisitionSpellMetricBatch = z.infer<
  typeof aflTradeAcquisitionSpellMetricBatchSchema
>;

export function createAflTradeAcquisitionSpellMetricPolicy(
  content: unknown
): AflTradeAcquisitionSpellMetricPolicy {
  const parsed = aflTradeAcquisitionSpellMetricPolicyContentSchema.parse(content);
  const policyId = createAflTradeContentAddress('acquisition-spell-metric-policy', parsed);
  return aflTradeAcquisitionSpellMetricPolicySchema.parse({
    policyId,
    policySha256: policyId.slice('acquisition-spell-metric-policy:'.length),
    content: parsed,
  });
}

export function createAflTradeAcquisitionSpellMetric(
  content: unknown
): AflTradeAcquisitionSpellMetric {
  const parsed = aflTradeAcquisitionSpellMetricContentSchema.parse(content);
  const spellMetricVersionId = createAflTradeContentAddress(
    'acquisition-spell-metric-version',
    parsed
  );
  return aflTradeAcquisitionSpellMetricSchema.parse({
    spellMetricVersionId,
    factSha256: spellMetricVersionId.slice('acquisition-spell-metric-version:'.length),
    content: parsed,
  });
}

export function createAflTradeAcquisitionSpellMetricBatch(
  content: unknown
): AflTradeAcquisitionSpellMetricBatch {
  const parsed = aflTradeAcquisitionSpellMetricBatchContentSchema.parse(content);
  const batchId = createAflTradeContentAddress('acquisition-spell-metric-batch', parsed);
  return aflTradeAcquisitionSpellMetricBatchSchema.parse({
    batchId,
    batchSha256: batchId.slice('acquisition-spell-metric-batch:'.length),
    content: parsed,
  });
}

export function createAflTradeFactualReconciliationFinalization(content: {
  factualRunId: string;
  runSha256: string;
  finalizedAt: string;
}) {
  const id = createAflTradeContentAddress('factual-reconciliation-finalization', content);
  return { id, sha256: id.slice('factual-reconciliation-finalization:'.length) };
}

export function createAflTradeAcquisitionSpellMetricSubjectKey(content: {
  environment: 'test_fixture' | 'non_production' | 'production';
  competition: 'AFLM' | 'AFLW';
  spellVersionId: string;
  metricCode: string;
  definitionVersion: string;
}) {
  return createAflTradeContentAddress('acquisition-spell-metric-subject', content);
}
