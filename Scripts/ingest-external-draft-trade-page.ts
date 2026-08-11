import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { z } from 'zod';

import {
  createAflTradeExternalIngestionRuntime,
  type AflTradeExternalIngestionRuntime,
} from '../src/server/aflTradeIntelligence/runtime/externalDraftTradeIngestionRuntime';
import {
  parseAflTradeExternalIngestionConfig,
  type AflTradeExternalIngestionConfig,
} from '../src/server/aflTradeIntelligence/runtime/externalDraftTradeIngestionConfig';
import {
  parseIngestAflTradeExternalPageRequest,
  type IngestAflTradeExternalPageRequest,
} from '../src/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import type { AflTradeExternalProviderIngestionCommand } from '../src/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';
import {
  AFL_TRADE_SOURCE_OPERATIONS,
  AFL_TRADE_SOURCE_USES,
} from '../src/server/aflTradeIntelligence/source/sourceRights';

const captureInputSchema = z
  .object({
    environment: z.enum(['non_production', 'production']),
    provider: z.enum(['draftguru', 'footywire', 'official_afl']),
    competition: z.literal('AFLM'),
    anchorSeasonYear: z.number().int().min(1897).max(2200),
    discoveryFromSeasonYear: z.number().int().min(1988).max(2200).nullable().optional(),
    draftPathway: z.enum(['national', 'rookie', 'pre_season', 'mid_season']).nullable(),
    dataset: z.string().trim().min(1).max(160),
    datasetVersion: z.string().trim().min(1).max(160),
    accessMechanism: z.literal('automated_web'),
    capabilityId: z.enum([
      'draftguru-trade-index',
      'draftguru-trade-detail',
      'draftguru-year-page',
      'footywire-draft-results',
      'official-afl-indicative-draft-order',
    ]),
    sourceUrl: z.string().url().startsWith('https://').max(2_048),
    effectiveAt: z.iso.datetime({ offset: true }),
    parserVersion: z.string().trim().min(1).max(160),
    fieldManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    maximumBytes: z
      .number()
      .int()
      .positive()
      .max(128 * 1024 * 1024),
  })
  .strict()
  .superRefine((request, context) => {
    const providerByCapability = {
      'draftguru-trade-index': 'draftguru',
      'draftguru-trade-detail': 'draftguru',
      'draftguru-year-page': 'draftguru',
      'footywire-draft-results': 'footywire',
      'official-afl-indicative-draft-order': 'official_afl',
    } as const;
    if (providerByCapability[request.capabilityId] !== request.provider) {
      context.addIssue({
        code: 'custom',
        path: ['provider'],
        message: 'External provider must match the selected capability.',
      });
    }
  });

const gateInputSchema = z
  .object({
    decisionKey: z.string().trim().min(1).max(200),
    environment: z.enum(['non_production', 'production']),
    rightsArtifactId: z.string().regex(/^source-rights:[a-f0-9]{64}$/),
    competition: z.literal('AFLM'),
    season: z.number().int().min(1897).max(2200),
    accessMechanism: z.literal('automated_web'),
    capabilityId: z.null(),
    geography: z.string().trim().min(1).max(100),
    commercialContext: z.string().trim().min(1).max(100),
    audience: z.string().trim().min(1).max(100),
    operations: z.array(z.enum(AFL_TRADE_SOURCE_OPERATIONS)).min(1),
    fieldUses: z
      .array(
        z
          .object({
            sourceField: z.string().trim().min(1).max(300),
            use: z.enum(AFL_TRADE_SOURCE_USES),
          })
          .strict()
      )
      .min(1),
    rawRetentionDays: z.number().int().positive().nullable(),
    metadataRetentionDays: z.number().int().positive().nullable(),
    cacheSeconds: z.number().int().positive().nullable(),
  })
  .strict();

function inputPath(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== '--input' || argv[1]?.trim() === '') {
    throw new TypeError('The command requires exactly one --input <reviewed-json-path>.');
  }
  return argv[1];
}

function parseCommand(
  json: string,
  now: string,
  configuredEnvironment: AflTradeExternalIngestionConfig['environment']
): AflTradeExternalProviderIngestionCommand {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (cause) {
    throw new TypeError('The external-source ingestion command is not valid JSON.', { cause });
  }
  const envelope = z
    .object({ request: z.unknown(), gateRequest: z.unknown() })
    .strict()
    .parse(value);
  const request = parseIngestAflTradeExternalPageRequest({
    ...captureInputSchema.parse(envelope.request),
    capturedAt: now,
  });
  const gateRequest = { ...gateInputSchema.parse(envelope.gateRequest), evaluatedAt: now };
  if (
    request.environment !== configuredEnvironment ||
    gateRequest.environment !== configuredEnvironment ||
    gateRequest.decisionKey !== `${request.capabilityId}-${configuredEnvironment}` ||
    gateRequest.season !== request.anchorSeasonYear
  ) {
    throw new TypeError(
      'Gate decision key, season and request environment must match the configured authority environment and exact capture capability.'
    );
  }
  return { request, gateRequest };
}

export async function runAflTradeExternalIngestionCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  readInput?: (path: string) => Promise<string>;
  writeOutput?: (line: string) => void;
  now?: () => string;
  createRuntime?: (config: AflTradeExternalIngestionConfig) => AflTradeExternalIngestionRuntime;
}) {
  const config = parseAflTradeExternalIngestionConfig(input.env);
  const now = (input.now ?? (() => new Date().toISOString()))();
  const command = parseCommand(
    await (input.readInput ?? ((path) => readFile(path, 'utf8')))(inputPath(input.argv)),
    now,
    config.environment
  );
  const runtime = (input.createRuntime ?? createAflTradeExternalIngestionRuntime)(config);
  try {
    const result = await runtime.ingest(command);
    const output =
      result.status === 'deferred'
        ? result
        : result.result.status === 'not_modified'
          ? { status: 'completed' as const, captureStatus: 'not_modified' as const }
          : {
              status: result.status,
              captureStatus: result.result.status,
              captureId: result.result.captureId,
              batchId: result.result.batchId,
              idempotentReplay: result.result.idempotentReplay,
            };
    (input.writeOutput ?? ((line) => process.stdout.write(`${line}\n`)))(JSON.stringify(output));
    return output;
  } finally {
    await runtime.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runAflTradeExternalIngestionCommand({ argv: process.argv.slice(2), env: process.env }).catch(
    () => {
      process.stderr.write(
        'External AFL draft/trade source ingestion failed; no capture or publication was assumed.\n'
      );
      process.exitCode = 1;
    }
  );
}
