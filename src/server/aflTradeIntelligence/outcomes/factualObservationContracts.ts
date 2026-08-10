import { z } from 'zod';

import {
  AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
  aflDraftTradeOutcomeSourceNativeIdSchema,
} from '@/types/aflDraftTradeOutcomes';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';

export const AFL_TRADE_SOURCE_FACT_SCHEMA_VERSION = 'afl-trade-source-fact/v1' as const;
export const AFL_TRADE_SOURCE_FACT_BATCH_SCHEMA_VERSION = 'afl-trade-source-fact-batch/v1' as const;
export const AFL_TRADE_APPEARANCE_CANDIDATE_SCHEMA_VERSION =
  'afl-trade-provider-appearance-candidate/v1' as const;
export const AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY =
  'normalized_source_evidence_only_no_reconciliation_publication_valuation_or_fantasy_ownership' as const;

const publicIdSchema = aflDraftTradeOutcomeSourceNativeIdSchema;
const seasonSchema = z.number().int().min(1897).max(2200);
const utcInstantSchema = z
  .string()
  .datetime({ offset: true, precision: 3 })
  .regex(/Z$/, 'Canonical factual instants must use UTC Z notation.');
const boundedTextSchema = z.string().trim().min(1).max(500);
const sourceFieldSchema = z.string().trim().min(1).max(200);
const definitionVersionSchema = z
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

function uniqueSortedSchema<T extends z.ZodType<string>>(item: T, label: string) {
  return z
    .array(item)
    .max(100_000)
    .superRefine((values, context) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: 'custom', message: `${label} must be unique.` });
      }
      if (values.some((value, index) => index > 0 && values[index - 1]! > value)) {
        context.addIssue({ code: 'custom', message: `${label} must be sorted.` });
      }
    });
}

const immutableResolutionDecisionSchema = immutableReferenceSchema('provider-resolution-decision');
const immutableNormalizationFinalizationSchema = immutableReferenceSchema(
  'provider-normalization-finalization'
);
const immutableIssueSetSchema = immutableReferenceSchema('provider-resolution-issue-set');
const immutableIssueClosureSchema = immutableReferenceSchema('provider-resolution-issue-closure');
const immutableMetricDefinitionSchema = immutableReferenceSchema('metric-definition');
const immutableMatchUniversePolicySchema = immutableReferenceSchema('match-universe-policy');
const immutableAppearancePolicySchema = immutableReferenceSchema('player-appearance-policy');
const immutableAchievementDefinitionSchema = immutableReferenceSchema('achievement-definition');
const immutableSeasonClubScopeDecisionSchema = immutableReferenceSchema(
  'season-club-scope-decision'
);

const issueClosureSchema = z
  .object({ issueId: publicIdSchema, decision: immutableIssueClosureSchema })
  .strict();

const candidateDigestsSchema = z
  .object({
    identity: aflTradeSha256Schema.nullable(),
    match: aflTradeSha256Schema.nullable(),
    metric: aflTradeSha256Schema.nullable(),
    achievement: aflTradeSha256Schema.nullable(),
    appearance: aflTradeSha256Schema.nullable(),
  })
  .strict();

const sourceEvidenceSchema = z
  .object({
    captureId: publicIdSchema,
    normalizationRunId: aflTradeContentAddressedIdSchema('provider-normalization-run'),
    normalizationFinalization: immutableNormalizationFinalizationSchema,
    normalizationFinalizedAt: utcInstantSchema,
    stagingSha256: aflTradeSha256Schema,
    providerDecodedRowId: publicIdSchema,
    sourceRowNumber: z.number().int().positive(),
    sourceRowSha256: aflTradeSha256Schema,
    semanticNaturalKeySha256: aflTradeSha256Schema,
    candidateDigests: candidateDigestsSchema,
    rowStatus: z.enum(['staged', 'needs_review']),
    issueSet: immutableIssueSetSchema,
    blockingIssueCount: z.number().int().nonnegative(),
    openBlockingIssueCount: z.number().int().nonnegative(),
    blockingIssueClosures: z.array(issueClosureSchema).max(1000),
    consumedSourceFields: uniqueSortedSchema(sourceFieldSchema, 'Consumed source fields').min(1),
  })
  .strict()
  .superRefine((source, context) => {
    const issueIds = source.blockingIssueClosures.map(({ issueId }) => issueId);
    const decisionIds = source.blockingIssueClosures.map(({ decision }) => decision.id);
    if (
      new Set(issueIds).size !== issueIds.length ||
      new Set(decisionIds).size !== decisionIds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['blockingIssueClosures'],
        message: 'Each staged issue and closure decision must be referenced at most once.',
      });
    }
    if (issueIds.some((issueId, index) => index > 0 && issueIds[index - 1]! > issueId)) {
      context.addIssue({
        code: 'custom',
        path: ['blockingIssueClosures'],
        message: 'Blocking issue closures must be sorted by issue ID.',
      });
    }
    if (
      source.openBlockingIssueCount > source.blockingIssueCount ||
      source.blockingIssueClosures.length !==
        source.blockingIssueCount - source.openBlockingIssueCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['blockingIssueClosures'],
        message: 'Issue closures must account for every resolved blocking issue exactly once.',
      });
    }
    if (
      source.rowStatus === 'staged' &&
      (source.blockingIssueCount !== 0 ||
        source.openBlockingIssueCount !== 0 ||
        source.blockingIssueClosures.length !== 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['blockingIssueCount'],
        message: 'A clean staged row cannot claim blocking issues or closure decisions.',
      });
    }
    if (
      source.rowStatus === 'needs_review' &&
      (source.blockingIssueCount === 0 ||
        source.openBlockingIssueCount !== 0 ||
        source.blockingIssueClosures.length !== source.blockingIssueCount)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['openBlockingIssueCount'],
        message:
          'A needs-review row is promotable only when every blocking issue has an exact current closure.',
      });
    }
  });

function activeAssignmentSchema<T extends 'player' | 'club' | 'club_alias' | 'match'>(
  entityKind: T
) {
  return z
    .object({
      assignmentCaseId: aflTradeContentAddressedIdSchema('provider-identity-assignment-case'),
      entityKind: z.literal(entityKind),
      revision: z.number().int().positive(),
      decisionId: aflTradeContentAddressedIdSchema('provider-resolution-decision'),
      status: z.literal('active'),
    })
    .strict();
}

const resolutionBase = {
  resolutionCaseId: aflTradeContentAddressedIdSchema('provider-resolution-case'),
  revision: z.number().int().positive(),
  decision: immutableResolutionDecisionSchema,
  canonicalTargetSnapshot: immutableReferenceSchema('canonical-target-snapshot'),
};

const playerResolutionSchema = z
  .object({
    ...resolutionBase,
    mappingScope: z.literal('provider_identity'),
    identityCandidateId: publicIdSchema,
    playerIdentityId: aflTradeContentAddressedIdSchema('provider-player-identity'),
    playerId: publicIdSchema,
    assignment: activeAssignmentSchema('player'),
  })
  .strict()
  .superRefine((resolution, context) => {
    if (resolution.assignment.decisionId !== resolution.decision.id) {
      context.addIssue({
        code: 'custom',
        path: ['assignment', 'decisionId'],
        message: 'The current player assignment must be advanced by the exact resolution decision.',
      });
    }
  });

const clubOccurrenceSchema = z.discriminatedUnion('source', [
  z
    .object({
      source: z.literal('player_affiliation'),
      identityCandidateId: publicIdSchema,
    })
    .strict(),
  z
    .object({
      source: z.literal('match_side'),
      matchCandidateId: publicIdSchema,
      side: z.enum(['home', 'away']),
    })
    .strict(),
]);

const clubResolutionSchema = z
  .discriminatedUnion('mappingScope', [
    z
      .object({
        ...resolutionBase,
        mappingScope: z.literal('provider_identity'),
        occurrence: clubOccurrenceSchema,
        clubIdentityId: aflTradeContentAddressedIdSchema('provider-club-identity'),
        clubId: publicIdSchema,
        assignment: activeAssignmentSchema('club'),
      })
      .strict(),
    z
      .object({
        ...resolutionBase,
        mappingScope: z.literal('temporal_alias'),
        occurrence: clubOccurrenceSchema,
        clubIdentityId: aflTradeContentAddressedIdSchema('provider-club-alias'),
        clubId: publicIdSchema,
        validFromSeason: seasonSchema,
        validThroughSeason: seasonSchema,
        normalizationPolicy: immutableReferenceSchema('provider-resolution-policy'),
        assignment: activeAssignmentSchema('club_alias'),
      })
      .strict(),
  ])
  .superRefine((resolution, context) => {
    if (resolution.assignment.decisionId !== resolution.decision.id) {
      context.addIssue({
        code: 'custom',
        path: ['assignment', 'decisionId'],
        message: 'The current club assignment must be advanced by the exact resolution decision.',
      });
    }
    if (
      resolution.mappingScope === 'temporal_alias' &&
      resolution.validThroughSeason < resolution.validFromSeason
    ) {
      context.addIssue({
        code: 'custom',
        path: ['validThroughSeason'],
        message: 'A temporal club alias validity interval cannot run backwards.',
      });
    }
  });

const matchSideClubResolutionSchema = z
  .object({
    clubId: publicIdSchema,
    resolutionDecision: immutableResolutionDecisionSchema,
    assignment: z.discriminatedUnion('entityKind', [
      activeAssignmentSchema('club'),
      activeAssignmentSchema('club_alias'),
    ]),
  })
  .strict()
  .superRefine((club, context) => {
    if (club.assignment.decisionId !== club.resolutionDecision.id) {
      context.addIssue({
        code: 'custom',
        path: ['assignment', 'decisionId'],
        message: 'A match side must use the exact current club-resolution assignment.',
      });
    }
  });

const matchResolutionSchema = z
  .object({
    ...resolutionBase,
    matchCandidateId: publicIdSchema,
    matchIdentityId: aflTradeContentAddressedIdSchema('provider-match-identity'),
    matchId: publicIdSchema,
    canonicalMatchDate: utcInstantSchema,
    canonicalRoundLabel: boundedTextSchema,
    homeClub: matchSideClubResolutionSchema,
    awayClub: matchSideClubResolutionSchema,
    assignment: activeAssignmentSchema('match'),
  })
  .strict()
  .superRefine((resolution, context) => {
    if (resolution.homeClub.clubId === resolution.awayClub.clubId) {
      context.addIssue({
        code: 'custom',
        path: ['awayClub', 'clubId'],
        message: 'A resolved match must contain two distinct AFL clubs.',
      });
    }
    if (resolution.homeClub.resolutionDecision.id === resolution.awayClub.resolutionDecision.id) {
      context.addIssue({
        code: 'custom',
        path: ['awayClub', 'resolutionDecision'],
        message: 'Home and away clubs require distinct current resolution decisions.',
      });
    }
    if (resolution.assignment.decisionId !== resolution.decision.id) {
      context.addIssue({
        code: 'custom',
        path: ['assignment', 'decisionId'],
        message: 'The current match assignment must be advanced by the exact resolution decision.',
      });
    }
  });

const seasonClubScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('resolved_single_club'), club: clubResolutionSchema }).strict(),
  z
    .object({
      kind: z.literal('reviewed_unattributed'),
      club: z.null(),
      reasonCode: z.enum(['source_does_not_define_club', 'multi_club_season']),
      decision: immutableSeasonClubScopeDecisionSchema,
    })
    .strict(),
]);

export const aflTradeProviderAppearanceCandidateContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_APPEARANCE_CANDIDATE_SCHEMA_VERSION),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    provider: publicIdSchema,
    capabilityId: publicIdSchema,
    competition: z.enum(['AFLM', 'AFLW']),
    seasonYear: seasonSchema,
    captureId: publicIdSchema,
    normalizationRunId: aflTradeContentAddressedIdSchema('provider-normalization-run'),
    normalizationFinalization: immutableNormalizationFinalizationSchema,
    normalizationFinalizedAt: utcInstantSchema,
    stagingSha256: aflTradeSha256Schema,
    providerDecodedRowId: publicIdSchema,
    sourceRowNumber: z.number().int().positive(),
    sourceRowSha256: aflTradeSha256Schema,
    semanticNaturalKeySha256: aflTradeSha256Schema,
    fieldMapSha256: aflTradeSha256Schema,
    identityCandidateId: publicIdSchema,
    identityCandidateSha256: aflTradeSha256Schema,
    matchCandidateId: publicIdSchema,
    matchCandidateSha256: aflTradeSha256Schema,
    appearanceState: z.literal('observed'),
    sourceFields: uniqueSortedSchema(sourceFieldSchema, 'Appearance source fields').min(1),
    derivationPolicy: immutableAppearancePolicySchema,
  })
  .strict();

export const aflTradeProviderAppearanceCandidateSchema = z
  .object({
    candidateId: aflTradeContentAddressedIdSchema('provider-appearance-candidate'),
    candidateSha256: aflTradeSha256Schema,
    content: aflTradeProviderAppearanceCandidateContentSchema,
  })
  .strict()
  .superRefine((candidate, context) => {
    addAflTradeContentAddressIssue(
      'provider-appearance-candidate',
      candidate.candidateId,
      candidate.content,
      context,
      ['candidateId']
    );
    if (candidate.candidateId !== `provider-appearance-candidate:${candidate.candidateSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['candidateSha256'],
        message: 'Appearance candidate digest must equal its content-address suffix.',
      });
    }
    const expectedFinalizationId = createAflTradeContentAddress(
      'provider-normalization-finalization',
      {
        normalizationRunId: candidate.content.normalizationRunId,
        stagingSha256: candidate.content.stagingSha256,
        finalizedAt: candidate.content.normalizationFinalizedAt,
      }
    );
    if (candidate.content.normalizationFinalization.id !== expectedFinalizationId) {
      context.addIssue({
        code: 'custom',
        path: ['content', 'normalizationFinalization'],
        message: 'Appearance candidate must bind one exact finalized staging package.',
      });
    }
  });

const factBase = {
  schemaVersion: z.literal(AFL_TRADE_SOURCE_FACT_SCHEMA_VERSION),
  publicAssetBoundary: z.literal(AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY),
  authorityBoundary: z.literal(AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY),
  publicationEligible: z.literal(false),
  environment: z.enum(['test_fixture', 'non_production', 'production']),
  provider: publicIdSchema,
  capabilityId: publicIdSchema,
  competition: z.enum(['AFLM', 'AFLW']),
  seasonYear: seasonSchema,
  fieldMapSha256: aflTradeSha256Schema,
  effectiveAt: utcInstantSchema,
  recordedAt: utcInstantSchema,
  source: sourceEvidenceSchema,
};

const matchUniverseFactSchema = z
  .object({
    ...factBase,
    factKind: z.literal('match_universe'),
    matchCandidateId: publicIdSchema,
    match: matchResolutionSchema,
    completionPolicy: immutableMatchUniversePolicySchema,
    completion: z.discriminatedUnion('state', [
      z
        .object({ state: z.literal('completed'), providerStatus: boundedTextSchema.nullable() })
        .strict(),
      z
        .object({
          state: z.literal('not_completed'),
          providerStatus: boundedTextSchema,
          reasonCode: z.enum(['scheduled', 'cancelled', 'abandoned']),
        })
        .strict(),
      z
        .object({
          state: z.literal('quarantined'),
          providerStatus: boundedTextSchema.nullable(),
          reasonCode: z.enum(['status_missing', 'status_unmapped', 'fixture_conflict']),
        })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((fact, context) => {
    if (fact.match.matchCandidateId !== fact.matchCandidateId) {
      context.addIssue({
        code: 'custom',
        path: ['matchCandidateId'],
        message: 'Match-universe evidence must use the exact resolved match candidate.',
      });
    }
  });

const playerMatchBase = {
  player: playerResolutionSchema,
  representedClub: clubResolutionSchema,
  match: matchResolutionSchema,
};

function addPlayerMatchClubIssue(
  fact: {
    seasonYear: number;
    player: z.infer<typeof playerResolutionSchema>;
    representedClub: z.infer<typeof clubResolutionSchema>;
    match: z.infer<typeof matchResolutionSchema>;
  },
  context: z.RefinementCtx
) {
  if (
    fact.representedClub.occurrence.source !== 'player_affiliation' ||
    fact.representedClub.occurrence.identityCandidateId !== fact.player.identityCandidateId
  ) {
    context.addIssue({
      code: 'custom',
      path: ['representedClub', 'occurrence'],
      message: 'The represented club must resolve the exact player-affiliation occurrence.',
    });
  }
  if (
    fact.representedClub.mappingScope === 'temporal_alias' &&
    (fact.seasonYear < fact.representedClub.validFromSeason ||
      fact.seasonYear > fact.representedClub.validThroughSeason)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['representedClub', 'validThroughSeason'],
      message: 'The represented-club alias must be valid for the exact fact season.',
    });
  }
  const matchSide =
    fact.match.homeClub.clubId === fact.representedClub.clubId
      ? fact.match.homeClub
      : fact.match.awayClub.clubId === fact.representedClub.clubId
        ? fact.match.awayClub
        : null;
  if (matchSide === null) {
    context.addIssue({
      code: 'custom',
      path: ['representedClub', 'clubId'],
      message: 'The player club must be one of the exact resolved match sides.',
    });
  }
}

function addAppearanceCandidateIssue(
  fact: {
    environment: 'test_fixture' | 'non_production' | 'production';
    provider: string;
    capabilityId: string;
    competition: 'AFLM' | 'AFLW';
    seasonYear: number;
    fieldMapSha256: string;
    source: z.infer<typeof sourceEvidenceSchema>;
    player: z.infer<typeof playerResolutionSchema>;
    match: z.infer<typeof matchResolutionSchema>;
    appearanceCandidate: z.infer<typeof aflTradeProviderAppearanceCandidateSchema>;
  },
  context: z.RefinementCtx
) {
  const candidate = fact.appearanceCandidate;
  const content = candidate.content;
  const sameSourceFields =
    content.sourceFields.length === fact.source.consumedSourceFields.length &&
    content.sourceFields.every(
      (sourceField, index) => sourceField === fact.source.consumedSourceFields[index]
    );
  if (
    candidate.candidateSha256 !== fact.source.candidateDigests.appearance ||
    content.identityCandidateSha256 !== fact.source.candidateDigests.identity ||
    content.matchCandidateSha256 !== fact.source.candidateDigests.match ||
    content.environment !== fact.environment ||
    content.provider !== fact.provider ||
    content.capabilityId !== fact.capabilityId ||
    content.competition !== fact.competition ||
    content.seasonYear !== fact.seasonYear ||
    content.captureId !== fact.source.captureId ||
    content.normalizationRunId !== fact.source.normalizationRunId ||
    content.normalizationFinalization.id !== fact.source.normalizationFinalization.id ||
    content.normalizationFinalization.sha256 !== fact.source.normalizationFinalization.sha256 ||
    content.normalizationFinalizedAt !== fact.source.normalizationFinalizedAt ||
    content.stagingSha256 !== fact.source.stagingSha256 ||
    content.providerDecodedRowId !== fact.source.providerDecodedRowId ||
    content.sourceRowNumber !== fact.source.sourceRowNumber ||
    content.sourceRowSha256 !== fact.source.sourceRowSha256 ||
    content.semanticNaturalKeySha256 !== fact.source.semanticNaturalKeySha256 ||
    content.fieldMapSha256 !== fact.fieldMapSha256 ||
    content.identityCandidateId !== fact.player.identityCandidateId ||
    content.matchCandidateId !== fact.match.matchCandidateId ||
    !sameSourceFields
  ) {
    context.addIssue({
      code: 'custom',
      path: ['appearanceCandidate'],
      message:
        'Appearance evidence must match the exact authenticated run, row, candidates, field map, and source fields.',
    });
  }
}

const playerAppearanceFactSchema = z
  .object({
    ...factBase,
    ...playerMatchBase,
    factKind: z.literal('player_appearance'),
    appearanceCandidate: aflTradeProviderAppearanceCandidateSchema,
    appearanceState: z.literal('observed'),
  })
  .strict()
  .superRefine((fact, context) => {
    addPlayerMatchClubIssue(fact, context);
    addAppearanceCandidateIssue(fact, context);
  });

const metricAvailabilitySchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('measured'),
      numericValue: nonNegativeIntegerTextSchema,
      reasonCode: z.null(),
    })
    .strict(),
  z
    .object({
      state: z.literal('missing'),
      numericValue: z.null(),
      reasonCode: z.literal('provider_value_missing'),
    })
    .strict(),
  z
    .object({
      state: z.literal('quarantined'),
      numericValue: z.null(),
      reasonCode: z.enum([
        'provider_zero_semantics_unverified',
        'invalid_numeric_value',
        'invalid_nan',
        'invalid_positive_infinity',
        'invalid_negative_infinity',
        'invalid_logical',
        'invalid_text',
        'invalid_date',
        'invalid_datetime',
        'invalid_factor',
      ]),
    })
    .strict(),
  z
    .object({
      state: z.literal('not_applicable'),
      numericValue: z.null(),
      reasonCode: z.literal('field_not_applicable'),
    })
    .strict(),
]);

const metricBase = {
  metricCode: z.enum(['goals', 'brownlow_votes', 'coaches_votes']),
  definitionVersion: definitionVersionSchema,
  definition: immutableMetricDefinitionSchema,
  unit: z.string().trim().min(1).max(80),
  availability: metricAvailabilitySchema,
};

const playerMatchMetricFactSchema = z
  .object({
    ...factBase,
    ...playerMatchBase,
    ...metricBase,
    factKind: z.literal('player_match_metric'),
    appearanceFactId: aflTradeContentAddressedIdSchema('source-fact'),
  })
  .strict()
  .superRefine((fact, context) => {
    addPlayerMatchClubIssue(fact, context);
  });

const playerSeasonMetricFactSchema = z
  .object({
    ...factBase,
    ...metricBase,
    factKind: z.literal('player_season_metric'),
    player: playerResolutionSchema,
    seasonClubScope: seasonClubScopeSchema,
  })
  .strict()
  .superRefine((fact, context) => {
    if (fact.seasonClubScope.kind !== 'resolved_single_club') return;
    const { club } = fact.seasonClubScope;
    if (
      club.occurrence.source !== 'player_affiliation' ||
      club.occurrence.identityCandidateId !== fact.player.identityCandidateId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['seasonClubScope', 'club', 'occurrence'],
        message: 'Season club custody must resolve the exact player-affiliation occurrence.',
      });
    }
    if (
      club.mappingScope === 'temporal_alias' &&
      (fact.seasonYear < club.validFromSeason || fact.seasonYear > club.validThroughSeason)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['seasonClubScope', 'club', 'validThroughSeason'],
        message: 'Season club alias evidence must cover the exact fact season.',
      });
    }
  });

const achievementAvailabilitySchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('affirmed'),
      evidenceValue: boundedTextSchema,
      reasonCode: z.null(),
    })
    .strict(),
  z
    .object({
      state: z.literal('missing'),
      evidenceValue: z.null(),
      reasonCode: z.literal('provider_value_missing'),
    })
    .strict(),
  z
    .object({
      state: z.literal('quarantined'),
      evidenceValue: z.null(),
      reasonCode: z.enum(['award_semantics_unverified', 'player_scope_unresolved']),
    })
    .strict(),
  z
    .object({
      state: z.literal('not_applicable'),
      evidenceValue: z.null(),
      reasonCode: z.literal('field_not_applicable'),
    })
    .strict(),
]);

const playerAchievementFactSchema = z
  .object({
    ...factBase,
    factKind: z.literal('player_achievement'),
    achievementCandidateId: publicIdSchema,
    achievementCode: z.enum([
      'all_australian_team',
      'all_australian_squad',
      'rising_star_nomination',
      'rising_star_winner',
    ]),
    achievementDefinition: immutableAchievementDefinitionSchema,
    achievementGrain: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('season') }).strict(),
      z.object({ kind: z.literal('round'), roundLabel: boundedTextSchema }).strict(),
    ]),
    player: playerResolutionSchema,
    seasonClubScope: seasonClubScopeSchema,
    availability: achievementAvailabilitySchema,
  })
  .strict()
  .superRefine((fact, context) => {
    const requiresRound = fact.achievementCode === 'rising_star_nomination';
    if (requiresRound !== (fact.achievementGrain.kind === 'round')) {
      context.addIssue({
        code: 'custom',
        path: ['achievementGrain'],
        message:
          'Only Rising Star nominations use round grain; other achievements use season grain.',
      });
    }
    if (fact.seasonClubScope.kind === 'resolved_single_club') {
      const { club } = fact.seasonClubScope;
      if (
        club.occurrence.source !== 'player_affiliation' ||
        club.occurrence.identityCandidateId !== fact.player.identityCandidateId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['seasonClubScope', 'club', 'occurrence'],
          message: 'Achievement club custody must resolve the exact player-affiliation occurrence.',
        });
      }
      if (
        club.mappingScope === 'temporal_alias' &&
        (fact.seasonYear < club.validFromSeason || fact.seasonYear > club.validThroughSeason)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['seasonClubScope', 'club', 'validThroughSeason'],
          message: 'Achievement club alias evidence must cover the exact fact season.',
        });
      }
    }
  });

export const aflTradeSourceFactContentSchema = z
  .discriminatedUnion('factKind', [
    matchUniverseFactSchema,
    playerAppearanceFactSchema,
    playerMatchMetricFactSchema,
    playerSeasonMetricFactSchema,
    playerAchievementFactSchema,
  ])
  .superRefine((fact, context) => {
    if (Date.parse(fact.effectiveAt) > Date.parse(fact.recordedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveAt'],
        message: 'Source-fact effective time cannot follow its knowledge time.',
      });
    }
    if (Date.parse(fact.source.normalizationFinalizedAt) > Date.parse(fact.recordedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['recordedAt'],
        message: 'Fact knowledge time cannot precede its normalization finalization.',
      });
    }
    const expectedFinalizationId = createAflTradeContentAddress(
      'provider-normalization-finalization',
      {
        normalizationRunId: fact.source.normalizationRunId,
        stagingSha256: fact.source.stagingSha256,
        finalizedAt: fact.source.normalizationFinalizedAt,
      }
    );
    if (fact.source.normalizationFinalization.id !== expectedFinalizationId) {
      context.addIssue({
        code: 'custom',
        path: ['source', 'normalizationFinalization'],
        message: 'Source evidence must bind the exact finalized normalization staging digest.',
      });
    }
    const requiredCandidateDigests: Record<
      typeof fact.factKind,
      ReadonlySet<keyof z.infer<typeof candidateDigestsSchema>>
    > = {
      match_universe: new Set(['match']),
      player_appearance: new Set(['identity', 'match', 'appearance']),
      player_match_metric: new Set(['identity', 'match', 'metric']),
      player_season_metric: new Set(['identity', 'metric']),
      player_achievement: new Set(['identity', 'achievement']),
    };
    const required = requiredCandidateDigests[fact.factKind];
    for (const [candidateKind, candidateSha256] of Object.entries(fact.source.candidateDigests) as [
      keyof z.infer<typeof candidateDigestsSchema>,
      string | null,
    ][]) {
      if (required.has(candidateKind) !== (candidateSha256 !== null)) {
        context.addIssue({
          code: 'custom',
          path: ['source', 'candidateDigests', candidateKind],
          message: `The ${fact.factKind} fact must bind only its exact required candidate digests.`,
        });
      }
    }
  });

export const aflTradeSourceFactSchema = z
  .object({
    factId: aflTradeContentAddressedIdSchema('source-fact'),
    factSha256: aflTradeSha256Schema,
    content: aflTradeSourceFactContentSchema,
  })
  .strict()
  .superRefine((fact, context) => {
    addAflTradeContentAddressIssue('source-fact', fact.factId, fact.content, context, ['factId']);
    if (fact.factId !== `source-fact:${fact.factSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['factSha256'],
        message: 'Source-fact digest must equal its content-address suffix.',
      });
    }
  });

const rowAccountingSchema = z
  .object({
    providerDecodedRowId: publicIdSchema,
    sourceRowSha256: aflTradeSha256Schema,
    disposition: z.enum([
      'normalized',
      'unresolved',
      'conflicting',
      'quarantined',
      'not_applicable',
      'rejected',
    ]),
    factIds: uniqueSortedSchema(aflTradeContentAddressedIdSchema('source-fact'), 'Row fact IDs'),
    issueSet: immutableIssueSetSchema,
    issueIds: uniqueSortedSchema(publicIdSchema, 'Row issue IDs'),
    blockingIssueIds: uniqueSortedSchema(publicIdSchema, 'Row blocking issue IDs'),
    blockingIssueClosures: z.array(issueClosureSchema).max(1000),
    reasonCode: publicIdSchema.nullable(),
  })
  .strict()
  .superRefine((row, context) => {
    if (row.disposition === 'normalized') {
      if (row.factIds.length === 0 || row.reasonCode !== null) {
        context.addIssue({
          code: 'custom',
          message: 'A normalized row requires at least one fact and no exclusion reason.',
        });
      }
    } else if (row.factIds.length !== 0 || row.reasonCode === null) {
      context.addIssue({
        code: 'custom',
        message: 'A non-normalized row cannot reference facts and requires a bounded reason.',
      });
    }
    if (
      ['unresolved', 'conflicting', 'quarantined', 'rejected'].includes(row.disposition) &&
      row.issueIds.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['issueIds'],
        message: 'Review, conflict, quarantine, and rejection dispositions require evidence.',
      });
    }
    const issueIdSet = new Set(row.issueIds);
    if (row.blockingIssueIds.some((issueId) => !issueIdSet.has(issueId))) {
      context.addIssue({
        code: 'custom',
        path: ['blockingIssueIds'],
        message: 'Every blocking issue must belong to the exact row issue set.',
      });
    }
    if (
      row.blockingIssueIds.length !== row.issueIds.length ||
      row.blockingIssueIds.some((issueId, index) => row.issueIds[index] !== issueId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['blockingIssueIds'],
        message:
          'Every normalization issue is blocking in v1 until source staging authenticates issue severity.',
      });
    }
    const blockingIssueIdSet = new Set(row.blockingIssueIds);
    const closureIssueIds = row.blockingIssueClosures.map(({ issueId }) => issueId);
    const closureDecisionIds = row.blockingIssueClosures.map(({ decision }) => decision.id);
    if (
      new Set(closureIssueIds).size !== closureIssueIds.length ||
      new Set(closureDecisionIds).size !== closureDecisionIds.length ||
      closureIssueIds.some(
        (issueId, index) => index > 0 && closureIssueIds[index - 1]! > issueId
      ) ||
      closureIssueIds.some((issueId) => !blockingIssueIdSet.has(issueId))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['blockingIssueClosures'],
        message:
          'Row closure evidence must be unique, sorted, and belong to the exact blocking issue set.',
      });
    }
    if (
      row.disposition === 'normalized' &&
      row.blockingIssueClosures.length !== row.blockingIssueIds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['blockingIssueClosures'],
        message: 'A normalized row requires an exact closure decision for every blocking issue.',
      });
    }
  });

export const aflTradeSourceFactBatchContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_SOURCE_FACT_BATCH_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY),
    authorityBoundary: z.literal(AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    provider: publicIdSchema,
    capabilityId: publicIdSchema,
    competition: z.enum(['AFLM', 'AFLW']),
    seasonYear: seasonSchema,
    captureId: publicIdSchema,
    normalizationRunId: aflTradeContentAddressedIdSchema('provider-normalization-run'),
    normalizationFinalization: immutableNormalizationFinalizationSchema,
    normalizationFinalizedAt: utcInstantSchema,
    fieldMapSha256: aflTradeSha256Schema,
    stagingSha256: aflTradeSha256Schema,
    sourceRowSetSha256: aflTradeSha256Schema,
    sourceIssueSetSha256: aflTradeSha256Schema,
    createdAt: utcInstantSchema,
    sourceRowCount: z.number().int().nonnegative(),
    sourceIssueCount: z.number().int().nonnegative(),
    facts: z.array(aflTradeSourceFactSchema).max(1_000_000),
    rowAccounting: z.array(rowAccountingSchema).max(1_000_000),
    counts: z
      .object({
        matchUniverse: z.number().int().nonnegative(),
        playerAppearances: z.number().int().nonnegative(),
        playerMatchMetrics: z.number().int().nonnegative(),
        playerSeasonMetrics: z.number().int().nonnegative(),
        playerAchievements: z.number().int().nonnegative(),
        normalizedRows: z.number().int().nonnegative(),
        nonNormalizedRows: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((batch, context) => {
    const factIds = batch.facts.map(({ factId }) => factId);
    const rowIds = batch.rowAccounting.map(({ providerDecodedRowId }) => providerDecodedRowId);
    const rowIdSet = new Set(rowIds);
    if (
      new Set(factIds).size !== factIds.length ||
      factIds.some((factId, index) => index > 0 && batch.facts[index - 1]!.factId > factId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['facts'],
        message: 'Source facts must be unique and sorted by content address.',
      });
    }
    if (
      new Set(rowIds).size !== rowIds.length ||
      rowIds.some((rowId, index) => index > 0 && rowIds[index - 1]! > rowId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rowAccounting'],
        message: 'Every decoded row must be accounted for exactly once in canonical order.',
      });
    }
    if (batch.sourceRowCount !== batch.rowAccounting.length) {
      context.addIssue({
        code: 'custom',
        path: ['sourceRowCount'],
        message: 'Source row count must equal the exhaustive row-accounting ledger.',
      });
    }
    if (Date.parse(batch.normalizationFinalizedAt) > Date.parse(batch.createdAt)) {
      context.addIssue({
        code: 'custom',
        path: ['createdAt'],
        message: 'Fact-batch creation cannot precede normalization finalization.',
      });
    }
    const expectedRowSetSha256 = sha256AflTradeCanonicalJson(
      batch.rowAccounting.map(({ providerDecodedRowId, sourceRowSha256 }) => ({
        providerDecodedRowId,
        sourceRowSha256,
      }))
    );
    if (batch.sourceRowSetSha256 !== expectedRowSetSha256) {
      context.addIssue({
        code: 'custom',
        path: ['sourceRowSetSha256'],
        message: 'Source-row-set digest must bind the exhaustive ordered decoded-row ledger.',
      });
    }
    const expectedFinalizationId = createAflTradeContentAddress(
      'provider-normalization-finalization',
      {
        normalizationRunId: batch.normalizationRunId,
        stagingSha256: batch.stagingSha256,
        finalizedAt: batch.normalizationFinalizedAt,
      }
    );
    if (batch.normalizationFinalization.id !== expectedFinalizationId) {
      context.addIssue({
        code: 'custom',
        path: ['normalizationFinalization'],
        message: 'Fact batches require the exact immutable normalization-finalization evidence.',
      });
    }
    const accountedIssueIds = batch.rowAccounting.flatMap(({ issueIds }) => issueIds);
    if (
      new Set(accountedIssueIds).size !== accountedIssueIds.length ||
      batch.sourceIssueCount !== accountedIssueIds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceIssueCount'],
        message: 'Every finalized normalization issue must be accounted for exactly once.',
      });
    }
    const expectedIssueSetSha256 = sha256AflTradeCanonicalJson(
      batch.rowAccounting.map(
        ({
          providerDecodedRowId,
          issueSet,
          issueIds,
          blockingIssueIds,
          blockingIssueClosures,
        }) => ({
          providerDecodedRowId,
          issueSet,
          issueIds,
          blockingIssueIds,
          blockingIssueClosures,
        })
      )
    );
    if (batch.sourceIssueSetSha256 !== expectedIssueSetSha256) {
      context.addIssue({
        code: 'custom',
        path: ['sourceIssueSetSha256'],
        message: 'Source-issue-set digest must bind every ordered row issue set exactly once.',
      });
    }

    type IndexedRowFacts = {
      factIds: string[];
      sourceRowSha256s: Set<string>;
      issueSetKeys: Set<string>;
      blockingIssueCounts: Set<number>;
      openBlockingIssueCounts: Set<number>;
      closureSetSha256s: Set<string>;
    };
    const factsByRow = new Map<string, IndexedRowFacts>();
    const factsById = new Map(batch.facts.map((fact) => [fact.factId, fact]));
    for (const fact of batch.facts) {
      const { content } = fact;
      if (
        content.environment !== batch.environment ||
        content.provider !== batch.provider ||
        content.capabilityId !== batch.capabilityId ||
        content.competition !== batch.competition ||
        content.seasonYear !== batch.seasonYear ||
        content.fieldMapSha256 !== batch.fieldMapSha256 ||
        content.source.captureId !== batch.captureId ||
        content.source.normalizationRunId !== batch.normalizationRunId ||
        content.source.normalizationFinalization.id !== batch.normalizationFinalization.id ||
        content.source.normalizationFinalization.sha256 !==
          batch.normalizationFinalization.sha256 ||
        content.source.normalizationFinalizedAt !== batch.normalizationFinalizedAt ||
        content.source.stagingSha256 !== batch.stagingSha256 ||
        Date.parse(content.recordedAt) > Date.parse(batch.createdAt)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['facts'],
          message: 'Every fact must bind the exact batch scope, finalized run, and chronology.',
        });
        break;
      }
      const existing = factsByRow.get(content.source.providerDecodedRowId) ?? {
        factIds: [],
        sourceRowSha256s: new Set<string>(),
        issueSetKeys: new Set<string>(),
        blockingIssueCounts: new Set<number>(),
        openBlockingIssueCounts: new Set<number>(),
        closureSetSha256s: new Set<string>(),
      };
      existing.factIds.push(fact.factId);
      existing.sourceRowSha256s.add(content.source.sourceRowSha256);
      existing.issueSetKeys.add(`${content.source.issueSet.id}:${content.source.issueSet.sha256}`);
      existing.blockingIssueCounts.add(content.source.blockingIssueCount);
      existing.openBlockingIssueCounts.add(content.source.openBlockingIssueCount);
      existing.closureSetSha256s.add(
        sha256AflTradeCanonicalJson(content.source.blockingIssueClosures)
      );
      factsByRow.set(content.source.providerDecodedRowId, existing);

      if (content.factKind === 'player_match_metric') {
        const appearance = factsById.get(content.appearanceFactId);
        if (
          appearance?.content.factKind !== 'player_appearance' ||
          appearance.content.source.providerDecodedRowId !== content.source.providerDecodedRowId ||
          appearance.content.source.candidateDigests.identity !==
            content.source.candidateDigests.identity ||
          appearance.content.source.candidateDigests.match !==
            content.source.candidateDigests.match ||
          sha256AflTradeCanonicalJson(appearance.content.player) !==
            sha256AflTradeCanonicalJson(content.player) ||
          sha256AflTradeCanonicalJson(appearance.content.match) !==
            sha256AflTradeCanonicalJson(content.match) ||
          sha256AflTradeCanonicalJson(appearance.content.representedClub) !==
            sha256AflTradeCanonicalJson(content.representedClub)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['facts'],
            message:
              'A match-grain metric must reference the exact appearance fact for the same row, player, match, and represented club.',
          });
          break;
        }
      }
    }

    for (const [index, row] of batch.rowAccounting.entries()) {
      const indexedFacts = factsByRow.get(row.providerDecodedRowId);
      const expected = [...(indexedFacts?.factIds ?? [])].sort();
      const expectedIssueSetKey = `${row.issueSet.id}:${row.issueSet.sha256}`;
      const expectedClosureSetSha256 = sha256AflTradeCanonicalJson(row.blockingIssueClosures);
      if (
        expected.length !== row.factIds.length ||
        expected.some((factId, factIndex) => row.factIds[factIndex] !== factId) ||
        (indexedFacts !== undefined &&
          (indexedFacts.sourceRowSha256s.size !== 1 ||
            !indexedFacts.sourceRowSha256s.has(row.sourceRowSha256) ||
            indexedFacts.issueSetKeys.size !== 1 ||
            !indexedFacts.issueSetKeys.has(expectedIssueSetKey) ||
            indexedFacts.blockingIssueCounts.size !== 1 ||
            !indexedFacts.blockingIssueCounts.has(row.blockingIssueIds.length) ||
            indexedFacts.openBlockingIssueCounts.size !== 1 ||
            !indexedFacts.openBlockingIssueCounts.has(0) ||
            indexedFacts.closureSetSha256s.size !== 1 ||
            !indexedFacts.closureSetSha256s.has(expectedClosureSetSha256)))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['rowAccounting', index],
          message: 'Row accounting must exactly match the facts and authenticated row digest.',
        });
      }
    }
    if ([...factsByRow.keys()].some((rowId) => !rowIdSet.has(rowId))) {
      context.addIssue({
        code: 'custom',
        path: ['facts'],
        message: 'Every fact must belong to one row in the exhaustive accounting ledger.',
      });
    }

    const actualCounts = {
      matchUniverse: batch.facts.filter(({ content }) => content.factKind === 'match_universe')
        .length,
      playerAppearances: batch.facts.filter(
        ({ content }) => content.factKind === 'player_appearance'
      ).length,
      playerMatchMetrics: batch.facts.filter(
        ({ content }) => content.factKind === 'player_match_metric'
      ).length,
      playerSeasonMetrics: batch.facts.filter(
        ({ content }) => content.factKind === 'player_season_metric'
      ).length,
      playerAchievements: batch.facts.filter(
        ({ content }) => content.factKind === 'player_achievement'
      ).length,
      normalizedRows: batch.rowAccounting.filter(({ disposition }) => disposition === 'normalized')
        .length,
      nonNormalizedRows: batch.rowAccounting.filter(
        ({ disposition }) => disposition !== 'normalized'
      ).length,
    };
    if (
      Object.entries(actualCounts).some(
        ([key, value]) => batch.counts[key as keyof typeof batch.counts] !== value
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['counts'],
        message: 'Batch counts must exactly reconcile facts and row dispositions.',
      });
    }
  });

export const aflTradeSourceFactBatchSchema = z
  .object({
    batchId: aflTradeContentAddressedIdSchema('source-fact-batch'),
    batchSha256: aflTradeSha256Schema,
    content: aflTradeSourceFactBatchContentSchema,
  })
  .strict()
  .superRefine((batch, context) => {
    addAflTradeContentAddressIssue('source-fact-batch', batch.batchId, batch.content, context, [
      'batchId',
    ]);
    if (batch.batchId !== `source-fact-batch:${batch.batchSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['batchSha256'],
        message: 'Source-fact batch digest must equal its content-address suffix.',
      });
    }
  });

export type AflTradeSourceFactContent = z.infer<typeof aflTradeSourceFactContentSchema>;
export type AflTradeSourceFact = z.infer<typeof aflTradeSourceFactSchema>;
export type AflTradeSourceFactBatchContent = z.infer<typeof aflTradeSourceFactBatchContentSchema>;
export type AflTradeSourceFactBatch = z.infer<typeof aflTradeSourceFactBatchSchema>;
export type AflTradeProviderAppearanceCandidateContent = z.infer<
  typeof aflTradeProviderAppearanceCandidateContentSchema
>;
export type AflTradeProviderAppearanceCandidate = z.infer<
  typeof aflTradeProviderAppearanceCandidateSchema
>;

export function createAflTradeProviderAppearanceCandidate(
  content: unknown
): AflTradeProviderAppearanceCandidate {
  const parsed = aflTradeProviderAppearanceCandidateContentSchema.parse(content);
  const candidateId = createAflTradeContentAddress('provider-appearance-candidate', parsed);
  return aflTradeProviderAppearanceCandidateSchema.parse({
    candidateId,
    candidateSha256: candidateId.slice('provider-appearance-candidate:'.length),
    content: parsed,
  });
}

export function createAflTradeSourceFact(content: unknown): AflTradeSourceFact {
  const parsed = aflTradeSourceFactContentSchema.parse(content);
  const factId = createAflTradeContentAddress('source-fact', parsed);
  return aflTradeSourceFactSchema.parse({
    factId,
    factSha256: factId.slice('source-fact:'.length),
    content: parsed,
  });
}

export function createAflTradeSourceFactBatch(content: unknown): AflTradeSourceFactBatch {
  const parsed = aflTradeSourceFactBatchContentSchema.parse(content);
  const batchId = createAflTradeContentAddress('source-fact-batch', parsed);
  return aflTradeSourceFactBatchSchema.parse({
    batchId,
    batchSha256: batchId.slice('source-fact-batch:'.length),
    content: parsed,
  });
}
