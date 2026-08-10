import { z } from 'zod';

import { AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY } from '@/types/aflDraftTradeOutcomes';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import { aflDraftTradeOutcomeFactualReleaseManifestSchema } from './outcomeReleaseContracts';

export const AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_SCHEMA_VERSION =
  'afl-trade-factual-release-candidate/v3' as const;
export const AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_AUTHORITY_BOUNDARY =
  'private_typed_release_candidate_no_activation_valuation_or_fantasy_ownership' as const;

const publicIdSchema = z.string().trim().min(1).max(300);
const seasonSchema = z.number().int().min(1897).max(2200);
const utcInstantSchema = z
  .string()
  .datetime({ offset: true, precision: 3 })
  .regex(/Z$/, 'Release-candidate instants must use UTC Z notation.');

function immutableReferenceSchema(prefix: string) {
  return z
    .object({ id: aflTradeContentAddressedIdSchema(prefix), sha256: aflTradeSha256Schema })
    .strict()
    .superRefine((reference, context) => {
      if (reference.id !== `${prefix}:${reference.sha256}`) {
        context.addIssue({
          code: 'custom',
          path: ['sha256'],
          message: `${prefix} digest mismatch.`,
        });
      }
    });
}

function typedSetSchema<T extends z.ZodTypeAny>(
  member: T,
  id: (value: z.infer<T>) => string,
  minimum = 1
) {
  return z
    .array(member)
    .min(minimum)
    .max(100_000)
    .superRefine((values, context) => {
      const ids = values.map(id);
      if (new Set(ids).size !== ids.length) {
        context.addIssue({ code: 'custom', message: 'Typed release members must be unique.' });
      }
      if (ids.some((value, index) => index > 0 && ids[index - 1] > value)) {
        context.addIssue({ code: 'custom', message: 'Typed release members must be sorted.' });
      }
      if (values.some((value, index) => (value as { ordinal: number }).ordinal !== index + 1)) {
        context.addIssue({ code: 'custom', message: 'Typed release ordinals must be contiguous.' });
      }
    });
}

const recordMemberBase = {
  ordinal: z.number().int().positive().max(100_000),
  recordSha256: aflTradeSha256Schema,
  recordedAt: utcInstantSchema,
};

const sourceCaptureMemberSchema = z
  .object({
    ...recordMemberBase,
    captureId: publicIdSchema,
    sourceSnapshotId: aflTradeContentAddressedIdSchema('source-snapshot'),
    gate0aDecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    consumedFieldSetSha256: aflTradeSha256Schema,
  })
  .strict();

const eventMemberSchema = z
  .object({ ...recordMemberBase, eventVersionId: publicIdSchema, eventId: publicIdSchema })
  .strict();
const lineageMemberSchema = z.object({ ...recordMemberBase, edgeId: publicIdSchema }).strict();
const acquisitionSpellMemberSchema = z
  .object({
    ...recordMemberBase,
    spellVersionId: aflTradeContentAddressedIdSchema('acquisition-spell-version'),
    // Additive v3 field: older sealed candidates remain readable, while valuation admission
    // requires the stable spell subject so revisions cannot cross dataset partitions.
    spellId: publicIdSchema.optional(),
    playerId: publicIdSchema,
    clubId: publicIdSchema,
    startDate: z.string().date(),
    endDate: z.string().date().nullable(),
  })
  .strict();

const factualRunMemberSchema = z
  .object({
    ...recordMemberBase,
    factualRunId: aflTradeContentAddressedIdSchema('factual-reconciliation-run'),
    finalization: immutableReferenceSchema('factual-reconciliation-finalization'),
    competition: z.enum(['AFLM', 'AFLW']),
    seasonYear: seasonSchema,
  })
  .strict();

const metricMemberSchema = z
  .object({
    ...recordMemberBase,
    reconciledFactId: aflTradeContentAddressedIdSchema('reconciled-factual-metric'),
    factualRunId: aflTradeContentAddressedIdSchema('factual-reconciliation-run'),
    subjectKey: aflTradeContentAddressedIdSchema('reconciled-factual-subject'),
    headRevision: z.number().int().positive(),
    playerId: publicIdSchema,
    clubId: publicIdSchema.nullable(),
    competition: z.enum(['AFLM', 'AFLW']),
    seasonYear: seasonSchema,
    metricCode: z.enum(['games', 'goals', 'brownlow_votes', 'coaches_votes']),
    definition: immutableReferenceSchema('metric-definition'),
    state: z.enum([
      'measured',
      'unresolved',
      'conflicting',
      'quarantined',
      'not_applicable',
      'unavailable',
    ]),
    effectiveThrough: utcInstantSchema,
  })
  .strict();

const achievementRunMemberSchema = z
  .object({
    ...recordMemberBase,
    achievementRunId: aflTradeContentAddressedIdSchema('achievement-reconciliation-run'),
    finalization: immutableReferenceSchema('achievement-reconciliation-finalization'),
    competition: z.enum(['AFLM', 'AFLW']),
    seasonYear: seasonSchema,
  })
  .strict();

const achievementMemberSchema = z
  .object({
    ...recordMemberBase,
    reconciledAchievementId: aflTradeContentAddressedIdSchema('reconciled-achievement'),
    achievementRunId: aflTradeContentAddressedIdSchema('achievement-reconciliation-run'),
    subjectKey: aflTradeContentAddressedIdSchema('reconciled-achievement-subject'),
    headRevision: z.number().int().positive(),
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
    definition: immutableReferenceSchema('achievement-definition'),
    grain: z.enum(['season', 'round']),
    state: z.enum(['affirmed', 'conflicting', 'quarantined', 'not_applicable', 'unavailable']),
    effectiveThrough: utcInstantSchema,
  })
  .strict();

const spellMetricMemberSchema = z
  .object({
    ...recordMemberBase,
    spellMetricVersionId: aflTradeContentAddressedIdSchema('acquisition-spell-metric-version'),
    subjectKey: aflTradeContentAddressedIdSchema('acquisition-spell-metric-subject'),
    headRevision: z.number().int().positive(),
    spellVersionId: aflTradeContentAddressedIdSchema('acquisition-spell-version'),
    policyId: aflTradeContentAddressedIdSchema('acquisition-spell-metric-policy'),
    playerId: publicIdSchema,
    clubId: publicIdSchema,
    metricCode: z.enum(['games', 'goals', 'brownlow_votes', 'coaches_votes']),
    definition: immutableReferenceSchema('metric-definition'),
    state: z.enum(['complete', 'partial', 'unavailable', 'conflicting', 'quarantined']),
    effectiveThrough: z.string().date(),
  })
  .strict();

const reviewDecisionMemberSchema = z
  .object({ ...recordMemberBase, decisionId: publicIdSchema, subjectType: publicIdSchema })
  .strict();

export const aflTradeFactualReleaseTypedMembersSchema = z
  .object({
    sourceCaptures: typedSetSchema(sourceCaptureMemberSchema, (value) => value.captureId),
    eventVersions: typedSetSchema(eventMemberSchema, (value) => value.eventVersionId),
    lineageEdges: typedSetSchema(lineageMemberSchema, (value) => value.edgeId, 0),
    acquisitionSpells: typedSetSchema(
      acquisitionSpellMemberSchema,
      (value) => value.spellVersionId
    ),
    factualRuns: typedSetSchema(factualRunMemberSchema, (value) => value.factualRunId, 0),
    reconciledMetrics: typedSetSchema(metricMemberSchema, (value) => value.reconciledFactId, 0),
    achievementRuns: typedSetSchema(
      achievementRunMemberSchema,
      (value) => value.achievementRunId,
      0
    ),
    reconciledAchievements: typedSetSchema(
      achievementMemberSchema,
      (value) => value.reconciledAchievementId,
      0
    ),
    spellMetrics: typedSetSchema(spellMetricMemberSchema, (value) => value.spellMetricVersionId, 0),
    reviewDecisions: typedSetSchema(reviewDecisionMemberSchema, (value) => value.decisionId),
  })
  .strict()
  .superRefine((members, context) => {
    const stableSpellIds = members.acquisitionSpells.flatMap(({ spellId }) =>
      spellId === undefined ? [] : [spellId]
    );
    if (new Set(stableSpellIds).size !== stableSpellIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['acquisitionSpells'],
        message: 'A factual candidate cannot contain multiple current versions of one spell.',
      });
    }
  });

const countsSchema = z
  .object({
    sourceCaptures: z.number().int().positive(),
    eventVersions: z.number().int().positive(),
    lineageEdges: z.number().int().nonnegative(),
    acquisitionSpells: z.number().int().positive(),
    factualRuns: z.number().int().nonnegative(),
    reconciledMetrics: z.number().int().nonnegative(),
    achievementRuns: z.number().int().nonnegative(),
    reconciledAchievements: z.number().int().nonnegative(),
    spellMetrics: z.number().int().nonnegative(),
    reviewDecisions: z.number().int().positive(),
  })
  .strict();

export const aflTradeFactualReleaseCandidateContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY),
    authorityBoundary: z.literal(AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    scopeKey: publicIdSchema,
    competition: z.enum(['AFLM', 'AFLW']),
    validFromSeason: seasonSchema,
    validThroughSeason: seasonSchema,
    createdAt: utcInstantSchema,
    effectiveThrough: utcInstantSchema,
    targetRelease: immutableReferenceSchema('outcome-release'),
    targetReleaseManifest: aflDraftTradeOutcomeFactualReleaseManifestSchema,
    archiveDataset: immutableReferenceSchema('archive-dataset'),
    sourceSnapshotSet: immutableReferenceSchema('source-snapshot-set'),
    metricRegistryVersion: publicIdSchema,
    acquisitionSpellRule: immutableReferenceSchema('acquisition-spell-rule'),
    members: aflTradeFactualReleaseTypedMembersSchema,
    memberSetSha256: aflTradeSha256Schema,
    counts: countsSchema,
    exceptionCount: z.number().int().nonnegative(),
    unresolvedIdentityCount: z.number().int().nonnegative(),
    unresolvedLineageCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((candidate, context) => {
    const cutoff = Date.parse(candidate.effectiveThrough);
    const manifest = candidate.targetReleaseManifest;
    const manifestMetricDefinitionIds = new Set(
      manifest.content.metricDefinitions.map(({ metricDefinitionId }) => metricDefinitionId)
    );
    const manifestRightsBySnapshot = new Map(
      manifest.content.sourceRightsBindings.map((binding) => [binding.sourceSnapshotId, binding])
    );
    if (
      candidate.validThroughSeason < candidate.validFromSeason ||
      cutoff > Date.parse(candidate.createdAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveThrough'],
        message: 'Release cutoff is invalid.',
      });
    }
    if (
      manifest.releaseId !== candidate.targetRelease.id ||
      candidate.targetRelease.sha256 !== manifest.releaseId.slice('outcome-release:'.length) ||
      manifest.content.environment !== candidate.environment ||
      manifest.content.scopeKey !== candidate.scopeKey ||
      manifest.content.effectiveThrough !== candidate.effectiveThrough ||
      Date.parse(manifest.content.createdAt) > Date.parse(candidate.createdAt) ||
      manifest.content.archiveDatasetId !== candidate.archiveDataset.id ||
      manifest.content.sourceSnapshotSetId !== candidate.sourceSnapshotSet.id ||
      manifest.content.metricRegistryVersion !== candidate.metricRegistryVersion ||
      manifest.content.acquisitionSpellRuleId !== candidate.acquisitionSpellRule.id
    ) {
      context.addIssue({
        code: 'custom',
        path: ['targetReleaseManifest'],
        message: 'Target release manifest does not exactly describe this factual candidate.',
      });
    }
    if (manifest.content.sourceMemberSetSha256 !== candidate.memberSetSha256) {
      context.addIssue({
        code: 'custom',
        path: ['memberSetSha256'],
        message: 'Factual release source root must equal the candidate member-set root.',
      });
    }
    const expectedCounts = Object.fromEntries(
      Object.entries(candidate.members).map(([kind, members]) => [kind, members.length])
    );
    if (
      Object.entries(expectedCounts).some(
        ([kind, count]) => candidate.counts[kind as keyof typeof candidate.counts] !== count
      ) ||
      candidate.memberSetSha256 !== sha256AflTradeCanonicalJson(candidate.members)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['members'],
        message: 'Typed member counts or digest mismatch.',
      });
    }
    const allRecordedAt = Object.values(candidate.members).flatMap((members) =>
      members.map(({ recordedAt }) => Date.parse(recordedAt))
    );
    if (allRecordedAt.some((recordedAt) => recordedAt > Date.parse(candidate.createdAt))) {
      context.addIssue({
        code: 'custom',
        path: ['createdAt'],
        message: 'Candidate predates a member.',
      });
    }
    const factualRunIds = new Set(
      candidate.members.factualRuns.map(({ factualRunId }) => factualRunId)
    );
    const achievementRunIds = new Set(
      candidate.members.achievementRuns.map(({ achievementRunId }) => achievementRunId)
    );
    const spellIds = new Set(
      candidate.members.acquisitionSpells.map(({ spellVersionId }) => spellVersionId)
    );
    if (
      candidate.members.reconciledMetrics.some(
        (member) =>
          !factualRunIds.has(member.factualRunId) ||
          member.competition !== candidate.competition ||
          member.effectiveThrough > candidate.effectiveThrough
      ) ||
      candidate.members.reconciledAchievements.some(
        (member) =>
          !achievementRunIds.has(member.achievementRunId) ||
          member.competition !== candidate.competition ||
          member.effectiveThrough > candidate.effectiveThrough
      ) ||
      candidate.members.spellMetrics.some((member) => !spellIds.has(member.spellVersionId))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['members'],
        message: 'Typed member closure is incomplete.',
      });
    }
    if (
      candidate.members.sourceCaptures.some((member) => {
        const rights = manifestRightsBySnapshot.get(member.sourceSnapshotId);
        return !rights || rights.gateDecisionId !== member.gate0aDecisionId;
      }) ||
      [...manifestRightsBySnapshot.keys()].some(
        (sourceSnapshotId) =>
          !candidate.members.sourceCaptures.some(
            (member) => member.sourceSnapshotId === sourceSnapshotId
          )
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['members', 'sourceCaptures'],
        message: 'Every source capture must be covered by the exact target release rights binding.',
      });
    }
    if (
      candidate.members.reconciledMetrics.some(
        ({ definition }) => !manifestMetricDefinitionIds.has(definition.id)
      ) ||
      manifest.content.outcomeRecordCount !==
        candidate.counts.reconciledMetrics +
          candidate.counts.reconciledAchievements +
          candidate.counts.spellMetrics ||
      manifest.content.exceptionCount !== candidate.exceptionCount ||
      manifest.content.unresolvedIdentityCount !== candidate.unresolvedIdentityCount ||
      manifest.content.unresolvedLineageCount !== candidate.unresolvedLineageCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['targetReleaseManifest'],
        message: 'Target release definitions and reported counts must equal the typed candidate.',
      });
    }
  });

export const aflTradeFactualReleaseCandidateSchema = z
  .object({
    candidateId: aflTradeContentAddressedIdSchema('factual-release-candidate'),
    candidateSha256: aflTradeSha256Schema,
    content: aflTradeFactualReleaseCandidateContentSchema,
  })
  .strict()
  .superRefine((candidate, context) => {
    addAflTradeContentAddressIssue(
      'factual-release-candidate',
      candidate.candidateId,
      candidate.content,
      context,
      ['candidateId']
    );
    if (candidate.candidateId !== `factual-release-candidate:${candidate.candidateSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['candidateSha256'],
        message: 'Candidate digest mismatch.',
      });
    }
  });

export type AflTradeFactualReleaseCandidate = z.infer<typeof aflTradeFactualReleaseCandidateSchema>;

export function createAflTradeFactualReleaseCandidate(
  content: z.input<typeof aflTradeFactualReleaseCandidateContentSchema>
): AflTradeFactualReleaseCandidate {
  const parsed = aflTradeFactualReleaseCandidateContentSchema.parse(content);
  const candidateId = createAflTradeContentAddress('factual-release-candidate', parsed);
  return aflTradeFactualReleaseCandidateSchema.parse({
    candidateId,
    candidateSha256: candidateId.slice('factual-release-candidate:'.length),
    content: parsed,
  });
}
