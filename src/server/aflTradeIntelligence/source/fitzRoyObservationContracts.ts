import { createHash } from 'node:crypto';

import { z } from 'zod';

import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  AFL_TRADE_FITZROY_CAPABILITIES,
  AFL_TRADE_FITZROY_PINNED_VERSION,
} from './fitzRoyProviderCapabilities';

export const AFL_TRADE_FITZROY_DECODED_TABLE_SCHEMA_VERSION =
  'afl-trade-fitzroy-decoded-table/v1' as const;
export const AFL_TRADE_FITZROY_FIELD_MAP_SCHEMA_VERSION = 'afl-trade-fitzroy-field-map/v1' as const;
export const AFL_TRADE_FITZROY_NORMALIZATION_RECEIPT_SCHEMA_VERSION =
  'afl-trade-fitzroy-normalization-receipt/v1' as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const fieldNameSchema = z.string().min(1).max(240);
const capabilityIds = AFL_TRADE_FITZROY_CAPABILITIES.map(
  (capability) => capability.capabilityId
) as [string, ...string[]];

const decodedScalarSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('missing') }).strict(),
  z.object({ kind: z.literal('nan') }).strict(),
  z.object({ kind: z.literal('positive_infinity') }).strict(),
  z.object({ kind: z.literal('negative_infinity') }).strict(),
  z.object({ kind: z.literal('logical'), value: z.boolean() }).strict(),
  z.object({ kind: z.literal('integer'), value: z.string().regex(/^-?\d+$/) }).strict(),
  z
    .object({
      kind: z.literal('finite_number'),
      value: z.string().regex(/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/),
    })
    .strict(),
  z.object({ kind: z.literal('text'), value: z.string() }).strict(),
  z.object({ kind: z.literal('date'), value: z.string(), rawDays: z.string() }).strict(),
  z
    .object({
      kind: z.literal('datetime'),
      value: z.string(),
      timezone: z.string().nullable(),
      epochSeconds: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('factor'),
      value: z.string(),
      levelIndex: z.number().int().positive(),
    })
    .strict(),
]);

export type AflTradeDecodedScalar = z.infer<typeof decodedScalarSchema>;

const decodedFieldSchema = z
  .object({
    name: fieldNameSchema,
    storageType: z.string().min(1).max(120),
    classes: z.array(z.string().min(1).max(120)).max(20),
    levels: z.array(z.string()).nullable(),
    timezone: z.string().nullable(),
  })
  .strict();

const decodedTableSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_FITZROY_DECODED_TABLE_SCHEMA_VERSION),
    captureReceiptSha256: sha256Schema,
    capabilityId: z.enum(capabilityIds),
    fitzRoyVersion: z.literal(AFL_TRADE_FITZROY_PINNED_VERSION),
    authorizationCompetition: z.enum(['AFLM', 'AFLW']),
    authorizationSeason: z.number().int().min(1897).max(2200),
    invocationSha256: sha256Schema,
    invocationArgumentsSha256: sha256Schema,
    diagnosticsSha256: sha256Schema,
    sourceRdsSha256: sha256Schema,
    sourceSchemaSha256: sha256Schema,
    decoderRuntime: z
      .object({
        decoderVersion: z.literal('afl-trade-fitzroy-rds-decoder/v1'),
        rVersion: z.string().min(1).max(80),
        dependencyLockSha256: sha256Schema,
        imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      })
      .strict(),
    frame: z
      .object({
        classes: z.array(z.string().min(1).max(120)).min(1).max(20),
        rowNames: z.array(z.string()),
      })
      .strict(),
    fields: z.array(decodedFieldSchema).min(1),
    rows: z.array(z.array(decodedScalarSchema)),
  })
  .strict()
  .superRefine((table, context) => {
    const fieldNames = table.fields.map((field) => field.name);
    if (table.frame.rowNames.length !== table.rows.length) {
      context.addIssue({
        code: 'custom',
        path: ['frame', 'rowNames'],
        message: 'Decoded row names must account for every returned row.',
      });
    }
    if (new Set(fieldNames).size !== fieldNames.length) {
      context.addIssue({
        code: 'custom',
        path: ['fields'],
        message: 'Field names must be unique.',
      });
    }
    table.rows.forEach((row, rowIndex) => {
      if (row.length !== table.fields.length) {
        context.addIssue({
          code: 'custom',
          path: ['rows', rowIndex],
          message: 'Every decoded row must contain exactly one value per ordered field.',
        });
      }
    });
    if (createDecodedFieldSchemaSha256(table.fields) !== table.sourceSchemaSha256) {
      context.addIssue({
        code: 'custom',
        path: ['sourceSchemaSha256'],
        message: 'Decoded field descriptors do not match the captured schema fingerprint.',
      });
    }
  });

export type AflTradeFitzRoyDecodedTable = z.infer<typeof decodedTableSchema>;

export function createDecodedFieldSchemaSha256(
  fields: readonly z.infer<typeof decodedFieldSchema>[]
): string {
  return createHash('sha256')
    .update(
      canonicalizeAflTradeJson({
        fields: fields.map(({ name, classes, storageType, levels, timezone }) => ({
          name,
          classes,
          storageType,
          levels,
          timezone,
        })),
      })
    )
    .digest('hex');
}

const sourceFieldBindingSchema = z
  .object({
    sourceField: fieldNameSchema,
    required: z.boolean(),
  })
  .strict();

const identityBindingsSchema = z
  .object({
    nativeId: sourceFieldBindingSchema.nullable(),
    recordedName: sourceFieldBindingSchema,
    recordedSurname: sourceFieldBindingSchema.nullable().optional(),
    recordedClubNativeId: sourceFieldBindingSchema.nullable(),
    recordedClubName: sourceFieldBindingSchema.nullable(),
  })
  .strict();

const matchBindingsSchema = z
  .object({
    nativeMatchId: sourceFieldBindingSchema.nullable(),
    season: sourceFieldBindingSchema,
    roundLabel: sourceFieldBindingSchema,
    matchDate: sourceFieldBindingSchema.nullable(),
    homeClubNativeId: sourceFieldBindingSchema.nullable(),
    homeClubName: sourceFieldBindingSchema,
    awayClubNativeId: sourceFieldBindingSchema.nullable(),
    awayClubName: sourceFieldBindingSchema,
    status: sourceFieldBindingSchema.nullable(),
  })
  .strict();

const metricBindingSchema = z
  .object({
    metricCode: z.enum(['goals', 'brownlow_votes', 'coaches_votes']),
    sourceField: fieldNameSchema,
    definitionVersion: z.string().min(1).max(120),
    unit: z.string().min(1).max(60),
    zeroSemantics: z.enum(['measured_zero', 'provider_zero_may_mean_missing']),
  })
  .strict();

const achievementBindingSchema = z
  .object({
    achievementCode: z.enum([
      'all_australian_team',
      'all_australian_squad',
      'rising_star_nomination',
      'rising_star_winner',
    ]),
    evidenceField: fieldNameSchema.nullable(),
  })
  .strict();

const fieldMapSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_FITZROY_FIELD_MAP_SCHEMA_VERSION),
    mapId: z.string().min(1).max(240),
    capabilityId: z.enum(capabilityIds),
    fitzRoyVersion: z.literal(AFL_TRADE_FITZROY_PINNED_VERSION),
    sourceSchemaSha256: sha256Schema,
    exactOrderedFields: z.array(fieldNameSchema).min(1),
    observationKind: z.enum(['match_universe', 'player_identity', 'player_stat', 'achievement']),
    competition: z.enum(['AFLM', 'AFLW']),
    invocationArgumentsSha256: sha256Schema,
    validFromSeason: z.number().int().min(1897).max(2200),
    validThroughSeason: z.number().int().min(1897).max(2200),
    seasonField: sourceFieldBindingSchema.nullable(),
    roundLabelField: sourceFieldBindingSchema.nullable(),
    observedDateField: sourceFieldBindingSchema.nullable(),
    naturalKeyFields: z.array(fieldNameSchema).min(1),
    approvedAt: z.string().datetime({ offset: true }),
    approvalDecisionId: z.string().min(1).max(240),
    identity: identityBindingsSchema.nullable(),
    match: matchBindingsSchema.nullable(),
    metrics: z.array(metricBindingSchema),
    achievement: achievementBindingSchema.nullable(),
  })
  .strict()
  .superRefine((map, context) => {
    if (new Set(map.exactOrderedFields).size !== map.exactOrderedFields.length) {
      context.addIssue({
        code: 'custom',
        path: ['exactOrderedFields'],
        message: 'Approved source fields must be unique and remain in returned order.',
      });
    }
    if (new Set(map.naturalKeyFields).size !== map.naturalKeyFields.length) {
      context.addIssue({
        code: 'custom',
        path: ['naturalKeyFields'],
        message: 'Reviewed provider natural-key fields must be unique.',
      });
    }
    if (map.validFromSeason > map.validThroughSeason) {
      context.addIssue({
        code: 'custom',
        path: ['validThroughSeason'],
        message: 'Field-map season applicability is invalid.',
      });
    }
    if (map.observationKind === 'match_universe' && map.match === null) {
      context.addIssue({
        code: 'custom',
        path: ['match'],
        message: 'Match-universe maps need match bindings.',
      });
    }
    if (
      map.observationKind !== 'player_identity' &&
      map.seasonField === null &&
      map.capabilityId !== 'official-afl-player-stats'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['seasonField'],
        message:
          'Season, match, and achievement observations need a source season field unless the official AFL request authorization supplies the season.',
      });
    }
    if (
      map.observationKind === 'player_identity' &&
      (map.identity === null ||
        map.match !== null ||
        map.metrics.length > 0 ||
        map.achievement !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['identity'],
        message: 'Player-identity maps accept identity bindings only.',
      });
    }
    if (
      map.observationKind === 'player_stat' &&
      (map.identity === null || map.metrics.length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['identity'],
        message: 'Player-stat maps need provider identity and metric bindings.',
      });
    }
    if (
      map.observationKind === 'achievement' &&
      (map.identity === null || map.achievement === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['achievement'],
        message: 'Achievement maps need provider identity and achievement bindings.',
      });
    }

    const boundFields = collectBoundFields(map);
    for (const field of boundFields) {
      if (!map.exactOrderedFields.includes(field)) {
        context.addIssue({
          code: 'custom',
          path: ['exactOrderedFields'],
          message: `Binding references an unapproved source field: ${field}.`,
        });
      }
    }
  });

export type AflTradeFitzRoyFieldMap = z.infer<typeof fieldMapSchema>;

function collectBoundFields(map: {
  seasonField: z.infer<typeof sourceFieldBindingSchema> | null;
  roundLabelField: z.infer<typeof sourceFieldBindingSchema> | null;
  observedDateField: z.infer<typeof sourceFieldBindingSchema> | null;
  naturalKeyFields: string[];
  identity: z.infer<typeof identityBindingsSchema> | null;
  match: z.infer<typeof matchBindingsSchema> | null;
  metrics: z.infer<typeof metricBindingSchema>[];
  achievement: z.infer<typeof achievementBindingSchema> | null;
}): string[] {
  const fields: string[] = [];
  if (map.seasonField !== null) fields.push(map.seasonField.sourceField);
  if (map.roundLabelField !== null) fields.push(map.roundLabelField.sourceField);
  if (map.observedDateField !== null) fields.push(map.observedDateField.sourceField);
  fields.push(...map.naturalKeyFields);
  for (const binding of Object.values(map.identity ?? {})) {
    if (binding != null) fields.push(binding.sourceField);
  }
  for (const binding of Object.values(map.match ?? {})) {
    if (binding !== null) fields.push(binding.sourceField);
  }
  fields.push(...map.metrics.map((metric) => metric.sourceField));
  if (map.achievement?.evidenceField !== null && map.achievement?.evidenceField !== undefined) {
    fields.push(map.achievement.evidenceField);
  }
  return fields;
}

export function parseAflTradeFitzRoyDecodedTable(value: unknown): AflTradeFitzRoyDecodedTable {
  return decodedTableSchema.parse(value);
}

export function parseAflTradeFitzRoyFieldMap(value: unknown): AflTradeFitzRoyFieldMap {
  return fieldMapSchema.parse(value);
}

export function assertAflTradeFitzRoyFieldMapMatchesTable(input: {
  table: AflTradeFitzRoyDecodedTable;
  fieldMap: AflTradeFitzRoyFieldMap;
}): void {
  const { table, fieldMap } = input;
  const capability = AFL_TRADE_FITZROY_CAPABILITIES.find(
    (candidate) => candidate.capabilityId === fieldMap.capabilityId
  );
  if (
    capability === undefined ||
    table.capabilityId !== fieldMap.capabilityId ||
    table.sourceSchemaSha256 !== fieldMap.sourceSchemaSha256 ||
    table.fitzRoyVersion !== fieldMap.fitzRoyVersion
  ) {
    throw new Error('Decoded fitzRoy table does not match its approved capability and schema map.');
  }
  if (
    table.authorizationCompetition !== fieldMap.competition ||
    table.invocationArgumentsSha256 !== fieldMap.invocationArgumentsSha256 ||
    table.authorizationSeason < fieldMap.validFromSeason ||
    table.authorizationSeason > fieldMap.validThroughSeason ||
    !(capability.competitions as readonly ('AFLM' | 'AFLW')[]).includes(fieldMap.competition)
  ) {
    throw new Error('Field map competition must equal the authorized capture competition.');
  }
  const allowedMetrics = new Set(capability.metrics);
  if (fieldMap.observationKind === 'match_universe' && !allowedMetrics.has('match_universe')) {
    throw new Error('Capability is not authorized to produce a match-universe candidate.');
  }
  if (fieldMap.observationKind === 'player_identity' && !allowedMetrics.has('player_identity')) {
    throw new Error('Capability is not authorized to produce a player-identity candidate.');
  }
  for (const metric of fieldMap.metrics) {
    if (!allowedMetrics.has(metric.metricCode)) {
      throw new Error(`Capability is not authorized to map metric ${metric.metricCode}.`);
    }
    if (
      fieldMap.capabilityId === 'afl-tables-player-stats' &&
      metric.zeroSemantics !== 'provider_zero_may_mean_missing'
    ) {
      throw new Error('AFL Tables player-stat zero values must remain quarantinable.');
    }
  }
  const achievementMetric =
    fieldMap.achievement?.achievementCode.startsWith('all_australian') === true
      ? 'all_australian'
      : fieldMap.achievement?.achievementCode.startsWith('rising_star') === true
        ? 'rising_star'
        : null;
  if (achievementMetric !== null && !allowedMetrics.has(achievementMetric)) {
    throw new Error(`Capability is not authorized to map achievement ${achievementMetric}.`);
  }
  const actualFields = table.fields.map((field) => field.name);
  if (
    actualFields.length !== fieldMap.exactOrderedFields.length ||
    actualFields.some((field, index) => field !== fieldMap.exactOrderedFields[index])
  ) {
    throw new Error('Decoded fitzRoy fields differ from the exact approved field order.');
  }
}

export function createAflTradeFitzRoyFieldMapSha256(fieldMap: AflTradeFitzRoyFieldMap): string {
  return createHash('sha256')
    .update(canonicalizeAflTradeJson(parseAflTradeFitzRoyFieldMap(fieldMap)))
    .digest('hex');
}

export function decodedScalarToSourceText(value: AflTradeDecodedScalar): string | null {
  switch (value.kind) {
    case 'missing':
      return null;
    case 'logical':
      return value.value ? 'true' : 'false';
    case 'integer':
    case 'finite_number':
    case 'text':
    case 'date':
    case 'datetime':
    case 'factor':
      return value.value;
    case 'nan':
      return 'NaN';
    case 'positive_infinity':
      return 'Infinity';
    case 'negative_infinity':
      return '-Infinity';
  }
}
