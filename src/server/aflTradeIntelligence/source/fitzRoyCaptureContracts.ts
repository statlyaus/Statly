import { createHash } from 'node:crypto';

import { z } from 'zod';

import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  AFL_TRADE_FITZROY_CAPABILITIES,
  AFL_TRADE_FITZROY_PINNED_VERSION,
  type AflTradeFitzRoyCaptureOrigin,
  type AflTradeFitzRoyCompetition,
  type AflTradeFitzRoyProvider,
} from './fitzRoyProviderCapabilities';

export const AFL_TRADE_FITZROY_CAPTURE_REQUEST_SCHEMA_VERSION =
  'afl-trade-fitzroy-capture-request/v1' as const;
export const AFL_TRADE_FITZROY_INVOCATION_SCHEMA_VERSION =
  'afl-trade-fitzroy-invocation/v1' as const;
export const AFL_TRADE_FITZROY_DIAGNOSTICS_SCHEMA_VERSION =
  'afl-trade-fitzroy-diagnostics/v1' as const;

const seasonSchema = z.number().int().min(1897).max(2200);
const roundNumberSchema = z.number().int().min(0).max(100).nullable();
const scopedRoundNumbersSchema = z
  .array(z.number().int().min(0).max(100))
  .min(1)
  .max(30)
  .superRefine((roundNumbers, context) => {
    for (let index = 1; index < roundNumbers.length; index += 1) {
      if (roundNumbers[index] <= roundNumbers[index - 1]) {
        context.addIssue({
          code: 'custom',
          message: 'Scoped coaches-vote rounds must be strictly increasing and unique.',
        });
        return;
      }
    }
  });
const teamSchema = z.string().trim().min(1).max(200).nullable();
const capabilityIdSchema = z.string().trim().min(1).max(200);

const matchGrainParametersSchema = z
  .object({ season: seasonSchema, roundNumber: roundNumberSchema })
  .strict();
const seasonParametersSchema = z.object({ season: seasonSchema }).strict();

const parameterSchemas = {
  'official-afl-player-stats': matchGrainParametersSchema,
  'afl-tables-player-stats': seasonParametersSchema.extend({
    rescrape: z.boolean(),
    rescrapeStartSeason: seasonSchema.nullable(),
  }),
  'footywire-player-stats': seasonParametersSchema.extend({ checkExisting: z.boolean() }),
  'fryzigg-player-stats': seasonParametersSchema,
  'official-afl-results': matchGrainParametersSchema,
  'afl-tables-results': matchGrainParametersSchema,
  'official-afl-player-details': z
    .object({
      season: seasonSchema,
      team: teamSchema,
      current: z.boolean(),
      officialTeams: z.boolean(),
    })
    .strict(),
  'afl-tables-player-details': z.object({ team: teamSchema }).strict(),
  'footywire-player-details': z.object({ team: teamSchema, current: z.boolean() }).strict(),
  'aflca-coaches-votes': z
    .object({ season: seasonSchema, roundNumber: roundNumberSchema, team: teamSchema })
    .strict(),
  'aflca-coaches-votes-scoped': z
    .object({
      season: seasonSchema,
      roundNumbers: scopedRoundNumbersSchema,
      awardScope: z.literal('home_and_away'),
      team: teamSchema,
    })
    .strict(),
  'footywire-brownlow-awards': z
    .object({ season: seasonSchema, type: z.enum(['player', 'team']) })
    .strict(),
  'footywire-all-australian': z
    .object({ season: seasonSchema, type: z.enum(['team', 'squad']) })
    .strict(),
  'footywire-rising-star': z
    .object({
      season: seasonSchema,
      roundNumber: roundNumberSchema,
      type: z.enum(['nominations', 'stats']),
    })
    .strict(),
} as const;

const invocationArgumentSchemas = {
  'official-afl-player-stats': z
    .object({
      season: seasonSchema,
      round_number: roundNumberSchema,
      comp: z.enum(['AFLM', 'AFLW']),
    })
    .strict(),
  'afl-tables-player-stats': z
    .object({
      season: seasonSchema,
      round_number: z.null(),
      rescrape: z.boolean(),
      rescrape_start_season: seasonSchema.nullable(),
    })
    .strict(),
  'footywire-player-stats': z
    .object({ season: seasonSchema, round_number: z.null(), check_existing: z.boolean() })
    .strict(),
  'fryzigg-player-stats': z
    .object({ season: seasonSchema, round_number: z.null(), comp: z.enum(['AFLM', 'AFLW']) })
    .strict(),
  'official-afl-results': z
    .object({
      season: seasonSchema,
      round_number: roundNumberSchema,
      comp: z.enum(['AFLM', 'AFLW']),
    })
    .strict(),
  'afl-tables-results': z
    .object({ season: seasonSchema, round_number: roundNumberSchema })
    .strict(),
  'official-afl-player-details': z
    .object({
      season: seasonSchema,
      team: teamSchema,
      current: z.literal(true),
      comp: z.enum(['AFLM', 'AFLW']),
      official_teams: z.boolean(),
    })
    .strict(),
  'afl-tables-player-details': z.object({ team: teamSchema }).strict(),
  'footywire-player-details': z.object({ team: teamSchema, current: z.boolean() }).strict(),
  'aflca-coaches-votes': z
    .object({
      season: seasonSchema,
      round_number: roundNumberSchema,
      comp: z.enum(['AFLM', 'AFLW']),
      team: teamSchema,
    })
    .strict(),
  'aflca-coaches-votes-scoped': z
    .object({
      season: seasonSchema,
      round_number: scopedRoundNumbersSchema,
      comp: z.literal('AFLM'),
      team: teamSchema,
      award_scope: z.literal('home_and_away'),
    })
    .strict(),
  'footywire-brownlow-awards': z
    .object({ season: seasonSchema, type: z.enum(['player', 'team']) })
    .strict(),
  'footywire-all-australian': z
    .object({ season: seasonSchema, type: z.enum(['team', 'squad']) })
    .strict(),
  'footywire-rising-star': z
    .object({
      season: seasonSchema,
      round_number: roundNumberSchema,
      type: z.enum(['nominations', 'stats']),
    })
    .strict(),
} as const;

export type AflTradeFitzRoyCapabilityId = keyof typeof parameterSchemas;

export interface AflTradeFitzRoyCaptureRequest {
  schemaVersion: typeof AFL_TRADE_FITZROY_CAPTURE_REQUEST_SCHEMA_VERSION;
  capabilityId: AflTradeFitzRoyCapabilityId;
  competition: AflTradeFitzRoyCompetition;
  authorizationSeason: number;
  parameters: Record<string, unknown>;
}

export interface AflTradeFitzRoyInvocation {
  schemaVersion: typeof AFL_TRADE_FITZROY_INVOCATION_SCHEMA_VERSION;
  capabilityId: AflTradeFitzRoyCapabilityId;
  fitzRoyVersion: typeof AFL_TRADE_FITZROY_PINNED_VERSION;
  provider: AflTradeFitzRoyProvider;
  directFunction: string;
  authorizationSeason: number;
  expectedCaptureOrigin: AflTradeFitzRoyCaptureOrigin;
  arguments: Record<string, unknown>;
}

const captureRequestEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_FITZROY_CAPTURE_REQUEST_SCHEMA_VERSION),
    capabilityId: z.enum(
      Object.keys(parameterSchemas) as [
        AflTradeFitzRoyCapabilityId,
        ...AflTradeFitzRoyCapabilityId[],
      ]
    ),
    competition: z.enum(['AFLM', 'AFLW']),
    authorizationSeason: seasonSchema,
    parameters: z.record(z.string(), z.unknown()),
  })
  .strict();

export const aflTradeFitzRoyInvocationSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_FITZROY_INVOCATION_SCHEMA_VERSION),
    capabilityId: z.enum(
      Object.keys(parameterSchemas) as [
        AflTradeFitzRoyCapabilityId,
        ...AflTradeFitzRoyCapabilityId[],
      ]
    ),
    fitzRoyVersion: z.literal(AFL_TRADE_FITZROY_PINNED_VERSION),
    provider: z.enum([
      'official_afl',
      'afl_tables',
      'footywire',
      'fryzigg',
      'afl_coaches_association',
    ]),
    directFunction: z.string().trim().min(1).max(200),
    authorizationSeason: seasonSchema,
    expectedCaptureOrigin: z.enum(['live_upstream', 'cached_dataset', 'cached_then_live_delta']),
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict()
  .superRefine((invocation, context) => {
    const capability = AFL_TRADE_FITZROY_CAPABILITIES.find(
      (candidate) => candidate.capabilityId === invocation.capabilityId
    );
    if (
      capability === undefined ||
      capability.provider !== invocation.provider ||
      capability.directFunction !== invocation.directFunction ||
      capability.fitzRoyVersion !== invocation.fitzRoyVersion ||
      capability.captureOrigin !== invocation.expectedCaptureOrigin
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Capture invocation must match one exact pinned fitzRoy capability.',
      });
      return;
    }
    if (
      invocation.capabilityId === 'afl-tables-player-details' ||
      invocation.capabilityId === 'footywire-player-details'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['capabilityId'],
        message: 'Season-unbounded player-detail invocations cannot form capture receipts.',
      });
      return;
    }
    const parsedArguments = invocationArgumentSchemas[invocation.capabilityId].safeParse(
      invocation.arguments
    );
    if (!parsedArguments.success) {
      context.addIssue({
        code: 'custom',
        path: ['arguments'],
        message: 'Invocation arguments must match the exact capability-specific contract.',
      });
      return;
    }
    const argumentsWithSeason = parsedArguments.data as { season?: number };
    if (argumentsWithSeason.season !== invocation.authorizationSeason) {
      context.addIssue({
        code: 'custom',
        path: ['arguments', 'season'],
        message: 'Invocation season must equal its authorization season.',
      });
    }
    if (invocation.capabilityId === 'afl-tables-player-stats') {
      const argumentsForAflTables = invocationArgumentSchemas['afl-tables-player-stats'].parse(
        parsedArguments.data
      );
      if (
        (argumentsForAflTables.rescrape &&
          argumentsForAflTables.rescrape_start_season !== invocation.authorizationSeason) ||
        (!argumentsForAflTables.rescrape && argumentsForAflTables.rescrape_start_season !== null)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['arguments', 'rescrape_start_season'],
          message: 'AFL Tables rescrape scope must equal the authorized season.',
        });
      }
    }
  });

export function parseAflTradeFitzRoyCaptureRequest(value: unknown): AflTradeFitzRoyCaptureRequest {
  const request = captureRequestEnvelopeSchema.parse(value);
  const parameters = parameterSchemas[request.capabilityId].parse(request.parameters);
  const capability = AFL_TRADE_FITZROY_CAPABILITIES.find(
    (candidate) => candidate.capabilityId === request.capabilityId
  );
  if (capability === undefined) {
    throw new Error(`Unknown fitzRoy capability ${request.capabilityId}.`);
  }
  if (!(capability.competitions as readonly string[]).includes(request.competition)) {
    throw new Error(
      `Capability ${request.capabilityId} does not support competition ${request.competition}.`
    );
  }
  if (
    request.capabilityId === 'afl-tables-player-details' ||
    request.capabilityId === 'footywire-player-details'
  ) {
    throw new Error(
      `Capability ${request.capabilityId} has no season-bounded source request and is disabled until Gate 0A supports its full retrieval scope.`
    );
  }
  if (request.capabilityId === 'official-afl-player-details') {
    const detailParameters = parameterSchemas['official-afl-player-details'].parse(parameters);
    if (!detailParameters.current) {
      throw new Error(
        'Historical official AFL player-detail capture is disabled until Gate 0A supports the full 2012-to-season retrieval scope.'
      );
    }
  }
  const season = 'season' in parameters ? parameters.season : request.authorizationSeason;
  if ('season' in parameters && parameters.season !== request.authorizationSeason) {
    throw new Error(
      `Capability ${request.capabilityId} season ${parameters.season} is outside the authorized season ${request.authorizationSeason}.`
    );
  }
  if (
    typeof season === 'number' &&
    capability.documentedMinimumSeason !== null &&
    season < capability.documentedMinimumSeason
  ) {
    throw new Error(
      `Capability ${request.capabilityId} is documented from season ${capability.documentedMinimumSeason}.`
    );
  }
  if (request.capabilityId === 'afl-tables-player-stats') {
    const aflTablesParameters = parameterSchemas['afl-tables-player-stats'].parse(parameters);
    if (aflTablesParameters.rescrape && aflTablesParameters.rescrapeStartSeason === null) {
      throw new Error('AFL Tables rescraping requires an explicit rescrapeStartSeason.');
    }
    if (
      aflTablesParameters.rescrape &&
      aflTablesParameters.rescrapeStartSeason !== request.authorizationSeason
    ) {
      throw new Error(
        'AFL Tables rescraping must start at the authorized season; broader source access requires a separately authorized capture.'
      );
    }
    if (!aflTablesParameters.rescrape && aflTablesParameters.rescrapeStartSeason !== null) {
      throw new Error('AFL Tables rescrapeStartSeason must be null when rescrape is disabled.');
    }
  }
  if (request.capabilityId === 'footywire-rising-star') {
    const risingStarParameters = parameterSchemas['footywire-rising-star'].parse(parameters);
    if (risingStarParameters.type === 'nominations' && risingStarParameters.roundNumber !== null) {
      throw new Error('Rising Star nomination capture does not accept a round number.');
    }
  }
  return { ...request, parameters };
}

function canonicalArguments(request: AflTradeFitzRoyCaptureRequest): Record<string, unknown> {
  const parameters = request.parameters;
  switch (request.capabilityId) {
    case 'official-afl-player-stats':
    case 'official-afl-results':
      return {
        season: parameters.season,
        round_number: parameters.roundNumber,
        comp: request.competition,
      };
    case 'afl-tables-player-stats':
      return {
        season: parameters.season,
        round_number: null,
        rescrape: parameters.rescrape,
        rescrape_start_season: parameters.rescrapeStartSeason,
      };
    case 'footywire-player-stats':
      return {
        season: parameters.season,
        round_number: null,
        check_existing: parameters.checkExisting,
      };
    case 'fryzigg-player-stats':
      return { season: parameters.season, round_number: null, comp: request.competition };
    case 'afl-tables-results':
      return { season: parameters.season, round_number: parameters.roundNumber };
    case 'official-afl-player-details':
      return {
        season: parameters.season,
        team: parameters.team,
        current: parameters.current,
        comp: request.competition,
        official_teams: parameters.officialTeams,
      };
    case 'afl-tables-player-details':
      return { team: parameters.team };
    case 'footywire-player-details':
      return { team: parameters.team, current: parameters.current };
    case 'aflca-coaches-votes':
      return {
        season: parameters.season,
        round_number: parameters.roundNumber,
        comp: request.competition,
        team: parameters.team,
      };
    case 'aflca-coaches-votes-scoped':
      return {
        season: parameters.season,
        round_number: parameters.roundNumbers,
        comp: request.competition,
        team: parameters.team,
        award_scope: parameters.awardScope,
      };
    case 'footywire-brownlow-awards':
    case 'footywire-all-australian':
      return { season: parameters.season, type: parameters.type };
    case 'footywire-rising-star':
      return {
        season: parameters.season,
        round_number: parameters.roundNumber,
        type: parameters.type,
      };
  }
}

export function createAflTradeFitzRoyInvocation(value: unknown): AflTradeFitzRoyInvocation {
  const request = parseAflTradeFitzRoyCaptureRequest(value);
  const capability = AFL_TRADE_FITZROY_CAPABILITIES.find(
    (candidate) => candidate.capabilityId === request.capabilityId
  );
  if (capability === undefined) {
    throw new Error(`Unknown fitzRoy capability ${request.capabilityId}.`);
  }
  return aflTradeFitzRoyInvocationSchema.parse({
    schemaVersion: AFL_TRADE_FITZROY_INVOCATION_SCHEMA_VERSION,
    capabilityId: request.capabilityId,
    fitzRoyVersion: AFL_TRADE_FITZROY_PINNED_VERSION,
    provider: capability.provider,
    directFunction: capability.directFunction,
    authorizationSeason: request.authorizationSeason,
    expectedCaptureOrigin: capability.captureOrigin,
    arguments: canonicalArguments(request),
  });
}

const diagnosticFieldSchema = z
  .object({
    name: z.string().min(1),
    classes: z.array(z.string().min(1)).min(1),
    storageType: z.string().min(1),
    missingCount: z.number().int().nonnegative(),
    nanCount: z.number().int().nonnegative(),
    positiveInfinityCount: z.number().int().nonnegative(),
    negativeInfinityCount: z.number().int().nonnegative(),
    levels: z.array(z.string()).nullable(),
    timezone: z.string().nullable(),
  })
  .strict();

export const aflTradeFitzRoyCaptureDiagnosticsSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_FITZROY_DIAGNOSTICS_SCHEMA_VERSION),
    capabilityId: capabilityIdSchema,
    fitzRoyVersion: z.literal(AFL_TRADE_FITZROY_PINNED_VERSION),
    directFunction: z.string().min(1),
    invocationSha256: z.string().regex(/^[a-f0-9]{64}$/),
    runtime: z
      .object({
        rVersion: z.literal('4.5.1'),
        platform: z.string().min(1),
        dependencyLockSha256: z.string().regex(/^[a-f0-9]{64}$/),
        imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      })
      .strict(),
    rowCount: z.number().int().nonnegative(),
    duplicateRowCount: z.number().int().nonnegative(),
    fields: z.array(diagnosticFieldSchema),
    observedSeasonValues: z.array(z.string()),
    observedRoundValues: z.array(z.string()),
    observedDateRange: z.tuple([z.string(), z.string()]).nullable(),
    originObservation: z.enum([
      'live_upstream',
      'cached_dataset',
      'cached_then_live_delta',
      'not_exposed_by_fitzroy',
    ]),
    conditions: z.array(
      z
        .object({ kind: z.enum(['message', 'warning']), message: z.string().min(1).max(4000) })
        .strict()
    ),
  })
  .strict()
  .superRefine((diagnostics, context) => {
    const names = diagnostics.fields.map((field) => field.name);
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: 'custom',
        path: ['fields'],
        message: 'Captured field names must be unique.',
      });
    }
    if (diagnostics.duplicateRowCount > diagnostics.rowCount) {
      context.addIssue({
        code: 'custom',
        path: ['duplicateRowCount'],
        message: 'Duplicate rows cannot exceed total rows.',
      });
    }
  });

export type AflTradeFitzRoyCaptureDiagnostics = z.infer<
  typeof aflTradeFitzRoyCaptureDiagnosticsSchema
>;

export function getAflTradeFitzRoyObservedScopeError(
  invocation: AflTradeFitzRoyInvocation,
  diagnostics: AflTradeFitzRoyCaptureDiagnostics
): string | null {
  const authorizedSeason = String(invocation.authorizationSeason);
  const observedDateYears = diagnostics.observedDateRange?.map((value) => value.slice(0, 4)) ?? [];
  const diagnosticFields = new Set(diagnostics.fields.map(({ name }) => name));
  const officialScopeIsRetainedForDecode =
    invocation.capabilityId === 'official-afl-player-stats' &&
    diagnostics.rowCount > 0 &&
    diagnosticFields.has('utcStartTime') &&
    diagnosticFields.has('compSeason.shortName');
  if (
    (diagnostics.observedSeasonValues.length === 0 &&
      observedDateYears.length === 0 &&
      !officialScopeIsRetainedForDecode) ||
    diagnostics.observedSeasonValues.some((value) => value !== authorizedSeason) ||
    observedDateYears.some((value) => value !== authorizedSeason)
  ) {
    return 'fitzRoy output does not provide season evidence wholly within the authorized season.';
  }
  const requestedRound = invocation.arguments.round_number;
  if (typeof requestedRound === 'number') {
    const observedRounds = diagnostics.observedRoundValues.map((value) => {
      const match = value.trim().match(/^(?:round|r)?\s*0*(\d+)$/i);
      return match === null ? null : Number(match[1]);
    });
    if (observedRounds.length === 0 || observedRounds.some((round) => round !== requestedRound)) {
      return 'fitzRoy output round evidence falls outside the authorized requested round.';
    }
  }
  return null;
}

export function createAflTradeFitzRoySchemaFingerprint(
  diagnostics: AflTradeFitzRoyCaptureDiagnostics
): string {
  const schemaEvidence = {
    fields: diagnostics.fields.map(({ name, classes, storageType, levels, timezone }) => ({
      name,
      classes,
      storageType,
      levels,
      timezone,
    })),
  };
  return `sha256:${createHash('sha256')
    .update(canonicalizeAflTradeJson(schemaEvidence))
    .digest('hex')}`;
}
