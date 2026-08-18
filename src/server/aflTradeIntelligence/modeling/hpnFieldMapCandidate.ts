import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  listAflTradeHpnRequiredSemanticFields,
  type AflTradeHpnRequiredSemanticField,
} from './hpnCalculationEligibility';

export const AFL_TRADE_HPN_FIELD_MAP_CANDIDATE_SCHEMA_VERSION =
  'afl-trade-hpn-field-map-candidate/v2' as const;

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);
const fieldNameSchema = z.string().trim().min(1).max(200);
const semanticFieldSchema = z.enum([
  'awayClub',
  'awayPoints',
  'clearances',
  'club',
  'completionStatus',
  'freeKicksAgainst',
  'freeKicksFor',
  'goalAssists',
  'hitOuts',
  'homeClub',
  'homePoints',
  'inside50s',
  'marks',
  'marksInside50',
  'match',
  'onePercenters',
  'player',
  'rebound50s',
  'tackles',
  'totalPoints',
]);
const mappingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('direct'), sourceField: fieldNameSchema }).strict(),
  z
    .object({
      kind: z.literal('goals_plus_behinds'),
      goals: fieldNameSchema,
      behinds: fieldNameSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('composite_key'),
      sourceFields: z.array(fieldNameSchema).min(2).max(10),
    })
    .strict()
    .superRefine((mapping, context) => {
      if (new Set(mapping.sourceFields).size !== mapping.sourceFields.length) {
        context.addIssue({
          code: 'custom',
          path: ['sourceFields'],
          message: 'Composite-key source fields must be unique.',
        });
      }
    }),
  z
    .object({
      kind: z.literal('reviewed_final_scores'),
      matchDateField: fieldNameSchema,
      homePointsField: fieldNameSchema,
      awayPointsField: fieldNameSchema,
    })
    .strict(),
]);
const bindingSchema = z
  .object({ semanticField: semanticFieldSchema, mapping: mappingSchema })
  .strict();
const decodeMapSchema = z
  .object({
    mapId: publicIdSchema,
    capabilityId: publicIdSchema,
    sourceSchemaSha256: aflTradeSha256Schema,
    exactOrderedFields: z.array(fieldNameSchema).min(1).max(1_000),
  })
  .passthrough();

export type AflTradeHpnSemanticBindingCandidate = Readonly<{
  semanticField: AflTradeHpnRequiredSemanticField;
  mapping:
    | Readonly<{ kind: 'direct'; sourceField: string }>
    | Readonly<{ kind: 'goals_plus_behinds'; goals: string; behinds: string }>
    | Readonly<{ kind: 'composite_key'; sourceFields: readonly string[] }>
    | Readonly<{
        kind: 'reviewed_final_scores';
        matchDateField: string;
        homePointsField: string;
        awayPointsField: string;
      }>;
}>;

export function listAflTradeHpnCandidateSourceFields(
  binding: AflTradeHpnSemanticBindingCandidate
): readonly string[] {
  switch (binding.mapping.kind) {
    case 'direct':
      return [binding.mapping.sourceField];
    case 'goals_plus_behinds':
      return [binding.mapping.goals, binding.mapping.behinds];
    case 'composite_key':
      return binding.mapping.sourceFields;
    case 'reviewed_final_scores':
      return [
        binding.mapping.matchDateField,
        binding.mapping.homePointsField,
        binding.mapping.awayPointsField,
      ];
  }
}

const completionRuleSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('source_status'),
      completedValues: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
    })
    .strict(),
  z
    .object({
      kind: z.literal('reviewed_final_score_presence'),
      decisionRequired: z.literal(true),
    })
    .strict(),
]);

const contentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_HPN_FIELD_MAP_CANDIDATE_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    purpose: z.literal('private_confirmed_realized_hpn_pav_review'),
    competition: z.literal('AFLM'),
    provider: publicIdSchema,
    capabilityId: publicIdSchema,
    sourceSchemaSha256: aflTradeSha256Schema,
    inputKind: z.enum(['completed_match_result', 'player_match_stats']),
    validFromSeason: z.number().int().min(1998).max(2200),
    validThroughSeason: z.number().int().min(1998).max(2200),
    providerDecodeMapId: publicIdSchema,
    providerDecodeMapArtifact: aflTradeArtifactRefSchema,
    semanticBindings: z.array(bindingSchema).min(1).max(30),
    completionRule: completionRuleSchema.nullable(),
    reviewState: z.literal('requires_review'),
    createdAt: z.iso.datetime({ offset: true }),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(
      'Unapproved field-map candidate for private local review only; it cannot satisfy HPN input admission until an exact current review decision creates a governed HPN field map.'
    ),
  })
  .strict()
  .superRefine((content, context) => {
    const expected = listAflTradeHpnRequiredSemanticFields(content.inputKind);
    const actual = content.semanticBindings.map(({ semanticField }) => semanticField);
    if (
      actual.length !== expected.length ||
      actual.some((semanticField, index) => semanticField !== expected[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['semanticBindings'],
        message: 'A candidate must bind every required HPN semantic field exactly once.',
      });
    }
    if (content.validThroughSeason < content.validFromSeason) {
      context.addIssue({
        code: 'custom',
        path: ['validThroughSeason'],
        message: 'Candidate season validity cannot run backwards.',
      });
    }
    if (
      Date.parse(content.providerDecodeMapArtifact.createdAt) > Date.parse(content.createdAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['providerDecodeMapArtifact'],
        message: 'Candidate evidence must exist before candidate creation.',
      });
    }
    if ((content.inputKind === 'completed_match_result') !== (content.completionRule !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['completionRule'],
        message: 'Only result candidates require an explicit completion rule.',
      });
    }
    const completionBinding = content.semanticBindings.find(
      ({ semanticField }) => semanticField === 'completionStatus'
    );
    if (
      content.completionRule?.kind === 'source_status' &&
      completionBinding?.mapping.kind !== 'direct'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['completionRule'],
        message: 'Source-status completion requires one direct status-field mapping.',
      });
    }
    if (
      content.completionRule?.kind === 'reviewed_final_score_presence' &&
      completionBinding?.mapping.kind !== 'reviewed_final_scores'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['completionRule'],
        message: 'Reviewed final-score completion requires exact score-evidence fields.',
      });
    }
    const invalidMapping = content.semanticBindings.some(({ semanticField, mapping }) => {
      if (semanticField === 'totalPoints') {
        return !['direct', 'goals_plus_behinds'].includes(mapping.kind);
      }
      if (semanticField === 'match') {
        return !['direct', 'composite_key'].includes(mapping.kind);
      }
      if (semanticField === 'completionStatus') {
        return !['direct', 'reviewed_final_scores'].includes(mapping.kind);
      }
      return mapping.kind !== 'direct';
    });
    const sourceFields = content.semanticBindings.flatMap((binding) =>
      listAflTradeHpnCandidateSourceFields(binding)
    );
    const directlyConsumedFields = content.semanticBindings.flatMap(({ mapping }) =>
      mapping.kind === 'direct'
        ? [mapping.sourceField]
        : mapping.kind === 'goals_plus_behinds'
          ? [mapping.goals, mapping.behinds]
          : []
    );
    if (
      invalidMapping ||
      new Set(directlyConsumedFields).size !== directlyConsumedFields.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['semanticBindings'],
        message:
          'Candidate semantic mappings must be explicit and directly consumed source fields distinct.',
      });
    }
    if (sourceFields.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['semanticBindings'],
        message: 'A candidate requires exact source-field evidence.',
      });
    }
  });

export const aflTradeHpnFieldMapCandidateSchema = z
  .object({
    candidateId: aflTradeContentAddressedIdSchema('hpn-field-map-candidate'),
    content: contentSchema,
  })
  .strict()
  .superRefine((candidate, context) => {
    addAflTradeContentAddressIssue(
      'hpn-field-map-candidate',
      candidate.candidateId,
      candidate.content,
      context,
      ['candidateId']
    );
  });

export type AflTradeHpnFieldMapCandidate = z.infer<
  typeof aflTradeHpnFieldMapCandidateSchema
>;

export function createAflTradeHpnFieldMapCandidate(input: {
  readonly environment: 'non_production';
  readonly competition: 'AFLM';
  readonly provider: string;
  readonly capabilityId: string;
  readonly sourceSchemaSha256: string;
  readonly inputKind: 'completed_match_result' | 'player_match_stats';
  readonly validFromSeason: number;
  readonly validThroughSeason: number;
  readonly providerDecodeMap: unknown;
  readonly providerDecodeMapArtifact: AflTradeArtifactRef;
  readonly semanticBindings: readonly AflTradeHpnSemanticBindingCandidate[];
  readonly completionRule?: z.input<typeof completionRuleSchema>;
  readonly createdAt: string;
}): AflTradeHpnFieldMapCandidate {
  const decodeMap = decodeMapSchema.parse(input.providerDecodeMap);
  if (!doesAflTradeArtifactRefMatchCanonicalJson(input.providerDecodeMapArtifact, decodeMap)) {
    throw new TypeError('An exact provider decode-map artifact is required.');
  }
  if (
    decodeMap.capabilityId !== input.capabilityId ||
    decodeMap.sourceSchemaSha256 !== input.sourceSchemaSha256
  ) {
    throw new TypeError('The candidate must retain exact provider decode-map ancestry.');
  }
  const semanticBindings = [...input.semanticBindings]
    .map((binding) => bindingSchema.parse(binding))
    .sort((left, right) => left.semanticField.localeCompare(right.semanticField));
  const candidateFields = semanticBindings.flatMap((binding) =>
    listAflTradeHpnCandidateSourceFields(binding)
  );
  const availableFields = new Set(decodeMap.exactOrderedFields);
  if (candidateFields.some((sourceField) => !availableFields.has(sourceField))) {
    throw new TypeError('Every candidate source field must exist in the exact provider decode map.');
  }
  const content = contentSchema.parse({
    schemaVersion: AFL_TRADE_HPN_FIELD_MAP_CANDIDATE_SCHEMA_VERSION,
    environment: input.environment,
    purpose: 'private_confirmed_realized_hpn_pav_review',
    competition: input.competition,
    provider: input.provider,
    capabilityId: input.capabilityId,
    sourceSchemaSha256: input.sourceSchemaSha256,
    inputKind: input.inputKind,
    validFromSeason: input.validFromSeason,
    validThroughSeason: input.validThroughSeason,
    providerDecodeMapId: decodeMap.mapId,
    providerDecodeMapArtifact: input.providerDecodeMapArtifact,
    semanticBindings,
    completionRule: input.completionRule ?? null,
    reviewState: 'requires_review',
    createdAt: input.createdAt,
    publicationEligible: false,
    publicationProhibited: true,
    limitation:
      'Unapproved field-map candidate for private local review only; it cannot satisfy HPN input admission until an exact current review decision creates a governed HPN field map.',
  });
  return aflTradeHpnFieldMapCandidateSchema.parse({
    candidateId: createAflTradeContentAddress('hpn-field-map-candidate', content),
    content,
  });
}
