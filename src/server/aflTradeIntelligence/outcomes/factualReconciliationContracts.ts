import { z } from 'zod';

import { AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY } from '@/types/aflDraftTradeOutcomes';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import { aflTradeSourceFactSchema } from './factualObservationContracts';

export const AFL_TRADE_FACTUAL_RECONCILIATION_POLICY_SCHEMA_VERSION =
  'afl-trade-factual-reconciliation-policy/v1' as const;
export const AFL_TRADE_FACTUAL_RECONCILIATION_RUN_SCHEMA_VERSION =
  'afl-trade-factual-reconciliation-run/v1' as const;
export const AFL_TRADE_FACTUAL_RECONCILIATION_ALGORITHM_VERSION =
  'afl-trade-factual-reconciliation/v1' as const;
export const AFL_TRADE_FACTUAL_RECONCILIATION_AUTHORITY_BOUNDARY =
  'private_reconciled_facts_only_no_release_publication_valuation_or_fantasy_ownership' as const;

const environmentSchema = z.enum(['test_fixture', 'non_production', 'production']);
const competitionSchema = z.enum(['AFLM', 'AFLW']);
const seasonSchema = z.number().int().min(1897).max(2200);
const publicIdSchema = z.string().trim().min(1).max(240);
const boundedCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
const utcInstantSchema = z
  .string()
  .datetime({ offset: true, precision: 3 })
  .regex(/Z$/, 'Canonical reconciliation instants must use UTC Z notation.');
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

const policyApprovalSchema = immutableReferenceSchema('factual-reconciliation-policy-approval');
const metricDefinitionSchema = immutableReferenceSchema('metric-definition');
const seasonClubScopeDecisionSchema = immutableReferenceSchema('season-club-scope-decision');

const reconciledClubScopeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('resolved_single_club'),
      clubId: publicIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('reviewed_unattributed'),
      clubId: z.null(),
      reasonCode: z.enum(['source_does_not_define_club', 'multi_club_season']),
      decision: seasonClubScopeDecisionSchema,
    })
    .strict(),
]);

const sourcePreferenceSchema = z
  .object({
    priority: z.number().int().positive().max(1000),
    provider: publicIdSchema,
    capabilityId: publicIdSchema,
  })
  .strict();

const sourceMetricRuleSchema = z
  .object({
    ruleKind: z.literal('source_metric'),
    metricCode: z.enum(['goals', 'brownlow_votes', 'coaches_votes']),
    definitionVersion: boundedCodeSchema,
    definition: metricDefinitionSchema,
    grain: z.enum(['match', 'season']),
    unit: boundedCodeSchema,
    comparison: z.literal('exact_non_negative_integer'),
    missingValueSemantics: z.literal('never_zero_and_never_did_not_play'),
    fallback: z.literal('next_priority_only_when_higher_priority_has_no_measured_value'),
    conflict: z.literal('same_priority_distinct_measured_values_are_conflicting'),
    sources: z.array(sourcePreferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((rule, context) => {
    const sourceKeys = rule.sources.map(
      ({ provider, capabilityId }) => `${provider}\u0000${capabilityId}`
    );
    if (new Set(sourceKeys).size !== sourceKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['sources'],
        message: 'A provider capability may occur only once in a reconciliation rule.',
      });
    }
    if (
      rule.sources.some(
        (source, index) =>
          index > 0 &&
          (rule.sources[index - 1]!.priority > source.priority ||
            (rule.sources[index - 1]!.priority === source.priority &&
              `${rule.sources[index - 1]!.provider}\u0000${rule.sources[index - 1]!.capabilityId}` >
                `${source.provider}\u0000${source.capabilityId}`))
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sources'],
        message: 'Source preferences must be canonically ordered by priority and identity.',
      });
    }
  });

const derivedGamesRuleSchema = z
  .object({
    ruleKind: z.literal('derived_games'),
    metricCode: z.literal('games'),
    definitionVersion: z.literal('games/v1'),
    definition: metricDefinitionSchema,
    grain: z.literal('match'),
    unit: z.literal('games'),
    derivation: z.literal('one_only_for_completed_match_and_authenticated_observed_appearance'),
    absenceSemantics: z.literal('absence_is_unknown_never_zero_or_did_not_play'),
    completionConflict: z.literal('distinct_preferred_completion_states_are_conflicting'),
    appearanceSources: z.array(sourcePreferenceSchema).min(1).max(100),
    matchUniverseSources: z.array(sourcePreferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((rule, context) => {
    for (const field of ['appearanceSources', 'matchUniverseSources'] as const) {
      const sources = rule[field];
      const keys = sources.map(({ provider, capabilityId }) => `${provider}\u0000${capabilityId}`);
      if (new Set(keys).size !== keys.length) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `A games ${field} provider capability may occur only once.`,
        });
      }
      if (
        sources.some((source, index) => {
          if (index === 0) return false;
          const previous = sources[index - 1]!;
          return (
            previous.priority > source.priority ||
            (previous.priority === source.priority &&
              `${previous.provider}\u0000${previous.capabilityId}` >
                `${source.provider}\u0000${source.capabilityId}`)
          );
        })
      ) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `Games ${field} require canonical priority and identity order.`,
        });
      }
    }
  });

export const aflTradeFactualReconciliationPolicyContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_FACTUAL_RECONCILIATION_POLICY_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY),
    authorityBoundary: z.literal(AFL_TRADE_FACTUAL_RECONCILIATION_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    environment: environmentSchema,
    competition: competitionSchema,
    validFromSeason: seasonSchema,
    validThroughSeason: seasonSchema,
    policyVersion: boundedCodeSchema,
    approval: policyApprovalSchema,
    sourceMetricRules: z.array(sourceMetricRuleSchema).max(100),
    gamesRule: derivedGamesRuleSchema,
    createdAt: utcInstantSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.validThroughSeason < policy.validFromSeason) {
      context.addIssue({
        code: 'custom',
        path: ['validThroughSeason'],
        message: 'Policy season applicability cannot run backwards.',
      });
    }
    const ruleKeys = policy.sourceMetricRules.map(
      ({ metricCode, definitionVersion, grain }) =>
        `${metricCode}\u0000${definitionVersion}\u0000${grain}`
    );
    if (new Set(ruleKeys).size !== ruleKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['sourceMetricRules'],
        message: 'Each metric definition and grain requires exactly one policy rule.',
      });
    }
    if (ruleKeys.some((key, index) => index > 0 && ruleKeys[index - 1]! > key)) {
      context.addIssue({
        code: 'custom',
        path: ['sourceMetricRules'],
        message: 'Source metric rules must use canonical metric/definition/grain order.',
      });
    }
  });

export const aflTradeFactualReconciliationPolicySchema = z
  .object({
    policyId: aflTradeContentAddressedIdSchema('factual-reconciliation-policy'),
    policySha256: aflTradeSha256Schema,
    content: aflTradeFactualReconciliationPolicyContentSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    addAflTradeContentAddressIssue(
      'factual-reconciliation-policy',
      policy.policyId,
      policy.content,
      context,
      ['policyId']
    );
    if (policy.policyId !== `factual-reconciliation-policy:${policy.policySha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['policySha256'],
        message: 'Policy digest must equal its content-address suffix.',
      });
    }
  });

const sourceMembershipSchema = z
  .object({
    factBatchId: aflTradeContentAddressedIdSchema('source-fact-batch'),
    factBatchSha256: aflTradeSha256Schema,
    fact: aflTradeSourceFactSchema,
  })
  .strict()
  .superRefine((membership, context) => {
    if (membership.factBatchId !== `source-fact-batch:${membership.factBatchSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['factBatchSha256'],
        message: 'Source batch digest must equal its content-address suffix.',
      });
    }
  });

const sourceMetricMemberSchema = z
  .object({
    sourceFactId: aflTradeContentAddressedIdSchema('source-fact'),
    sourceFactSha256: aflTradeSha256Schema,
    priority: z.number().int().positive().max(1000),
    provider: publicIdSchema,
    capabilityId: publicIdSchema,
    availability: z.enum(['measured', 'missing', 'quarantined', 'not_applicable']),
    numericValue: nonNegativeIntegerTextSchema.nullable(),
  })
  .strict()
  .superRefine((member, context) => {
    if (member.sourceFactId !== `source-fact:${member.sourceFactSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['sourceFactSha256'],
        message: 'Source member digest must equal its fact content-address suffix.',
      });
    }
    if ((member.availability === 'measured') !== (member.numericValue !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['numericValue'],
        message: 'Only a measured source member may carry a numeric value, including true zero.',
      });
    }
  });

const reconciledAvailabilitySchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('measured'),
      numericValue: nonNegativeIntegerTextSchema,
      reasonCode: z.null(),
    })
    .strict(),
  z
    .object({
      state: z.literal('unavailable'),
      numericValue: z.null(),
      reasonCode: z.enum(['no_measured_preferred_source', 'match_not_completed']),
    })
    .strict(),
  z
    .object({
      state: z.literal('conflicting'),
      numericValue: z.null(),
      reasonCode: z.enum(['preferred_values_disagree', 'preferred_completion_states_disagree']),
    })
    .strict(),
  z
    .object({
      state: z.literal('quarantined'),
      numericValue: z.null(),
      reasonCode: z.enum(['all_preferred_sources_quarantined', 'match_completion_quarantined']),
    })
    .strict(),
  z
    .object({
      state: z.literal('not_applicable'),
      numericValue: z.null(),
      reasonCode: z.literal('all_preferred_sources_not_applicable'),
    })
    .strict(),
]);

const resultBase = {
  playerId: publicIdSchema,
  clubScope: reconciledClubScopeSchema,
  matchId: publicIdSchema.nullable(),
  competition: competitionSchema,
  seasonYear: seasonSchema,
  metricCode: boundedCodeSchema,
  definitionVersion: boundedCodeSchema,
  definition: metricDefinitionSchema,
  unit: boundedCodeSchema,
  availability: reconciledAvailabilitySchema,
  coverageNumerator: z.number().int().nonnegative(),
  coverageDenominator: z.number().int().nonnegative(),
  effectiveThrough: utcInstantSchema,
  recordedAt: utcInstantSchema,
};

const sourceMetricResultContentSchema = z
  .object({
    ...resultBase,
    resultKind: z.literal('source_metric'),
    grain: z.enum(['match', 'season']),
    members: z.array(sourceMetricMemberSchema).min(1).max(100),
    selectedMemberIds: z.array(aflTradeContentAddressedIdSchema('source-fact')).max(100),
  })
  .strict()
  .superRefine((result, context) => {
    if ((result.grain === 'match') !== (result.matchId !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['matchId'],
        message: 'Match reconciliation requires a match; season reconciliation forbids one.',
      });
    }
    const memberIds = result.members.map(({ sourceFactId }) => sourceFactId);
    if (
      new Set(memberIds).size !== memberIds.length ||
      memberIds.some((id, index) => index > 0 && memberIds[index - 1]! > id)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['members'],
        message: 'Source metric members must be unique and sorted by fact ID.',
      });
    }
    if (
      new Set(result.selectedMemberIds).size !== result.selectedMemberIds.length ||
      result.selectedMemberIds.some(
        (id, index) => index > 0 && result.selectedMemberIds[index - 1]! > id
      ) ||
      result.selectedMemberIds.some((id) => !memberIds.includes(id))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['selectedMemberIds'],
        message: 'Selected sources must be a unique sorted subset of exact result members.',
      });
    }
    const measuredCount = result.members.filter(
      ({ availability }) => availability === 'measured'
    ).length;
    if (
      result.coverageDenominator !== result.members.length ||
      result.coverageNumerator !== measuredCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['coverageNumerator'],
        message: 'Coverage must exactly count measured and total source members.',
      });
    }
  });

const gamesResultContentSchema = z
  .object({
    ...resultBase,
    resultKind: z.literal('derived_games'),
    grain: z.literal('match'),
    metricCode: z.literal('games'),
    definitionVersion: z.literal('games/v1'),
    unit: z.literal('games'),
    appearanceMembers: z.array(sourceMetricMemberSchema).min(1).max(100),
    selectedAppearanceFactIds: z
      .array(aflTradeContentAddressedIdSchema('source-fact'))
      .min(1)
      .max(100),
    matchUniverseFactIds: z.array(aflTradeContentAddressedIdSchema('source-fact')).min(1).max(100),
    selectedMatchUniverseFactIds: z.array(aflTradeContentAddressedIdSchema('source-fact')).max(100),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.matchId === null) {
      context.addIssue({
        code: 'custom',
        path: ['matchId'],
        message: 'A derived game requires one exact match.',
      });
    }
    const appearanceFactIds = result.appearanceMembers.map(({ sourceFactId }) => sourceFactId);
    if (
      result.appearanceMembers.some(
        ({ availability, numericValue }) => availability !== 'measured' || numericValue !== '1'
      ) ||
      new Set(appearanceFactIds).size !== appearanceFactIds.length ||
      appearanceFactIds.some((id, index) => index > 0 && appearanceFactIds[index - 1]! > id) ||
      result.selectedAppearanceFactIds.some((id) => !appearanceFactIds.includes(id))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['appearanceMembers'],
        message:
          'Games appearances must be unique sorted authenticated observations, with selections drawn from them.',
      });
    }
    if (
      new Set(result.matchUniverseFactIds).size !== result.matchUniverseFactIds.length ||
      result.matchUniverseFactIds.some(
        (id, index) => index > 0 && result.matchUniverseFactIds[index - 1]! > id
      ) ||
      result.selectedMatchUniverseFactIds.some((id) => !result.matchUniverseFactIds.includes(id))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['matchUniverseFactIds'],
        message: 'Games evidence must be unique, sorted, and selected only from exact match facts.',
      });
    }
    if (
      result.availability.state === 'measured' &&
      (result.availability.numericValue !== '1' || result.selectedMatchUniverseFactIds.length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['availability'],
        message: 'A measured game is exactly one and requires selected completed-match evidence.',
      });
    }
    const expectedCoverageNumerator = result.availability.state === 'measured' ? 1 : 0;
    if (
      result.coverageDenominator !== 1 ||
      result.coverageNumerator !== expectedCoverageNumerator
    ) {
      context.addIssue({
        code: 'custom',
        path: ['coverageNumerator'],
        message: 'Games coverage is one-of-one only when the derivation is measured.',
      });
    }
  });

export const aflTradeReconciledFactualMetricContentSchema = z.discriminatedUnion('resultKind', [
  sourceMetricResultContentSchema,
  gamesResultContentSchema,
]);

export const aflTradeReconciledFactualMetricSchema = z
  .object({
    reconciledFactId: aflTradeContentAddressedIdSchema('reconciled-factual-metric'),
    factSha256: aflTradeSha256Schema,
    content: aflTradeReconciledFactualMetricContentSchema,
  })
  .strict()
  .superRefine((fact, context) => {
    addAflTradeContentAddressIssue(
      'reconciled-factual-metric',
      fact.reconciledFactId,
      fact.content,
      context,
      ['reconciledFactId']
    );
    if (fact.reconciledFactId !== `reconciled-factual-metric:${fact.factSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['factSha256'],
        message: 'Reconciled fact digest must equal its content-address suffix.',
      });
    }
  });

const headAdvanceSchema = z
  .object({
    subjectKey: aflTradeContentAddressedIdSchema('reconciled-factual-subject'),
    expectedRevision: z.number().int().nonnegative(),
    nextRevision: z.number().int().positive(),
    reconciledFactId: aflTradeContentAddressedIdSchema('reconciled-factual-metric'),
  })
  .strict()
  .superRefine((advance, context) => {
    if (advance.nextRevision !== advance.expectedRevision + 1) {
      context.addIssue({
        code: 'custom',
        path: ['nextRevision'],
        message: 'A reconciliation head advances exactly one CAS revision.',
      });
    }
  });

export const aflTradeFactualReconciliationRunContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_FACTUAL_RECONCILIATION_RUN_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY),
    authorityBoundary: z.literal(AFL_TRADE_FACTUAL_RECONCILIATION_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    environment: environmentSchema,
    competition: competitionSchema,
    seasonYear: seasonSchema,
    policy: aflTradeFactualReconciliationPolicySchema,
    algorithmVersion: z.literal(AFL_TRADE_FACTUAL_RECONCILIATION_ALGORITHM_VERSION),
    inputSetSha256: aflTradeSha256Schema,
    outputSetSha256: aflTradeSha256Schema,
    sourceMemberships: z.array(sourceMembershipSchema).max(1_000_000),
    results: z.array(aflTradeReconciledFactualMetricSchema).max(1_000_000),
    headAdvances: z.array(headAdvanceSchema).max(1_000_000),
    startedAt: utcInstantSchema,
    completedAt: utcInstantSchema,
    counts: z
      .object({
        sourceFacts: z.number().int().nonnegative(),
        reconciledFacts: z.number().int().nonnegative(),
        measured: z.number().int().nonnegative(),
        unavailable: z.number().int().nonnegative(),
        conflicting: z.number().int().nonnegative(),
        quarantined: z.number().int().nonnegative(),
        notApplicable: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((run, context) => {
    if (
      run.policy.content.environment !== run.environment ||
      run.policy.content.competition !== run.competition ||
      run.seasonYear < run.policy.content.validFromSeason ||
      run.seasonYear > run.policy.content.validThroughSeason
    ) {
      context.addIssue({
        code: 'custom',
        path: ['policy'],
        message: 'A reconciliation run requires one exact applicable approved policy.',
      });
    }
    if (Date.parse(run.startedAt) > Date.parse(run.completedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Reconciliation completion cannot precede its start.',
      });
    }
    const sourceFactIds = run.sourceMemberships.map(({ fact }) => fact.factId);
    const resultIds = run.results.map(({ reconciledFactId }) => reconciledFactId);
    if (
      new Set(sourceFactIds).size !== sourceFactIds.length ||
      sourceFactIds.some((id, index) => index > 0 && sourceFactIds[index - 1]! > id)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceMemberships'],
        message: 'Source memberships must be unique and sorted by exact fact ID.',
      });
    }
    if (
      new Set(resultIds).size !== resultIds.length ||
      resultIds.some((id, index) => index > 0 && resultIds[index - 1]! > id)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['results'],
        message: 'Reconciled results must be unique and sorted by exact fact ID.',
      });
    }
    if (run.inputSetSha256 !== sha256AflTradeCanonicalJson(run.sourceMemberships)) {
      context.addIssue({
        code: 'custom',
        path: ['inputSetSha256'],
        message: 'Input digest must bind the complete ordered source membership set.',
      });
    }
    if (run.outputSetSha256 !== sha256AflTradeCanonicalJson(run.results)) {
      context.addIssue({
        code: 'custom',
        path: ['outputSetSha256'],
        message: 'Output digest must bind the complete ordered reconciled result set.',
      });
    }
    const membershipById = new Map(
      run.sourceMemberships.map((member) => [member.fact.factId, member])
    );
    const consumedMetricFactIds = new Set<string>();
    const consumedAppearanceFactIds = new Set<string>();
    for (const membership of run.sourceMemberships) {
      const fact = membership.fact.content;
      if (
        fact.environment !== run.environment ||
        fact.competition !== run.competition ||
        fact.seasonYear !== run.seasonYear
      ) {
        context.addIssue({
          code: 'custom',
          path: ['sourceMemberships'],
          message: 'Every source membership must belong to the exact run environment and season.',
        });
        break;
      }
    }
    for (const result of run.results) {
      const content = result.content;
      if (content.competition !== run.competition || content.seasonYear !== run.seasonYear) {
        context.addIssue({
          code: 'custom',
          path: ['results'],
          message: 'Every reconciled result must belong to the exact run season.',
        });
        break;
      }
      if (content.resultKind === 'source_metric') {
        const policyRule = run.policy.content.sourceMetricRules.find(
          (rule) =>
            rule.metricCode === content.metricCode &&
            rule.definitionVersion === content.definitionVersion &&
            rule.grain === content.grain
        );
        if (
          policyRule === undefined ||
          policyRule.definition.id !== content.definition.id ||
          policyRule.definition.sha256 !== content.definition.sha256 ||
          policyRule.unit !== content.unit
        ) {
          context.addIssue({
            code: 'custom',
            path: ['results'],
            message: 'Every source metric result requires its exact applicable policy rule.',
          });
          continue;
        }
        for (const member of content.members) {
          const source = membershipById.get(member.sourceFactId)?.fact;
          const sourceContent = source?.content;
          if (
            source === undefined ||
            (sourceContent?.factKind !== 'player_match_metric' &&
              sourceContent?.factKind !== 'player_season_metric')
          ) {
            context.addIssue({
              code: 'custom',
              path: ['results'],
              message: 'Source metric results may reference only exact numeric metric facts.',
            });
            continue;
          }
          const sourceMatchId =
            sourceContent.factKind === 'player_match_metric' ? sourceContent.match.matchId : null;
          const sourceClubScope =
            sourceContent.factKind === 'player_match_metric'
              ? {
                  kind: 'resolved_single_club' as const,
                  clubId: sourceContent.representedClub.clubId,
                }
              : sourceContent.seasonClubScope.kind === 'resolved_single_club'
                ? {
                    kind: 'resolved_single_club' as const,
                    clubId: sourceContent.seasonClubScope.club.clubId,
                  }
                : {
                    kind: 'reviewed_unattributed' as const,
                    clubId: null,
                    reasonCode: sourceContent.seasonClubScope.reasonCode,
                    decision: sourceContent.seasonClubScope.decision,
                  };
          if (
            consumedMetricFactIds.has(member.sourceFactId) ||
            source.factSha256 !== member.sourceFactSha256 ||
            sourceContent.player.playerId !== content.playerId ||
            sourceMatchId !== content.matchId ||
            sourceContent.metricCode !== content.metricCode ||
            sourceContent.definitionVersion !== content.definitionVersion ||
            sourceContent.definition.id !== content.definition.id ||
            sourceContent.definition.sha256 !== content.definition.sha256 ||
            sourceContent.unit !== content.unit ||
            canonicalizeAflTradeJson(sourceClubScope) !==
              canonicalizeAflTradeJson(content.clubScope) ||
            sourceContent.provider !== member.provider ||
            sourceContent.capabilityId !== member.capabilityId ||
            sourceContent.availability.state !== member.availability ||
            sourceContent.availability.numericValue !== member.numericValue
          ) {
            context.addIssue({
              code: 'custom',
              path: ['results'],
              message: 'Metric membership must mirror the exact retained source fact.',
            });
          }
          consumedMetricFactIds.add(member.sourceFactId);
          const preference = policyRule.sources.find(
            ({ provider, capabilityId }) =>
              provider === member.provider && capabilityId === member.capabilityId
          );
          if (preference === undefined || preference.priority !== member.priority) {
            context.addIssue({
              code: 'custom',
              path: ['results'],
              message: 'Each source metric member must use its exact reviewed policy priority.',
            });
          }
        }
        const measuredMembers = content.members.filter(
          ({ availability }) => availability === 'measured'
        );
        const preferredMeasuredPriority = measuredMembers.reduce(
          (best, member) => Math.min(best, member.priority),
          Number.POSITIVE_INFINITY
        );
        const expectedSelectedIds = measuredMembers
          .filter(({ priority }) => priority === preferredMeasuredPriority)
          .map(({ sourceFactId }) => sourceFactId)
          .sort();
        if (
          expectedSelectedIds.length !== content.selectedMemberIds.length ||
          expectedSelectedIds.some((id, index) => content.selectedMemberIds[index] !== id)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['results'],
            message: 'Selected members must be the complete highest-priority measured tier.',
          });
        }
        const selectedValues = new Set(
          measuredMembers
            .filter(({ priority }) => priority === preferredMeasuredPriority)
            .map(({ numericValue }) => numericValue)
        );
        const hasQuarantined = content.members.some(
          ({ availability }) => availability === 'quarantined'
        );
        const allNotApplicable = content.members.every(
          ({ availability }) => availability === 'not_applicable'
        );
        const exactState =
          selectedValues.size === 1
            ? 'measured'
            : selectedValues.size > 1
              ? 'conflicting'
              : hasQuarantined
                ? 'quarantined'
                : allNotApplicable
                  ? 'not_applicable'
                  : 'unavailable';
        if (
          content.availability.state !== exactState ||
          (exactState === 'measured' &&
            content.availability.numericValue !== [...selectedValues][0])
        ) {
          context.addIssue({
            code: 'custom',
            path: ['results'],
            message: 'Reconciled metric state must follow exact reviewed precedence semantics.',
          });
        }
      } else {
        for (const member of content.appearanceMembers) {
          const appearance = membershipById.get(member.sourceFactId)?.fact;
          const preference = run.policy.content.gamesRule.appearanceSources.find(
            ({ provider, capabilityId }) =>
              provider === member.provider && capabilityId === member.capabilityId
          );
          if (
            consumedAppearanceFactIds.has(member.sourceFactId) ||
            appearance === undefined ||
            appearance.factSha256 !== member.sourceFactSha256 ||
            appearance.content.factKind !== 'player_appearance' ||
            appearance.content.player.playerId !== content.playerId ||
            appearance.content.match.matchId !== content.matchId ||
            content.clubScope.kind !== 'resolved_single_club' ||
            appearance.content.representedClub.clubId !== content.clubScope.clubId ||
            appearance.content.appearanceState !== 'observed' ||
            appearance.content.provider !== member.provider ||
            appearance.content.capabilityId !== member.capabilityId ||
            preference?.priority !== member.priority
          ) {
            context.addIssue({
              code: 'custom',
              path: ['results'],
              message:
                'Games require exact authenticated appearances with their reviewed source priorities.',
            });
          }
          consumedAppearanceFactIds.add(member.sourceFactId);
        }
        const selectedAppearancePriority = content.appearanceMembers.reduce(
          (best, member) => Math.min(best, member.priority),
          Number.POSITIVE_INFINITY
        );
        const expectedSelectedAppearanceIds = content.appearanceMembers
          .filter(({ priority }) => priority === selectedAppearancePriority)
          .map(({ sourceFactId }) => sourceFactId)
          .sort();
        if (
          expectedSelectedAppearanceIds.length !== content.selectedAppearanceFactIds.length ||
          expectedSelectedAppearanceIds.some(
            (factId, index) => content.selectedAppearanceFactIds[index] !== factId
          )
        ) {
          context.addIssue({
            code: 'custom',
            path: ['results'],
            message: 'Games must select the complete highest-priority observed appearance tier.',
          });
        }
        const matchFacts = content.matchUniverseFactIds.map(
          (factId) => membershipById.get(factId)?.fact
        );
        if (
          matchFacts.some(
            (fact) =>
              fact?.content.factKind !== 'match_universe' ||
              fact.content.match.matchId !== content.matchId
          )
        ) {
          context.addIssue({
            code: 'custom',
            path: ['results'],
            message: 'Games completion evidence must reference exact facts for the same match.',
          });
        }
        const matchFactsWithPriority = matchFacts.flatMap((fact) => {
          if (fact?.content.factKind !== 'match_universe') return [];
          const preference = run.policy.content.gamesRule.matchUniverseSources.find(
            ({ provider, capabilityId }) =>
              provider === fact.content.provider && capabilityId === fact.content.capabilityId
          );
          if (preference === undefined) return [];
          return [
            {
              factId: fact.factId,
              completionState: fact.content.completion.state,
              priority: preference.priority,
            },
          ];
        });
        if (matchFactsWithPriority.length !== matchFacts.length) {
          context.addIssue({
            code: 'custom',
            path: ['results'],
            message: 'Every games completion fact must be authorized by the exact policy.',
          });
        }
        const usable = matchFactsWithPriority.filter(
          ({ completionState }) => completionState !== 'quarantined'
        );
        const selectionPool = usable.length > 0 ? usable : matchFactsWithPriority;
        const selectedPriority = selectionPool.reduce(
          (best, item) => Math.min(best, item.priority),
          Number.POSITIVE_INFINITY
        );
        const expectedSelectedMatchIds = selectionPool
          .filter(({ priority }) => priority === selectedPriority)
          .map(({ factId }) => factId)
          .sort();
        if (
          expectedSelectedMatchIds.length !== content.selectedMatchUniverseFactIds.length ||
          expectedSelectedMatchIds.some(
            (factId, index) => content.selectedMatchUniverseFactIds[index] !== factId
          )
        ) {
          context.addIssue({
            code: 'custom',
            path: ['results'],
            message: 'Games must select the complete highest-priority usable completion tier.',
          });
        }
        const selectedCompletionStates = new Set(
          selectionPool
            .filter(({ priority }) => priority === selectedPriority)
            .map(({ completionState }) => completionState)
        );
        const gamesState = selectedCompletionStates.has('quarantined')
          ? 'quarantined'
          : selectedCompletionStates.size > 1
            ? 'conflicting'
            : selectedCompletionStates.has('completed')
              ? 'measured'
              : 'unavailable';
        if (
          content.availability.state !== gamesState ||
          (gamesState === 'measured' && content.availability.numericValue !== '1')
        ) {
          context.addIssue({
            code: 'custom',
            path: ['results'],
            message:
              'Games state must follow exact completion precedence and may measure only one.',
          });
        }
        if (content.availability.state === 'measured') {
          if (
            content.selectedMatchUniverseFactIds.some((factId) => {
              const fact = membershipById.get(factId)?.fact;
              return (
                fact?.content.factKind !== 'match_universe' ||
                fact.content.completion.state !== 'completed'
              );
            })
          ) {
            context.addIssue({
              code: 'custom',
              path: ['results'],
              message: 'Games can equal one only when every selected match fact says completed.',
            });
          }
        }
      }
    }
    const inputMetricFactIds = run.sourceMemberships
      .filter(
        ({ fact }) =>
          fact.content.factKind === 'player_match_metric' ||
          fact.content.factKind === 'player_season_metric'
      )
      .map(({ fact }) => fact.factId);
    const inputAppearanceFactIds = run.sourceMemberships
      .filter(({ fact }) => fact.content.factKind === 'player_appearance')
      .map(({ fact }) => fact.factId);
    const unsupportedSourceFact = run.sourceMemberships.some(
      ({ fact }) => fact.content.factKind === 'player_achievement'
    );
    if (
      unsupportedSourceFact ||
      inputMetricFactIds.length !== consumedMetricFactIds.size ||
      inputMetricFactIds.some((factId) => !consumedMetricFactIds.has(factId)) ||
      inputAppearanceFactIds.length !== consumedAppearanceFactIds.size ||
      inputAppearanceFactIds.some((factId) => !consumedAppearanceFactIds.has(factId))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceMemberships'],
        message:
          'Every numeric fact and appearance must be reconciled exactly once; achievements use their separate factual boundary.',
      });
    }
    const headResultIds = run.headAdvances.map(({ reconciledFactId }) => reconciledFactId);
    const headByResultId = new Map(
      run.headAdvances.map((advance) => [advance.reconciledFactId, advance])
    );
    if (
      run.headAdvances.length !== run.results.length ||
      new Set(headResultIds).size !== headResultIds.length ||
      headResultIds.some((resultId) => !resultIds.includes(resultId))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['headAdvances'],
        message: 'Every result must advance exactly one typed current head.',
      });
    }
    for (const result of run.results) {
      const expectedSubjectKey = createAflTradeContentAddress('reconciled-factual-subject', {
        environment: run.environment,
        competition: result.content.competition,
        seasonYear: result.content.seasonYear,
        playerId: result.content.playerId,
        clubScope: result.content.clubScope,
        matchId: result.content.matchId,
        metricCode: result.content.metricCode,
        definitionVersion: result.content.definitionVersion,
      });
      if (headByResultId.get(result.reconciledFactId)?.subjectKey !== expectedSubjectKey) {
        context.addIssue({
          code: 'custom',
          path: ['headAdvances'],
          message: 'Each current head must use the exact typed reconciled subject key.',
        });
      }
    }
    const stateCounts = {
      measured: run.results.filter(({ content }) => content.availability.state === 'measured')
        .length,
      unavailable: run.results.filter(({ content }) => content.availability.state === 'unavailable')
        .length,
      conflicting: run.results.filter(({ content }) => content.availability.state === 'conflicting')
        .length,
      quarantined: run.results.filter(({ content }) => content.availability.state === 'quarantined')
        .length,
      notApplicable: run.results.filter(
        ({ content }) => content.availability.state === 'not_applicable'
      ).length,
    };
    if (
      run.counts.sourceFacts !== run.sourceMemberships.length ||
      run.counts.reconciledFacts !== run.results.length ||
      Object.entries(stateCounts).some(
        ([key, count]) => run.counts[key as keyof typeof stateCounts] !== count
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['counts'],
        message: 'Reconciliation counts must exactly match immutable inputs and outputs.',
      });
    }
  });

export const aflTradeFactualReconciliationRunSchema = z
  .object({
    factualRunId: aflTradeContentAddressedIdSchema('factual-reconciliation-run'),
    runSha256: aflTradeSha256Schema,
    content: aflTradeFactualReconciliationRunContentSchema,
  })
  .strict()
  .superRefine((run, context) => {
    addAflTradeContentAddressIssue(
      'factual-reconciliation-run',
      run.factualRunId,
      run.content,
      context,
      ['factualRunId']
    );
    if (run.factualRunId !== `factual-reconciliation-run:${run.runSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['runSha256'],
        message: 'Reconciliation-run digest must equal its content-address suffix.',
      });
    }
  });

export type AflTradeFactualReconciliationPolicy = z.infer<
  typeof aflTradeFactualReconciliationPolicySchema
>;
export type AflTradeFactualReconciliationRun = z.infer<
  typeof aflTradeFactualReconciliationRunSchema
>;
export type AflTradeReconciledFactualMetric = z.infer<typeof aflTradeReconciledFactualMetricSchema>;

export function createAflTradeFactualReconciliationPolicy(
  content: unknown
): AflTradeFactualReconciliationPolicy {
  const parsed = aflTradeFactualReconciliationPolicyContentSchema.parse(content);
  const policyId = createAflTradeContentAddress('factual-reconciliation-policy', parsed);
  return aflTradeFactualReconciliationPolicySchema.parse({
    policyId,
    policySha256: policyId.slice('factual-reconciliation-policy:'.length),
    content: parsed,
  });
}

export function createAflTradeReconciledFactualMetric(
  content: unknown
): AflTradeReconciledFactualMetric {
  const parsed = aflTradeReconciledFactualMetricContentSchema.parse(content);
  const reconciledFactId = createAflTradeContentAddress('reconciled-factual-metric', parsed);
  return aflTradeReconciledFactualMetricSchema.parse({
    reconciledFactId,
    factSha256: reconciledFactId.slice('reconciled-factual-metric:'.length),
    content: parsed,
  });
}

export function createAflTradeFactualReconciliationRun(
  content: unknown
): AflTradeFactualReconciliationRun {
  const parsed = aflTradeFactualReconciliationRunContentSchema.parse(content);
  const factualRunId = createAflTradeContentAddress('factual-reconciliation-run', parsed);
  return aflTradeFactualReconciliationRunSchema.parse({
    factualRunId,
    runSha256: factualRunId.slice('factual-reconciliation-run:'.length),
    content: parsed,
  });
}

export function createAflTradeReconciledSubjectKey(content: {
  environment: 'test_fixture' | 'non_production' | 'production';
  competition: 'AFLM' | 'AFLW';
  seasonYear: number;
  playerId: string;
  clubScope:
    | { kind: 'resolved_single_club'; clubId: string }
    | {
        kind: 'reviewed_unattributed';
        clubId: null;
        reasonCode: 'source_does_not_define_club' | 'multi_club_season';
        decision: { id: string; sha256: string };
      };
  matchId: string | null;
  metricCode: string;
  definitionVersion: string;
}): string {
  return createAflTradeContentAddress('reconciled-factual-subject', content);
}
