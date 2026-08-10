import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';
import { z } from 'zod';

import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createAflTradeExternalIngestionRuntime,
  type AflTradeExternalIngestionRuntime,
} from '../src/server/aflTradeIntelligence/runtime/externalDraftTradeIngestionRuntime';
import {
  parseAflTradeExternalIngestionConfig,
  type AflTradeExternalIngestionConfig,
} from '../src/server/aflTradeIntelligence/runtime/externalDraftTradeIngestionConfig';
import { createAflTradeExternalHistoricalCapturePlan } from '../src/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';
import { parseIngestAflTradeExternalPageRequest } from '../src/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import type { AflTradeExternalProviderIngestionCommand } from '../src/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';
import { PostgresAflTradeExternalDiscoveryRepository } from '../src/server/aflTradeIntelligence/source/postgresExternalDraftTradeDiscoveryRepository';
import {
  AFL_TRADE_SOURCE_OPERATIONS,
  AFL_TRADE_SOURCE_USES,
} from '../src/server/aflTradeIntelligence/source/sourceRights';

const instantSchema = z.iso.datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const sourceRightsIdSchema = z.string().regex(/^source-rights:[a-f0-9]{64}$/);
const fieldUseSchema = z
  .object({ sourceField: z.string().trim().min(1).max(300), use: z.enum(AFL_TRADE_SOURCE_USES) })
  .strict();

const gateRequestSchema = z
  .object({
    decisionKey: z.string().trim().min(1).max(200),
    environment: z.literal('production'),
    rightsArtifactId: sourceRightsIdSchema,
    competition: z.literal('AFLM'),
    season: z.number().int().min(1988).max(2200),
    accessMechanism: z.literal('automated_web'),
    capabilityId: z.null(),
    geography: z.string().trim().min(1).max(100),
    commercialContext: z.string().trim().min(1).max(100),
    audience: z.string().trim().min(1).max(100),
    operations: z.array(z.enum(AFL_TRADE_SOURCE_OPERATIONS)).min(1),
    fieldUses: z.array(fieldUseSchema).min(1),
    rawRetentionDays: z.number().int().positive().nullable(),
    metadataRetentionDays: z.number().int().positive().nullable(),
    cacheSeconds: z.number().int().positive().nullable(),
  })
  .strict();

const planAuthoritySchema = z
  .object({
    rightsArtifactId: sourceRightsIdSchema,
    fieldUses: z
      .array(
        z
          .object({
            sourceField: z.string().trim().min(1).max(300),
            use: z.literal('archive_fact'),
          })
          .strict()
      )
      .min(1),
    cacheSeconds: z.number().int().positive(),
    rawRetentionDays: z.number().int().positive(),
  })
  .strict();

const inputSchema = z
  .object({
    index: z
      .object({
        request: z
          .object({
            environment: z.literal('production'),
            provider: z.literal('draftguru'),
            competition: z.literal('AFLM'),
            anchorSeasonYear: z.number().int().min(1988).max(2200),
            discoveryFromSeasonYear: z.number().int().min(1988).max(2200),
            draftPathway: z.null(),
            dataset: z.string().trim().min(1).max(160),
            datasetVersion: z.string().trim().min(1).max(160),
            accessMechanism: z.literal('automated_web'),
            capabilityId: z.literal('draftguru-trade-index'),
            sourceUrl: z.enum([
              'https://www.draftguru.com.au/trades',
              'https://www.draftguru.com.au/trades/',
            ]),
            effectiveAt: instantSchema,
            parserVersion: z.string().trim().min(1).max(160),
            fieldManifestSha256: sha256Schema,
            maximumBytes: z
              .number()
              .int()
              .positive()
              .max(128 * 1024 * 1024),
          })
          .strict(),
        gateRequest: gateRequestSchema,
      })
      .strict(),
    plan: z
      .object({
        plannedAt: instantSchema,
        parserVersions: z
          .object({ tradeDetail: z.string().trim().min(1), yearPage: z.string().trim().min(1) })
          .strict(),
        datasetVersions: z
          .object({ tradeDetail: z.string().trim().min(1), yearPage: z.string().trim().min(1) })
          .strict(),
        fieldManifestSha256: z
          .object({ tradeDetail: sha256Schema, yearPage: sha256Schema })
          .strict(),
        authorities: z
          .object({ tradeDetail: planAuthoritySchema, yearPage: planAuthoritySchema })
          .strict(),
        execution: z
          .object({
            maximumAttempts: z.number().int().min(1).max(20),
            leaseSeconds: z.number().int().positive().max(86_400),
            retryBaseSeconds: z.number().int().positive().max(86_400),
            retryMaximumSeconds: z.number().int().positive().max(604_800),
            maximumLatenessSeconds: z.number().int().nonnegative().max(2_592_000),
            circuitFailureThreshold: z.number().int().positive().max(100),
            circuitResetSeconds: z.number().int().positive().max(604_800),
          })
          .strict(),
        maximumBytes: z
          .number()
          .int()
          .positive()
          .max(128 * 1024 * 1024),
      })
      .strict(),
  })
  .strict()
  .superRefine((input, context) => {
    const request = input.index.request;
    if (
      request.discoveryFromSeasonYear > request.anchorSeasonYear ||
      request.anchorSeasonYear - request.discoveryFromSeasonYear > 100 ||
      input.index.gateRequest.decisionKey !== 'draftguru-trade-index-production' ||
      input.index.gateRequest.season !== request.anchorSeasonYear ||
      input.index.gateRequest.rightsArtifactId ===
        input.plan.authorities.tradeDetail.rightsArtifactId ||
      input.index.gateRequest.rightsArtifactId === input.plan.authorities.yearPage.rightsArtifactId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Discovery range and capability-specific Gate authorities must be exact.',
      });
    }
  });

type DiscoveryInput = z.infer<typeof inputSchema>;

function inputPath(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== '--input' || argv[1]?.trim() === '') {
    throw new TypeError('Historical discovery requires exactly one --input <reviewed-json-path>.');
  }
  return argv[1];
}

function parseInput(json: string): DiscoveryInput {
  try {
    return inputSchema.parse(JSON.parse(json));
  } catch (cause) {
    throw new TypeError('Historical discovery input is invalid or not exact.', { cause });
  }
}

export async function runAflTradeExternalHistoricalDiscoveryCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  readInput?: (path: string) => Promise<string>;
  writeOutput?: (line: string) => void;
  now?: () => string;
  createRuntime?: (config: AflTradeExternalIngestionConfig) => AflTradeExternalIngestionRuntime;
  createPool?: (databaseUrl: string) => Pool;
  createRepository?: (
    pool: Pool
  ) => Pick<
    PostgresAflTradeExternalDiscoveryRepository,
    'findLatestFinalizedIndexBatch' | 'loadInventoryFromBatch' | 'persistInventory' | 'persistPlan'
  >;
}) {
  const config = parseAflTradeExternalIngestionConfig(input.env);
  const reviewed = parseInput(
    await (input.readInput ?? ((path) => readFile(path, 'utf8')))(inputPath(input.argv))
  );
  const evaluatedAt = (input.now ?? (() => new Date().toISOString()))();
  const request = parseIngestAflTradeExternalPageRequest({
    ...reviewed.index.request,
    capturedAt: evaluatedAt,
  });
  const command: AflTradeExternalProviderIngestionCommand = {
    request,
    gateRequest: { ...reviewed.index.gateRequest, evaluatedAt },
  };
  const runtime = (input.createRuntime ?? createAflTradeExternalIngestionRuntime)(config);
  const pool = (input.createPool ?? ((databaseUrl) => new Pool({ connectionString: databaseUrl })))(
    config.databaseUrl
  );
  const repository = input.createRepository
    ? input.createRepository(pool)
    : new PostgresAflTradeExternalDiscoveryRepository(createPgAflOutcomeSqlClient(pool));
  try {
    const capture = await runtime.ingest(command);
    if (capture.status === 'deferred') {
      const output = { status: 'deferred' as const, retryAt: capture.retryAt };
      (input.writeOutput ?? ((line) => process.stdout.write(`${line}\n`)))(JSON.stringify(output));
      return output;
    }
    const batchId = await repository.findLatestFinalizedIndexBatch({
      environment: 'production',
      fromYear: request.discoveryFromSeasonYear!,
      throughYear: request.anchorSeasonYear,
    });
    const inventory = await repository.loadInventoryFromBatch({
      batchId,
      fromYear: request.discoveryFromSeasonYear!,
      throughYear: request.anchorSeasonYear,
    });
    const inventoryReceipt = await repository.persistInventory(inventory);
    const plan = createAflTradeExternalHistoricalCapturePlan({
      inventory,
      ...reviewed.plan,
    });
    const planReceipt = await repository.persistPlan(plan);
    const output = {
      status: 'planned' as const,
      captureStatus: capture.result.status,
      batchId,
      inventory: inventoryReceipt,
      plan: planReceipt,
    };
    (input.writeOutput ?? ((line) => process.stdout.write(`${line}\n`)))(JSON.stringify(output));
    return output;
  } finally {
    await Promise.allSettled([runtime.close(), pool.end()]);
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runAflTradeExternalHistoricalDiscoveryCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'External historical discovery failed; no reconciliation, promotion, release or publication was assumed.\n'
    );
    process.exitCode = 1;
  });
}
