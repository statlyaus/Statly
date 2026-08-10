import { z } from 'zod';

import { AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY } from '@/types/aflDraftTradeOutcomes';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import { aflTradeSourceFactSchema } from './factualObservationContracts';

export const AFL_TRADE_ACHIEVEMENT_RECONCILIATION_POLICY_SCHEMA_VERSION =
  'afl-trade-achievement-reconciliation-policy/v1' as const;
export const AFL_TRADE_ACHIEVEMENT_RECONCILIATION_RUN_SCHEMA_VERSION =
  'afl-trade-achievement-reconciliation-run/v1' as const;
export const AFL_TRADE_ACHIEVEMENT_RECONCILIATION_AUTHORITY_BOUNDARY =
  'private_canonical_achievement_facts_no_numeric_aggregation_release_valuation_or_fantasy_ownership' as const;

const publicIdSchema = z.string().trim().min(1).max(240);
const seasonSchema = z.number().int().min(1897).max(2200);
const boundedTextSchema = z.string().trim().min(1).max(500);
const boundedCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
const utcInstantSchema = z
  .string()
  .datetime({ offset: true, precision: 3 })
  .regex(/Z$/, 'Canonical achievement instants must use UTC Z notation.');

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

function uniqueSortedSchema<T extends z.ZodType<string>>(schema: T, label: string) {
  return z
    .array(schema)
    .min(1)
    .max(5000)
    .superRefine((values, context) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: 'custom', message: `${label} must be unique.` });
      }
      if (values.some((value, index) => index > 0 && values[index - 1] > value)) {
        context.addIssue({ code: 'custom', message: `${label} must be sorted.` });
      }
    });
}

const achievementCodeSchema = z.enum([
  'all_australian_team',
  'all_australian_squad',
  'rising_star_nomination',
  'rising_star_winner',
]);

const policyApprovalSchema = immutableReferenceSchema('achievement-reconciliation-policy-approval');
const achievementDefinitionSchema = immutableReferenceSchema('achievement-definition');
const seasonClubScopeDecisionSchema = immutableReferenceSchema('season-club-scope-decision');

const clubScopeSchema = z.discriminatedUnion('kind', [
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

const achievementRuleSchema = z
  .object({
    achievementCode: achievementCodeSchema,
    definition: achievementDefinitionSchema,
    sourcePreferences: z.array(sourcePreferenceSchema).min(1).max(100),
    selection: z.literal('lowest_priority_tier_with_usable_evidence'),
    agreement: z.literal('exact_normalized_evidence_value'),
    conflict: z.literal('preserve_same_tier_disagreement'),
    absence: z.literal('unavailable_never_negative_achievement'),
    inference: z.literal('forbidden'),
  })
  .strict()
  .superRefine((rule, context) => {
    const sourceKeys = rule.sourcePreferences.map(
      ({ provider, capabilityId }) => `${provider}:${capabilityId}`
    );
    if (new Set(sourceKeys).size !== sourceKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['sourcePreferences'],
        message: 'An achievement policy cannot repeat a provider capability.',
      });
    }
  });

export const aflTradeAchievementReconciliationPolicyContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_ACHIEVEMENT_RECONCILIATION_POLICY_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY),
    authorityBoundary: z.literal(AFL_TRADE_ACHIEVEMENT_RECONCILIATION_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.enum(['AFLM', 'AFLW']),
    validFromSeason: seasonSchema,
    validThroughSeason: seasonSchema,
    policyVersion: boundedCodeSchema,
    rules: z.array(achievementRuleSchema).min(1).max(4),
    approvedAt: utcInstantSchema,
    approval: policyApprovalSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.validThroughSeason < policy.validFromSeason) {
      context.addIssue({
        code: 'custom',
        path: ['validThroughSeason'],
        message: 'Achievement-policy season range is inverted.',
      });
    }
    const codes = policy.rules.map(({ achievementCode }) => achievementCode);
    if (new Set(codes).size !== codes.length) {
      context.addIssue({
        code: 'custom',
        path: ['rules'],
        message: 'Rules must be unique by code.',
      });
    }
  });

export const aflTradeAchievementReconciliationPolicySchema = z
  .object({
    policyId: aflTradeContentAddressedIdSchema('achievement-reconciliation-policy'),
    policySha256: aflTradeSha256Schema,
    content: aflTradeAchievementReconciliationPolicyContentSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    addAflTradeContentAddressIssue(
      'achievement-reconciliation-policy',
      policy.policyId,
      policy.content,
      context,
      ['policyId']
    );
    if (policy.policyId !== `achievement-reconciliation-policy:${policy.policySha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['policySha256'],
        message: 'Achievement-policy digest must equal its content-address suffix.',
      });
    }
  });

const achievementSourceMembershipSchema = z
  .object({
    ordinal: z.number().int().positive().max(5000),
    fact: aflTradeSourceFactSchema,
    factSha256: aflTradeSha256Schema,
  })
  .strict()
  .superRefine((membership, context) => {
    if (membership.fact.content.factKind !== 'player_achievement') {
      context.addIssue({
        code: 'custom',
        path: ['fact'],
        message: 'Achievement reconciliation accepts achievement source facts only.',
      });
    }
    if (membership.fact.factId !== `source-fact:${membership.factSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['factSha256'],
        message: 'Source-fact digest must equal its content-address suffix.',
      });
    }
  });

const achievementGrainSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('season') }).strict(),
  z.object({ kind: z.literal('round'), roundLabel: boundedTextSchema }).strict(),
]);

const achievementAvailabilitySchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('affirmed'),
      evidenceValue: boundedTextSchema,
      inputSourceFactIds: uniqueSortedSchema(
        aflTradeContentAddressedIdSchema('source-fact'),
        'Input achievement facts'
      ),
      selectedSourceFactIds: uniqueSortedSchema(
        aflTradeContentAddressedIdSchema('source-fact'),
        'Selected achievement facts'
      ),
      reasonCode: z.null(),
    })
    .strict(),
  z
    .object({
      state: z.literal('conflicting'),
      evidenceValue: z.null(),
      inputSourceFactIds: uniqueSortedSchema(
        aflTradeContentAddressedIdSchema('source-fact'),
        'Input achievement facts'
      ),
      selectedSourceFactIds: uniqueSortedSchema(
        aflTradeContentAddressedIdSchema('source-fact'),
        'Conflicting achievement facts'
      ),
      alternatives: z
        .array(
          z
            .object({
              evidenceValue: boundedTextSchema,
              sourceFactIds: uniqueSortedSchema(
                aflTradeContentAddressedIdSchema('source-fact'),
                'Alternative source facts'
              ),
            })
            .strict()
        )
        .min(2)
        .max(100),
      reasonCode: z.literal('same_priority_sources_disagree'),
    })
    .strict(),
  z
    .object({
      state: z.enum(['unavailable', 'quarantined', 'not_applicable']),
      evidenceValue: z.null(),
      inputSourceFactIds: uniqueSortedSchema(
        aflTradeContentAddressedIdSchema('source-fact'),
        'Input achievement facts'
      ),
      selectedSourceFactIds: z.array(aflTradeContentAddressedIdSchema('source-fact')).length(0),
      reasonCode: z.enum([
        'no_usable_approved_source',
        'source_value_missing',
        'source_fact_quarantined',
        'field_not_applicable',
      ]),
    })
    .strict(),
]);

export const aflTradeReconciledAchievementContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-reconciled-achievement/v1'),
    publicAssetBoundary: z.literal(AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY),
    authorityBoundary: z.literal(AFL_TRADE_ACHIEVEMENT_RECONCILIATION_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.enum(['AFLM', 'AFLW']),
    seasonYear: seasonSchema,
    playerId: publicIdSchema,
    clubScope: clubScopeSchema,
    achievementCode: achievementCodeSchema,
    definition: achievementDefinitionSchema,
    grain: achievementGrainSchema,
    availability: achievementAvailabilitySchema,
    effectiveAt: utcInstantSchema,
    effectiveThrough: utcInstantSchema,
    recordedAt: utcInstantSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (
      Date.parse(result.effectiveAt) > Date.parse(result.effectiveThrough) ||
      Date.parse(result.effectiveThrough) > Date.parse(result.recordedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recordedAt'],
        message: 'Achievement effective and knowledge chronology is invalid.',
      });
    }
    const requiresRound = result.achievementCode === 'rising_star_nomination';
    if (requiresRound !== (result.grain.kind === 'round')) {
      context.addIssue({
        code: 'custom',
        path: ['grain'],
        message: 'Only Rising Star nominations use round grain.',
      });
    }
  });

export const aflTradeReconciledAchievementSchema = z
  .object({
    reconciledAchievementId: aflTradeContentAddressedIdSchema('reconciled-achievement'),
    factSha256: aflTradeSha256Schema,
    content: aflTradeReconciledAchievementContentSchema,
  })
  .strict()
  .superRefine((result, context) => {
    addAflTradeContentAddressIssue(
      'reconciled-achievement',
      result.reconciledAchievementId,
      result.content,
      context,
      ['reconciledAchievementId']
    );
    if (result.reconciledAchievementId !== `reconciled-achievement:${result.factSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['factSha256'],
        message: 'Reconciled-achievement digest must equal its content-address suffix.',
      });
    }
  });

const headAdvanceSchema = z
  .object({
    subjectKey: aflTradeContentAddressedIdSchema('reconciled-achievement-subject'),
    expectedRevision: z.number().int().nonnegative(),
    revision: z.number().int().positive(),
    reconciledAchievementId: aflTradeContentAddressedIdSchema('reconciled-achievement'),
  })
  .strict()
  .superRefine((head, context) => {
    if (head.revision !== head.expectedRevision + 1) {
      context.addIssue({
        code: 'custom',
        path: ['revision'],
        message: 'Head revision must advance once.',
      });
    }
  });

export const aflTradeAchievementReconciliationRunContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_ACHIEVEMENT_RECONCILIATION_RUN_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY),
    authorityBoundary: z.literal(AFL_TRADE_ACHIEVEMENT_RECONCILIATION_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.enum(['AFLM', 'AFLW']),
    seasonYear: seasonSchema,
    policyId: aflTradeContentAddressedIdSchema('achievement-reconciliation-policy'),
    policySha256: aflTradeSha256Schema,
    sourceMemberships: z.array(achievementSourceMembershipSchema).min(1).max(5000),
    sourceSetSha256: aflTradeSha256Schema,
    results: z.array(aflTradeReconciledAchievementSchema).min(1).max(5000),
    resultSetSha256: aflTradeSha256Schema,
    headAdvances: z.array(headAdvanceSchema).min(1).max(5000),
    counts: z
      .object({
        sourceFacts: z.number().int().positive(),
        results: z.number().int().positive(),
        affirmed: z.number().int().nonnegative(),
        conflicting: z.number().int().nonnegative(),
        unavailable: z.number().int().nonnegative(),
        quarantined: z.number().int().nonnegative(),
        notApplicable: z.number().int().nonnegative(),
      })
      .strict(),
    startedAt: utcInstantSchema,
    completedAt: utcInstantSchema,
  })
  .strict()
  .superRefine((run, context) => {
    if (run.policyId !== `achievement-reconciliation-policy:${run.policySha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['policySha256'],
        message: 'Policy digest mismatch.',
      });
    }
    if (Date.parse(run.completedAt) < Date.parse(run.startedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Run chronology is invalid.',
      });
    }
    const memberships = run.sourceMemberships;
    const expectedOrdinals = memberships.map((_, index) => index + 1);
    const factIds = memberships.map(({ fact }) => fact.factId);
    if (
      memberships.some(({ ordinal }, index) => ordinal !== expectedOrdinals[index]) ||
      new Set(factIds).size !== factIds.length ||
      factIds.some((id, index) => index > 0 && factIds[index - 1] > id) ||
      run.sourceSetSha256 !== sha256AflTradeCanonicalJson(memberships)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceMemberships'],
        message: 'Achievement source membership must be complete, unique, sorted and digest-bound.',
      });
    }
    if (run.resultSetSha256 !== sha256AflTradeCanonicalJson(run.results)) {
      context.addIssue({
        code: 'custom',
        path: ['resultSetSha256'],
        message: 'Result-set digest mismatch.',
      });
    }
    const membershipById = new Map(memberships.map(({ fact }) => [fact.factId, fact]));
    const consumed = new Set<string>();
    for (const result of run.results) {
      const content = result.content;
      if (
        content.environment !== run.environment ||
        content.competition !== run.competition ||
        content.seasonYear !== run.seasonYear ||
        Date.parse(content.recordedAt) > Date.parse(run.completedAt)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['results'],
          message: 'Result scope or chronology differs from its run.',
        });
      }
      const inputIds = content.availability.inputSourceFactIds;
      const selectedIds = new Set(content.availability.selectedSourceFactIds);
      if ([...selectedIds].some((sourceFactId) => !inputIds.includes(sourceFactId))) {
        context.addIssue({
          code: 'custom',
          path: ['results'],
          message: 'Selected achievement evidence must be a subset of the exact input facts.',
        });
      }
      for (const sourceFactId of inputIds) {
        const source = membershipById.get(sourceFactId);
        const sourceClubScopeMatches =
          source?.content.factKind === 'player_achievement' &&
          ((source.content.seasonClubScope.kind === 'resolved_single_club' &&
            content.clubScope.kind === 'resolved_single_club' &&
            source.content.seasonClubScope.club.clubId === content.clubScope.clubId) ||
            (source.content.seasonClubScope.kind === 'reviewed_unattributed' &&
              content.clubScope.kind === 'reviewed_unattributed' &&
              content.clubScope.clubId === null &&
              source.content.seasonClubScope.reasonCode === content.clubScope.reasonCode &&
              source.content.seasonClubScope.decision.id === content.clubScope.decision.id));
        if (
          source?.content.factKind !== 'player_achievement' ||
          source.content.environment !== content.environment ||
          source.content.competition !== content.competition ||
          source.content.player.playerId !== content.playerId ||
          source.content.achievementCode !== content.achievementCode ||
          source.content.seasonYear !== content.seasonYear ||
          JSON.stringify(source.content.achievementGrain) !== JSON.stringify(content.grain) ||
          !sourceClubScopeMatches ||
          source.content.achievementDefinition.id !== content.definition.id
        ) {
          context.addIssue({
            code: 'custom',
            path: ['results'],
            message: 'Result selected a source fact from another achievement subject.',
          });
        }
        consumed.add(sourceFactId);
      }
      if (
        content.availability.state === 'affirmed' &&
        content.availability.selectedSourceFactIds.some((sourceFactId) => {
          const source = membershipById.get(sourceFactId);
          return (
            source?.content.factKind !== 'player_achievement' ||
            source.content.availability.state !== 'affirmed' ||
            source.content.availability.evidenceValue !== content.availability.evidenceValue
          );
        })
      ) {
        context.addIssue({
          code: 'custom',
          path: ['results'],
          message: 'Affirmed achievement evidence must agree exactly with the canonical value.',
        });
      }
    }
    if (factIds.some((id) => !consumed.has(id))) {
      context.addIssue({
        code: 'custom',
        path: ['sourceMemberships'],
        message: 'Every achievement source fact must be reconciled exactly once.',
      });
    }
    const resultIds = run.results.map(({ reconciledAchievementId }) => reconciledAchievementId);
    if (
      run.headAdvances.length !== run.results.length ||
      new Set(resultIds).size !== resultIds.length ||
      run.headAdvances.some((head) => !resultIds.includes(head.reconciledAchievementId))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['headAdvances'],
        message: 'Each result requires one current-head advance.',
      });
    }
    const resultById = new Map(
      run.results.map((result) => [result.reconciledAchievementId, result])
    );
    if (
      run.headAdvances.some((head) => {
        const result = resultById.get(head.reconciledAchievementId);
        return (
          result === undefined ||
          head.subjectKey !==
            createAflTradeReconciledAchievementSubjectKey({
              environment: result.content.environment,
              competition: result.content.competition,
              seasonYear: result.content.seasonYear,
              playerId: result.content.playerId,
              clubScope: result.content.clubScope,
              achievementCode: result.content.achievementCode,
              grain: result.content.grain,
            })
        );
      })
    ) {
      context.addIssue({
        code: 'custom',
        path: ['headAdvances'],
        message: 'Achievement head does not match the exact result subject.',
      });
    }
    const expectedCounts = {
      sourceFacts: memberships.length,
      results: run.results.length,
      affirmed: run.results.filter(({ content }) => content.availability.state === 'affirmed')
        .length,
      conflicting: run.results.filter(({ content }) => content.availability.state === 'conflicting')
        .length,
      unavailable: run.results.filter(({ content }) => content.availability.state === 'unavailable')
        .length,
      quarantined: run.results.filter(({ content }) => content.availability.state === 'quarantined')
        .length,
      notApplicable: run.results.filter(
        ({ content }) => content.availability.state === 'not_applicable'
      ).length,
    };
    if (
      Object.entries(expectedCounts).some(
        ([key, value]) => run.counts[key as keyof typeof expectedCounts] !== value
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['counts'],
        message: 'Achievement-run counts do not match exact results.',
      });
    }
  });

export const aflTradeAchievementReconciliationRunSchema = z
  .object({
    achievementRunId: aflTradeContentAddressedIdSchema('achievement-reconciliation-run'),
    runSha256: aflTradeSha256Schema,
    content: aflTradeAchievementReconciliationRunContentSchema,
  })
  .strict()
  .superRefine((run, context) => {
    addAflTradeContentAddressIssue(
      'achievement-reconciliation-run',
      run.achievementRunId,
      run.content,
      context,
      ['achievementRunId']
    );
    if (run.achievementRunId !== `achievement-reconciliation-run:${run.runSha256}`) {
      context.addIssue({ code: 'custom', path: ['runSha256'], message: 'Run digest mismatch.' });
    }
  });

export type AflTradeAchievementReconciliationPolicy = z.infer<
  typeof aflTradeAchievementReconciliationPolicySchema
>;
export type AflTradeReconciledAchievement = z.infer<typeof aflTradeReconciledAchievementSchema>;
export type AflTradeAchievementReconciliationRun = z.infer<
  typeof aflTradeAchievementReconciliationRunSchema
>;

export function createAflTradeAchievementReconciliationPolicy(
  content: z.input<typeof aflTradeAchievementReconciliationPolicyContentSchema>
): AflTradeAchievementReconciliationPolicy {
  const parsed = aflTradeAchievementReconciliationPolicyContentSchema.parse(content);
  const policyId = createAflTradeContentAddress('achievement-reconciliation-policy', parsed);
  return aflTradeAchievementReconciliationPolicySchema.parse({
    policyId,
    policySha256: policyId.slice('achievement-reconciliation-policy:'.length),
    content: parsed,
  });
}

export function createAflTradeReconciledAchievement(
  content: z.input<typeof aflTradeReconciledAchievementContentSchema>
): AflTradeReconciledAchievement {
  const parsed = aflTradeReconciledAchievementContentSchema.parse(content);
  const reconciledAchievementId = createAflTradeContentAddress('reconciled-achievement', parsed);
  return aflTradeReconciledAchievementSchema.parse({
    reconciledAchievementId,
    factSha256: reconciledAchievementId.slice('reconciled-achievement:'.length),
    content: parsed,
  });
}

export function createAflTradeAchievementReconciliationRun(
  content: z.input<typeof aflTradeAchievementReconciliationRunContentSchema>
): AflTradeAchievementReconciliationRun {
  const parsed = aflTradeAchievementReconciliationRunContentSchema.parse(content);
  const achievementRunId = createAflTradeContentAddress('achievement-reconciliation-run', parsed);
  return aflTradeAchievementReconciliationRunSchema.parse({
    achievementRunId,
    runSha256: achievementRunId.slice('achievement-reconciliation-run:'.length),
    content: parsed,
  });
}

export function createAflTradeReconciledAchievementSubjectKey(
  content: Pick<
    z.infer<typeof aflTradeReconciledAchievementContentSchema>,
    | 'environment'
    | 'competition'
    | 'seasonYear'
    | 'playerId'
    | 'clubScope'
    | 'achievementCode'
    | 'grain'
  >
): string {
  return createAflTradeContentAddress('reconciled-achievement-subject', content);
}
