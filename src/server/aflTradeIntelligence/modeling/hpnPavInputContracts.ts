import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  listAflTradeHpnCandidateSourceFields,
  type AflTradeHpnSemanticBindingCandidate,
} from './hpnFieldMapCandidate';
import { listAflTradeHpnRequiredSemanticFields } from './hpnCalculationEligibility';
import {
  aflTradeHpnProjectedFieldMapSchema,
  type AflTradeHpnProjectedFieldMap,
} from './hpnProjectedFieldMap';

export const AFL_TRADE_HPN_PAV_FIELD_MAP_SCHEMA_VERSION = 'afl-trade-hpn-pav-field-map/v1' as const;
export const AFL_TRADE_HPN_PAV_INPUT_SET_SCHEMA_VERSION = 'afl-trade-hpn-pav-input-set/v1' as const;
export const AFL_TRADE_HPN_PAV_INPUT_SET_V2_SCHEMA_VERSION =
  'afl-trade-hpn-pav-input-set/v2' as const;
export const AFL_TRADE_HPN_PAV_INPUT_AUTHORITY_BOUNDARY =
  'private_exact_finalized_provider_rows_current_resolutions_no_publication_or_fantasy_ownership' as const;

const instantSchema = z.iso.datetime({ offset: true });
const dateSchema = z.iso.date();
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const fieldNameSchema = z.string().trim().min(1).max(200);
const seasonSchema = z.number().int().min(1998).max(2200);
const countSchema = z.number().int().nonnegative().max(10_000_000);
const sourceScalarSchema = z.union([
  z.string().max(10_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

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
          path: ['id'],
          message: `${prefix} identity must equal its exact content digest.`,
        });
      }
    });
}

const reviewDecisionSchema = immutableReferenceSchema('review-decision');
const resolutionDecisionSchema = immutableReferenceSchema('provider-resolution-decision');

const playerBindingsSchema = z
  .object({
    player: fieldNameSchema,
    match: fieldNameSchema,
    club: fieldNameSchema,
    totalPoints: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('total_points'), totalPoints: fieldNameSchema }).strict(),
      z
        .object({
          kind: z.literal('goals_plus_behinds'),
          goals: fieldNameSchema,
          behinds: fieldNameSchema,
        })
        .strict(),
    ]),
    hitOuts: fieldNameSchema,
    goalAssists: fieldNameSchema,
    inside50s: fieldNameSchema,
    marks: fieldNameSchema,
    marksInside50: fieldNameSchema,
    freeKicksFor: fieldNameSchema,
    freeKicksAgainst: fieldNameSchema,
    rebound50s: fieldNameSchema,
    onePercenters: fieldNameSchema,
    clearances: fieldNameSchema,
    tackles: fieldNameSchema,
  })
  .strict();

const resultBindingsSchema = z
  .object({
    match: fieldNameSchema,
    homeClub: fieldNameSchema,
    awayClub: fieldNameSchema,
    homePoints: fieldNameSchema,
    awayPoints: fieldNameSchema,
    completionStatus: fieldNameSchema,
    completedValues: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
  })
  .strict();

const fieldMapBase = {
  schemaVersion: z.literal(AFL_TRADE_HPN_PAV_FIELD_MAP_SCHEMA_VERSION),
  authorityBoundary: z.literal(AFL_TRADE_HPN_PAV_INPUT_AUTHORITY_BOUNDARY),
  publicationEligible: z.literal(false),
  environment: z.enum(['test_fixture', 'non_production', 'production']),
  competition: z.literal('AFLM'),
  provider: publicIdSchema,
  capabilityId: publicIdSchema,
  sourceSchemaSha256: aflTradeSha256Schema,
  validFromSeason: seasonSchema,
  validThroughSeason: seasonSchema,
  approvalDecision: reviewDecisionSchema,
};

const fieldMapContentSchema = z
  .discriminatedUnion('inputKind', [
    z
      .object({
        ...fieldMapBase,
        inputKind: z.literal('player_match_stats'),
        bindings: playerBindingsSchema,
      })
      .strict(),
    z
      .object({
        ...fieldMapBase,
        inputKind: z.literal('completed_match_result'),
        bindings: resultBindingsSchema,
      })
      .strict(),
  ])
  .superRefine((fieldMap, context) => {
    if (fieldMap.validThroughSeason < fieldMap.validFromSeason) {
      context.addIssue({
        code: 'custom',
        path: ['validThroughSeason'],
        message: 'PAV field-map season validity is inverted.',
      });
    }
    const fields = aflTradeHpnPavReviewedFields(fieldMap);
    if (new Set(fields).size !== fields.length) {
      context.addIssue({
        code: 'custom',
        path: ['bindings'],
        message: 'Each PAV semantic binding requires a distinct reviewed source field.',
      });
    }
  });

export const aflTradeHpnPavFieldMapSchema = z
  .object({
    fieldMapId: aflTradeContentAddressedIdSchema('hpn-pav-field-map'),
    content: fieldMapContentSchema,
  })
  .strict()
  .superRefine((fieldMap, context) => {
    addAflTradeContentAddressIssue(
      'hpn-pav-field-map',
      fieldMap.fieldMapId,
      fieldMap.content,
      context,
      ['fieldMapId']
    );
  });

const currentResolutionSchema = z
  .object({
    entityKind: z.enum(['player', 'club', 'match']),
    canonicalId: publicIdSchema,
    revision: z.number().int().positive(),
    status: z.literal('current_approved'),
    resolutionDecision: resolutionDecisionSchema,
    assignmentDecision: resolutionDecisionSchema,
  })
  .strict()
  .superRefine((resolution, context) => {
    if (
      resolution.assignmentDecision.id !== resolution.resolutionDecision.id ||
      resolution.assignmentDecision.sha256 !== resolution.resolutionDecision.sha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assignmentDecision'],
        message: 'The active assignment head must be governed by the current resolution decision.',
      });
    }
  });

const rowSourceSchema = z
  .object({
    normalizationRunId: aflTradeContentAddressedIdSchema('provider-normalization-run'),
    providerDecodedRowId: publicIdSchema,
    sourceRowSha256: aflTradeSha256Schema,
    typedPayloadSha256: aflTradeSha256Schema,
    sourceFields: z.array(fieldNameSchema).min(1).max(100),
    sourceValues: z.record(fieldNameSchema, sourceScalarSchema),
  })
  .strict()
  .superRefine((source, context) => {
    const keys = Object.keys(source.sourceValues).sort(ordinalCompare);
    if (
      new Set(source.sourceFields).size !== source.sourceFields.length ||
      source.sourceFields.some((field, index) => field !== keys[index]) ||
      source.sourceFields.length !== keys.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceFields'],
        message: 'Source fields must be the unique ordered keys of the exact staged values.',
      });
    }
  });

const pavStatsSchema = z
  .object({
    totalPoints: countSchema,
    hitOuts: countSchema,
    goalAssists: countSchema,
    inside50s: countSchema,
    marks: countSchema,
    marksInside50: countSchema,
    freeKicksFor: countSchema,
    freeKicksAgainst: countSchema,
    rebound50s: countSchema,
    onePercenters: countSchema,
    clearances: countSchema,
    tackles: countSchema,
  })
  .strict();

const resultRowSchema = z
  .object({
    kind: z.literal('completed_match_result'),
    source: rowSourceSchema,
    match: currentResolutionSchema,
    effectiveAt: instantSchema,
    homeClub: currentResolutionSchema,
    awayClub: currentResolutionSchema,
    homePoints: countSchema,
    awayPoints: countSchema,
    completionStatus: z.literal('completed'),
  })
  .strict();

const acquisitionSpellSchema = z
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
    endReason: z.string().trim().min(1).max(200).nullable(),
    ruleId: publicIdSchema,
    status: z.literal('approved'),
    supersedesSpellVersionId: aflTradeContentAddressedIdSchema(
      'acquisition-spell-version'
    ).nullable(),
    recordedAt: instantSchema,
  })
  .strict()
  .superRefine((spell, context) => {
    if (spell.endDate !== null && spell.endDate < spell.startDate) {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'An HPN PAV acquisition spell cannot end before it starts.',
      });
    }
  });

const playerRowSchema = z
  .object({
    kind: z.literal('player_match_stats'),
    role: z.enum(['primary', 'corroborating']),
    source: rowSourceSchema,
    match: currentResolutionSchema,
    player: currentResolutionSchema,
    club: currentResolutionSchema,
    acquisitionSpell: acquisitionSpellSchema,
    stats: pavStatsSchema,
  })
  .strict();

const inputRowSchema = z.discriminatedUnion('kind', [resultRowSchema, playerRowSchema]);

const sourceRunSchema = z
  .object({
    normalizationRunId: aflTradeContentAddressedIdSchema('provider-normalization-run'),
    captureId: publicIdSchema,
    sourceSnapshotId: aflTradeContentAddressedIdSchema('source-snapshot'),
    sourceArtifactId: aflTradeContentAddressedIdSchema('artifact'),
    provider: publicIdSchema,
    capabilityId: publicIdSchema,
    fieldMapId: aflTradeContentAddressedIdSchema('hpn-pav-field-map'),
    competition: z.literal('AFLM'),
    seasonYear: seasonSchema,
    stagingSha256: aflTradeSha256Schema,
    sourceRowCount: z.number().int().positive().max(1_000_000),
    acceptedRowCount: z.number().int().positive().max(1_000_000),
    issueCount: z.literal(0),
    status: z.literal('staged'),
    capturedAt: instantSchema,
    finalizedAt: instantSchema,
  })
  .strict()
  .superRefine((run, context) => {
    if (
      run.sourceRowCount !== run.acceptedRowCount ||
      Date.parse(run.capturedAt) > Date.parse(run.finalizedAt)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A PAV source run must be clean, exhaustive, and finalized after capture.',
      });
    }
  });

const completedMatchSchema = z
  .object({
    matchId: publicIdSchema,
    effectiveAt: instantSchema,
    homeClubId: publicIdSchema,
    awayClubId: publicIdSchema,
  })
  .strict()
  .superRefine((match, context) => {
    if (match.homeClubId === match.awayClubId) {
      context.addIssue({ code: 'custom', message: 'A completed match requires distinct clubs.' });
    }
  });

const factualCompletedMatchSchema = completedMatchSchema.extend({
  factIds: z.array(aflTradeContentAddressedIdSchema('source-fact')).min(1).max(100),
});

const factualPlayerAppearanceSchema = z
  .object({
    factIds: z.array(aflTradeContentAddressedIdSchema('source-fact')).min(1).max(100),
    matchId: publicIdSchema,
    playerId: publicIdSchema,
    clubId: publicIdSchema,
  })
  .strict();

const factualUniverseSchema = z
  .object({
    factualRunId: aflTradeContentAddressedIdSchema('factual-reconciliation-run'),
    policyId: aflTradeContentAddressedIdSchema('factual-reconciliation-policy'),
    inputSetSha256: aflTradeSha256Schema,
    status: z.literal('approved'),
    finalizedAt: instantSchema,
    completedMatchFacts: z.array(factualCompletedMatchSchema).min(1).max(1_000),
    playerAppearanceFacts: z.array(factualPlayerAppearanceSchema).min(1).max(100_000),
  })
  .strict()
  .superRefine((universe, context) => {
    const matchKeys = universe.completedMatchFacts.map(({ matchId }) => matchId);
    const appearanceKeys = universe.playerAppearanceFacts.map(
      ({ matchId, clubId, playerId }) => `${matchId}\u0000${clubId}\u0000${playerId}`
    );
    const factIds = [
      ...universe.completedMatchFacts.flatMap(({ factIds: ids }) => ids),
      ...universe.playerAppearanceFacts.flatMap(({ factIds: ids }) => ids),
    ];
    if (
      new Set(matchKeys).size !== matchKeys.length ||
      new Set(appearanceKeys).size !== appearanceKeys.length ||
      new Set(factIds).size !== factIds.length ||
      universe.completedMatchFacts.some(
        ({ factIds: ids }) => new Set(ids).size !== ids.length || !isOrdered(ids)
      ) ||
      universe.playerAppearanceFacts.some(
        ({ factIds: ids }) => new Set(ids).size !== ids.length || !isOrdered(ids)
      ) ||
      matchKeys.some((key, index) => index > 0 && matchKeys[index - 1]! > key) ||
      appearanceKeys.some((key, index) => index > 0 && appearanceKeys[index - 1]! > key)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'The factual universe must contain unique, canonically ordered match, appearance, and fact membership.',
      });
    }
    const matchIds = new Set(matchKeys);
    if (universe.playerAppearanceFacts.some(({ matchId }) => !matchIds.has(matchId))) {
      context.addIssue({
        code: 'custom',
        path: ['playerAppearanceFacts'],
        message: 'Every factual appearance must belong to the completed-match universe.',
      });
    }
  });

function isOrdered(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}

const inputSetCountsSchema = z
  .object({
    completedMatches: z.number().int().positive(),
    resultRows: z.number().int().positive(),
    primaryPlayerRows: z.number().int().positive(),
    corroboratingPlayerRows: z.number().int().positive(),
  })
  .strict();

const inputSetBase = {
  authorityBoundary: z.literal(AFL_TRADE_HPN_PAV_INPUT_AUTHORITY_BOUNDARY),
  publicationEligible: z.literal(false),
  competition: z.literal('AFLM'),
  seasonYear: seasonSchema,
  effectiveThrough: instantSchema,
  createdAt: instantSchema,
  methodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
  factualUniverse: factualUniverseSchema,
  sourceRuns: z.array(sourceRunSchema).min(3).max(100),
  completedMatches: z.array(completedMatchSchema).min(1).max(1_000),
  rows: z.array(inputRowSchema).min(3).max(100_000),
  counts: inputSetCountsSchema,
};

const legacyInputSetContentSchema = z
  .object({
    ...inputSetBase,
    schemaVersion: z.literal(AFL_TRADE_HPN_PAV_INPUT_SET_SCHEMA_VERSION),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    fieldMaps: z.array(aflTradeHpnPavFieldMapSchema).min(3).max(100),
  })
  .strict()
  .superRefine(addInputSetIssues);

const projectedInputSetContentSchema = z
  .object({
    ...inputSetBase,
    schemaVersion: z.literal(AFL_TRADE_HPN_PAV_INPUT_SET_V2_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    fieldMaps: z.array(aflTradeHpnProjectedFieldMapSchema).min(3).max(100),
  })
  .strict()
  .superRefine(addInputSetIssues);

const inputSetContentSchema = z.union([
  legacyInputSetContentSchema,
  projectedInputSetContentSchema,
]);

export const aflTradeHpnPavSeasonInputSetSchema = z
  .object({
    inputSetId: aflTradeContentAddressedIdSchema('hpn-pav-input-set'),
    content: inputSetContentSchema,
  })
  .strict()
  .superRefine((inputSet, context) => {
    addAflTradeContentAddressIssue(
      'hpn-pav-input-set',
      inputSet.inputSetId,
      inputSet.content,
      context,
      ['inputSetId']
    );
  });

export type AflTradeHpnPavFieldMap = z.infer<typeof aflTradeHpnPavFieldMapSchema>;
export type AflTradeHpnPavInputFieldMap =
  | AflTradeHpnPavFieldMap
  | AflTradeHpnProjectedFieldMap;
export type AflTradeHpnPavSeasonInputSet = z.infer<typeof aflTradeHpnPavSeasonInputSetSchema>;

export function aflTradeHpnPavReviewedFields(
  fieldMap: z.infer<typeof fieldMapContentSchema>
): string[] {
  if (fieldMap.inputKind === 'completed_match_result') {
    return [
      fieldMap.bindings.match,
      fieldMap.bindings.homeClub,
      fieldMap.bindings.awayClub,
      fieldMap.bindings.homePoints,
      fieldMap.bindings.awayPoints,
      fieldMap.bindings.completionStatus,
    ].sort(ordinalCompare);
  }
  const bindings = fieldMap.bindings;
  const values = [
    bindings.player,
    bindings.match,
    bindings.club,
    ...(bindings.totalPoints.kind === 'total_points'
      ? [bindings.totalPoints.totalPoints]
      : [bindings.totalPoints.goals, bindings.totalPoints.behinds]),
    bindings.hitOuts,
    bindings.goalAssists,
    bindings.inside50s,
    bindings.marks,
    bindings.marksInside50,
    bindings.freeKicksFor,
    bindings.freeKicksAgainst,
    bindings.rebound50s,
    bindings.onePercenters,
    bindings.clearances,
    bindings.tackles,
  ];
  return values.sort(ordinalCompare);
}

function sourceNumber(row: z.infer<typeof playerRowSchema>, field: string): number {
  const value = row.source.sourceValues[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return Number.NaN;
  return value;
}

function projectedBinding(
  fieldMap: AflTradeHpnProjectedFieldMap['content'],
  semanticField: AflTradeHpnSemanticBindingCandidate['semanticField']
): AflTradeHpnSemanticBindingCandidate['mapping'] | undefined {
  return fieldMap.semanticBindings.find(
    (binding) => binding.semanticField === semanticField
  )?.mapping;
}

function projectedSourceNumber(
  row: z.infer<typeof playerRowSchema>,
  fieldMap: AflTradeHpnProjectedFieldMap['content'],
  semanticField: AflTradeHpnSemanticBindingCandidate['semanticField']
): number {
  const mapping = projectedBinding(fieldMap, semanticField);
  if (mapping?.kind === 'direct') return sourceNumber(row, mapping.sourceField);
  if (mapping?.kind === 'goals_plus_behinds') {
    return sourceNumber(row, mapping.goals) * 6 + sourceNumber(row, mapping.behinds);
  }
  return Number.NaN;
}

function statsFromSource(
  row: z.infer<typeof playerRowSchema>,
  fieldMap:
    | Extract<z.infer<typeof fieldMapContentSchema>, { inputKind: 'player_match_stats' }>
    | AflTradeHpnProjectedFieldMap['content']
) {
  if (fieldMap.schemaVersion === 'afl-trade-hpn-projected-field-map/v1') {
    return {
      totalPoints: projectedSourceNumber(row, fieldMap, 'totalPoints'),
      hitOuts: projectedSourceNumber(row, fieldMap, 'hitOuts'),
      goalAssists: projectedSourceNumber(row, fieldMap, 'goalAssists'),
      inside50s: projectedSourceNumber(row, fieldMap, 'inside50s'),
      marks: projectedSourceNumber(row, fieldMap, 'marks'),
      marksInside50: projectedSourceNumber(row, fieldMap, 'marksInside50'),
      freeKicksFor: projectedSourceNumber(row, fieldMap, 'freeKicksFor'),
      freeKicksAgainst: projectedSourceNumber(row, fieldMap, 'freeKicksAgainst'),
      rebound50s: projectedSourceNumber(row, fieldMap, 'rebound50s'),
      onePercenters: projectedSourceNumber(row, fieldMap, 'onePercenters'),
      clearances: projectedSourceNumber(row, fieldMap, 'clearances'),
      tackles: projectedSourceNumber(row, fieldMap, 'tackles'),
    };
  }
  const bindings = fieldMap.bindings;
  const totalPoints =
    bindings.totalPoints.kind === 'total_points'
      ? sourceNumber(row, bindings.totalPoints.totalPoints)
      : sourceNumber(row, bindings.totalPoints.goals) * 6 +
        sourceNumber(row, bindings.totalPoints.behinds);
  return {
    totalPoints,
    hitOuts: sourceNumber(row, bindings.hitOuts),
    goalAssists: sourceNumber(row, bindings.goalAssists),
    inside50s: sourceNumber(row, bindings.inside50s),
    marks: sourceNumber(row, bindings.marks),
    marksInside50: sourceNumber(row, bindings.marksInside50),
    freeKicksFor: sourceNumber(row, bindings.freeKicksFor),
    freeKicksAgainst: sourceNumber(row, bindings.freeKicksAgainst),
    rebound50s: sourceNumber(row, bindings.rebound50s),
    onePercenters: sourceNumber(row, bindings.onePercenters),
    clearances: sourceNumber(row, bindings.clearances),
    tackles: sourceNumber(row, bindings.tackles),
  };
}

function reviewedFields(fieldMap: AflTradeHpnPavInputFieldMap['content']): string[] {
  if (fieldMap.schemaVersion === 'afl-trade-hpn-projected-field-map/v1') {
    return [
      ...new Set(
        fieldMap.semanticBindings.flatMap(listAflTradeHpnCandidateSourceFields)
      ),
    ].sort(ordinalCompare);
  }
  return aflTradeHpnPavReviewedFields(fieldMap);
}

function projectedResultMatchesSource(
  row: z.infer<typeof resultRowSchema>,
  fieldMap: AflTradeHpnProjectedFieldMap['content']
): boolean {
  const homePoints = projectedBinding(fieldMap, 'homePoints');
  const awayPoints = projectedBinding(fieldMap, 'awayPoints');
  if (
    homePoints?.kind !== 'direct' ||
    awayPoints?.kind !== 'direct' ||
    row.homePoints !== row.source.sourceValues[homePoints.sourceField] ||
    row.awayPoints !== row.source.sourceValues[awayPoints.sourceField]
  ) {
    return false;
  }
  const completion = projectedBinding(fieldMap, 'completionStatus');
  if (fieldMap.completionRule?.kind === 'source_status') {
    return (
      completion?.kind === 'direct' &&
      typeof row.source.sourceValues[completion.sourceField] === 'string' &&
      fieldMap.completionRule.completedValues.includes(
        row.source.sourceValues[completion.sourceField] as string
      )
    );
  }
  return (
    fieldMap.completionRule?.kind === 'reviewed_final_score_presence' &&
    completion?.kind === 'reviewed_final_scores' &&
    row.source.sourceValues[completion.homePointsField] === row.homePoints &&
    row.source.sourceValues[completion.awayPointsField] === row.awayPoints
  );
}

function addInputSetIssues(
  input: z.infer<typeof inputSetContentSchema>,
  context: z.RefinementCtx
): void {
  if (Date.parse(input.effectiveThrough) > Date.parse(input.createdAt)) {
    context.addIssue({
      code: 'custom',
      message: 'PAV input creation precedes its evidence cutoff.',
    });
  }
  if (Date.parse(input.factualUniverse.finalizedAt) > Date.parse(input.createdAt)) {
    context.addIssue({
      code: 'custom',
      path: ['factualUniverse', 'finalizedAt'],
      message: 'The factual universe must be finalized before PAV input creation.',
    });
  }
  const factualMatches = new Map(
    input.factualUniverse.completedMatchFacts.map((match) => [match.matchId, match])
  );
  if (
    factualMatches.size !== input.completedMatches.length ||
    input.completedMatches.some((match) => {
      const factual = factualMatches.get(match.matchId);
      return (
        !factual ||
        factual.effectiveAt !== match.effectiveAt ||
        factual.homeClubId !== match.homeClubId ||
        factual.awayClubId !== match.awayClubId
      );
    })
  ) {
    context.addIssue({
      code: 'custom',
      path: ['factualUniverse', 'completedMatchFacts'],
      message: 'The PAV completed matches must equal the exact approved factual universe.',
    });
  }
  const fieldMaps = new Map(input.fieldMaps.map((fieldMap) => [fieldMap.fieldMapId, fieldMap]));
  const runs = new Map(input.sourceRuns.map((run) => [run.normalizationRunId, run]));
  if (fieldMaps.size !== input.fieldMaps.length || runs.size !== input.sourceRuns.length) {
    context.addIssue({ code: 'custom', message: 'PAV field maps and source runs must be unique.' });
  }
  for (const run of input.sourceRuns) {
    const fieldMap = fieldMaps.get(run.fieldMapId);
    if (
      !fieldMap ||
      fieldMap.content.provider !== run.provider ||
      fieldMap.content.capabilityId !== run.capabilityId ||
      fieldMap.content.environment !== input.environment ||
      fieldMap.content.competition !== input.competition ||
      input.seasonYear < fieldMap.content.validFromSeason ||
      input.seasonYear > fieldMap.content.validThroughSeason ||
      run.competition !== input.competition ||
      run.seasonYear !== input.seasonYear ||
      Date.parse(run.capturedAt) > Date.parse(input.effectiveThrough) ||
      Date.parse(run.finalizedAt) > Date.parse(input.createdAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceRuns'],
        message: 'Every PAV source run must match its reviewed map, season, scope, and chronology.',
      });
    }
    if (fieldMap?.content.schemaVersion === 'afl-trade-hpn-projected-field-map/v1') {
      const expected = listAflTradeHpnRequiredSemanticFields(fieldMap.content.inputKind);
      const actual = fieldMap.content.semanticBindings.map(({ semanticField }) => semanticField);
      if (
        actual.length !== expected.length ||
        actual.some((semanticField, index) => semanticField !== expected[index])
      ) {
        context.addIssue({
          code: 'custom',
          path: ['fieldMaps'],
          message: 'A projected PAV map must bind every required semantic field exactly once.',
        });
      }
    }
    const runRows = input.rows.filter(
      ({ source }) => source.normalizationRunId === run.normalizationRunId
    );
    if (runRows.length !== run.sourceRowCount) {
      context.addIssue({
        code: 'custom',
        path: ['sourceRuns'],
        message: 'Every finalized source row count must be conserved by the PAV input set.',
      });
    }
  }
  const sourceRowIds = input.rows.map(({ source }) => source.providerDecodedRowId);
  if (new Set(sourceRowIds).size !== sourceRowIds.length) {
    context.addIssue({
      code: 'custom',
      message: 'Each provider source row must occur exactly once.',
    });
  }
  for (const row of input.rows) {
    const run = runs.get(row.source.normalizationRunId);
    const fieldMap = run ? fieldMaps.get(run.fieldMapId) : undefined;
    if (!run || !fieldMap || fieldMap.content.inputKind !== row.kind) {
      context.addIssue({
        code: 'custom',
        message: 'A PAV row does not match its exact source run.',
      });
      continue;
    }
    const reviewed = reviewedFields(fieldMap.content);
    if (
      row.source.sourceFields.length !== reviewed.length ||
      row.source.sourceFields.some((field, index) => field !== reviewed[index])
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Every consumed source field must equal the exact reviewed field map.',
      });
    }
    if (row.kind === 'completed_match_result') {
      if (fieldMap.content.inputKind !== 'completed_match_result') continue;
      if (
        row.match.entityKind !== 'match' ||
        row.homeClub.entityKind !== 'club' ||
        row.awayClub.entityKind !== 'club'
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Result authority has the wrong entity kind.',
        });
      }
      const valuesMatch =
        fieldMap.content.schemaVersion === 'afl-trade-hpn-projected-field-map/v1'
          ? projectedResultMatchesSource(row, fieldMap.content)
          : row.homePoints === row.source.sourceValues[fieldMap.content.bindings.homePoints] &&
            row.awayPoints === row.source.sourceValues[fieldMap.content.bindings.awayPoints] &&
            typeof row.source.sourceValues[fieldMap.content.bindings.completionStatus] ===
              'string' &&
            fieldMap.content.bindings.completedValues.includes(
              row.source.sourceValues[
                fieldMap.content.bindings.completionStatus
              ] as string
            );
      if (!valuesMatch) {
        context.addIssue({
          code: 'custom',
          message: 'Result values do not match staged source fields.',
        });
      }
    } else {
      if (fieldMap.content.inputKind !== 'player_match_stats') continue;
      if (
        row.player.entityKind !== 'player' ||
        row.match.entityKind !== 'match' ||
        row.club.entityKind !== 'club'
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Player-stat authority has the wrong entity kind.',
        });
      }
      const expectedStats = statsFromSource(row, fieldMap.content);
      if (
        Object.values(expectedStats).some((value) => !Number.isFinite(value)) ||
        Object.entries(expectedStats).some(
          ([field, value]) => row.stats[field as keyof typeof row.stats] !== value
        )
      ) {
        context.addIssue({
          code: 'custom',
          message: 'PAV numeric values must equal the exact reviewed staged source fields.',
        });
      }
      const completedMatch = input.completedMatches.find(
        ({ matchId }) => matchId === row.match.canonicalId
      );
      const effectiveDate = completedMatch?.effectiveAt.slice(0, 10);
      if (
        row.acquisitionSpell.playerId !== row.player.canonicalId ||
        row.acquisitionSpell.clubId !== row.club.canonicalId ||
        effectiveDate === undefined ||
        effectiveDate < row.acquisitionSpell.startDate ||
        (row.acquisitionSpell.endDate !== null && effectiveDate > row.acquisitionSpell.endDate) ||
        Date.parse(row.acquisitionSpell.recordedAt) > Date.parse(input.createdAt)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['rows'],
          message:
            'Every player-stat row must bind the exact current approved acquisition spell covering its player, club, match date, and knowledge time.',
        });
      }
    }
  }

  const matches = new Map(input.completedMatches.map((match) => [match.matchId, match]));
  if (matches.size !== input.completedMatches.length) {
    context.addIssue({ code: 'custom', message: 'Completed matches must be unique.' });
  }
  const resultRows = input.rows.filter(
    (row): row is z.infer<typeof resultRowSchema> => row.kind === 'completed_match_result'
  );
  for (const match of input.completedMatches) {
    const exactResults = resultRows.filter(
      ({ match: resolution }) => resolution.canonicalId === match.matchId
    );
    if (
      exactResults.length !== 1 ||
      exactResults[0]?.effectiveAt !== match.effectiveAt ||
      exactResults[0]?.homeClub.canonicalId !== match.homeClubId ||
      exactResults[0]?.awayClub.canonicalId !== match.awayClubId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Every completed match must have one exact resolved result row.',
      });
    }
    for (const clubId of [match.homeClubId, match.awayClubId]) {
      const expectedPlayers = input.factualUniverse.playerAppearanceFacts
        .filter(
          (appearance) => appearance.matchId === match.matchId && appearance.clubId === clubId
        )
        .map(({ playerId }) => playerId)
        .sort(ordinalCompare);
      const rows = input.rows.filter(
        (row): row is z.infer<typeof playerRowSchema> =>
          row.kind === 'player_match_stats' &&
          row.match.canonicalId === match.matchId &&
          row.club.canonicalId === clubId
      );
      const primary = rows
        .filter(({ role }) => role === 'primary')
        .map(({ player }) => player.canonicalId)
        .sort(ordinalCompare);
      const primaryProviders = new Set(
        rows
          .filter(({ role }) => role === 'primary')
          .map(({ source }) => runs.get(source.normalizationRunId)?.provider)
      );
      const corroboratingProviders = new Set(
        rows
          .filter(({ role }) => role === 'corroborating')
          .map(({ source }) => runs.get(source.normalizationRunId)?.provider)
      );
      const invalidCorroboratingProvider = [...corroboratingProviders].some((provider) => {
        const providerPlayers = rows
          .filter(
            ({ role, source }) =>
              role === 'corroborating' && runs.get(source.normalizationRunId)?.provider === provider
          )
          .map(({ player }) => player.canonicalId)
          .sort(ordinalCompare);
        return (
          providerPlayers.length !== new Set(providerPlayers).size ||
          providerPlayers.length !== primary.length ||
          providerPlayers.some((playerId, index) => playerId !== primary[index])
        );
      });
      if (
        expectedPlayers.length === 0 ||
        primary.length === 0 ||
        primary.length !== new Set(primary).size ||
        primary.length !== expectedPlayers.length ||
        primary.some((playerId, index) => playerId !== expectedPlayers[index]) ||
        primaryProviders.size !== 1 ||
        corroboratingProviders.size < 1 ||
        [...corroboratingProviders].some((provider) => primaryProviders.has(provider)) ||
        invalidCorroboratingProvider
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Every match side requires the exact factual appearance universe and one independently corroborated player set.',
        });
      }
    }
  }
  const invalidFactualAppearance = input.factualUniverse.playerAppearanceFacts.some(
    ({ matchId, clubId }) => {
      const match = matches.get(matchId);
      return !match || (clubId !== match.homeClubId && clubId !== match.awayClubId);
    }
  );
  const unmatchedPlayerRow = input.rows.some(
    (row) => row.kind === 'player_match_stats' && !matches.has(row.match.canonicalId)
  );
  if (
    invalidFactualAppearance ||
    unmatchedPlayerRow ||
    resultRows.length !== input.completedMatches.length
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Rows or factual appearances exist outside the completed match universe.',
    });
  }
  const counts = {
    completedMatches: input.completedMatches.length,
    resultRows: resultRows.length,
    primaryPlayerRows: input.rows.filter(
      (row) => row.kind === 'player_match_stats' && row.role === 'primary'
    ).length,
    corroboratingPlayerRows: input.rows.filter(
      (row) => row.kind === 'player_match_stats' && row.role === 'corroborating'
    ).length,
  };
  if (
    Object.entries(counts).some(
      ([key, value]) => input.counts[key as keyof typeof counts] !== value
    )
  ) {
    context.addIssue({
      code: 'custom',
      message: 'PAV input counts do not match exact membership.',
    });
  }
}

export function createAflTradeHpnPavFieldMap(
  input: Omit<
    z.input<typeof fieldMapContentSchema>,
    'schemaVersion' | 'authorityBoundary' | 'publicationEligible'
  > &
    Partial<
      Pick<
        z.input<typeof fieldMapContentSchema>,
        'schemaVersion' | 'authorityBoundary' | 'publicationEligible'
      >
    >
): AflTradeHpnPavFieldMap {
  const content = fieldMapContentSchema.parse({
    ...input,
    schemaVersion: AFL_TRADE_HPN_PAV_FIELD_MAP_SCHEMA_VERSION,
    authorityBoundary: AFL_TRADE_HPN_PAV_INPUT_AUTHORITY_BOUNDARY,
    publicationEligible: false,
  });
  return aflTradeHpnPavFieldMapSchema.parse({
    fieldMapId: createAflTradeContentAddress('hpn-pav-field-map', content),
    content,
  });
}

type CreateLegacyInputSet = Omit<
  z.input<typeof legacyInputSetContentSchema>,
  'schemaVersion' | 'authorityBoundary' | 'publicationEligible' | 'counts'
>;
type CreateProjectedInputSet = Omit<
  z.input<typeof projectedInputSetContentSchema>,
  'schemaVersion' | 'authorityBoundary' | 'publicationEligible' | 'counts'
>;
type CreateInputSet = CreateLegacyInputSet | CreateProjectedInputSet;

export function createAflTradeHpnPavSeasonInputSet(
  unparsedInput: CreateInputSet
): AflTradeHpnPavSeasonInputSet {
  const rows = [...unparsedInput.rows].sort((left, right) =>
    ordinalCompare(left.source.providerDecodedRowId, right.source.providerDecodedRowId)
  );
  const fieldMaps = [...unparsedInput.fieldMaps].sort((left, right) =>
    ordinalCompare(left.fieldMapId, right.fieldMapId)
  );
  const usesProjectedMaps = fieldMaps.every(
    ({ content }) => content.schemaVersion === 'afl-trade-hpn-projected-field-map/v1'
  );
  const usesLegacyMaps = fieldMaps.every(
    ({ content }) => content.schemaVersion === AFL_TRADE_HPN_PAV_FIELD_MAP_SCHEMA_VERSION
  );
  if (!usesProjectedMaps && !usesLegacyMaps) {
    throw new TypeError('One HPN input set cannot mix legacy and projected map authority.');
  }
  const sourceRuns = [...unparsedInput.sourceRuns].sort((left, right) =>
    ordinalCompare(left.normalizationRunId, right.normalizationRunId)
  );
  const completedMatches = [...unparsedInput.completedMatches].sort((left, right) =>
    ordinalCompare(left.matchId, right.matchId)
  );
  const factualUniverse = {
    ...unparsedInput.factualUniverse,
    completedMatchFacts: [...unparsedInput.factualUniverse.completedMatchFacts]
      .sort((left, right) => ordinalCompare(left.matchId, right.matchId))
      .map((match) => ({ ...match, factIds: [...match.factIds].sort(ordinalCompare) })),
    playerAppearanceFacts: [...unparsedInput.factualUniverse.playerAppearanceFacts]
      .sort((left, right) =>
        ordinalCompare(
          `${left.matchId}\u0000${left.clubId}\u0000${left.playerId}`,
          `${right.matchId}\u0000${right.clubId}\u0000${right.playerId}`
        )
      )
      .map((appearance) => ({
        ...appearance,
        factIds: [...appearance.factIds].sort(ordinalCompare),
      })),
  };
  const content = inputSetContentSchema.parse({
    ...unparsedInput,
    schemaVersion: usesProjectedMaps
      ? AFL_TRADE_HPN_PAV_INPUT_SET_V2_SCHEMA_VERSION
      : AFL_TRADE_HPN_PAV_INPUT_SET_SCHEMA_VERSION,
    authorityBoundary: AFL_TRADE_HPN_PAV_INPUT_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    fieldMaps,
    sourceRuns,
    completedMatches,
    factualUniverse,
    rows,
    counts: {
      completedMatches: completedMatches.length,
      resultRows: rows.filter(({ kind }) => kind === 'completed_match_result').length,
      primaryPlayerRows: rows.filter(
        (row) => row.kind === 'player_match_stats' && row.role === 'primary'
      ).length,
      corroboratingPlayerRows: rows.filter(
        (row) => row.kind === 'player_match_stats' && row.role === 'corroborating'
      ).length,
    },
  });
  return aflTradeHpnPavSeasonInputSetSchema.parse({
    inputSetId: createAflTradeContentAddress('hpn-pav-input-set', content),
    content,
  });
}
