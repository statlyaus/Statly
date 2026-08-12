import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { z } from 'zod';

import { parseAflTradeProviderIngestionConfig } from '../src/server/aflTradeIntelligence/runtime/providerIngestionConfig';
import {
  createAflTradeProviderIngestionRuntime,
  type AflTradeProviderIngestionRuntime,
  type AflTradeDeployedProviderIngestionCommand,
} from '../src/server/aflTradeIntelligence/runtime/providerIngestionRuntime';
import type { AflTradeProviderIngestionConfig } from '../src/server/aflTradeIntelligence/runtime/providerIngestionConfig';
import { parseAflTradeFitzRoyCaptureRequest } from '../src/server/aflTradeIntelligence/source/fitzRoyCaptureContracts';
import { parseAflTradeFitzRoyFieldMap } from '../src/server/aflTradeIntelligence/source/fitzRoyObservationContracts';
import {
  AFL_TRADE_SOURCE_OPERATIONS,
  AFL_TRADE_SOURCE_USES,
} from '../src/server/aflTradeIntelligence/source/sourceRights';

const gateRequestSchema = z
  .object({
    decisionKey: z.string().trim().min(1).max(200),
    environment: z.enum(['non_production', 'production']),
    rightsArtifactId: z.string().regex(/^source-rights:[a-f0-9]{64}$/),
    competition: z.string().trim().min(1).max(100),
    season: z.number().int().min(1897).max(2200),
    accessMechanism: z.enum(['provider_api', 'automated_web']),
    capabilityId: z.string().trim().min(1).max(200),
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

function parseInputPath(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== '--input' || argv[1]?.trim() === '') {
    throw new TypeError('The command requires exactly one --input <reviewed-json-path>.');
  }
  return argv[1];
}

function parseCommand(
  json: string,
  configuredEnvironment: AflTradeProviderIngestionConfig['environment']
): AflTradeDeployedProviderIngestionCommand {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new TypeError('The provider-ingestion command is not valid JSON.', { cause });
  }
  const envelope = z
    .object({
      capture: z
        .object({
          gateRequest: z.unknown(),
          captureRequest: z.unknown(),
        })
        .strict(),
      fieldMapId: z.string().trim().min(1).max(300),
      fieldMap: z.unknown(),
      effectiveAt: z.iso.datetime({ offset: true }),
    })
    .strict()
    .parse(parsed);
  const captureRequest = parseAflTradeFitzRoyCaptureRequest(envelope.capture.captureRequest);
  const gateRequest = gateRequestSchema.parse(envelope.capture.gateRequest);
  if (
    gateRequest.capabilityId !== captureRequest.capabilityId ||
    gateRequest.competition !== captureRequest.competition ||
    gateRequest.season !== captureRequest.authorizationSeason
  ) {
    throw new TypeError('The Gate and capture requests must identify the same capability scope.');
  }
  if (
    gateRequest.environment !== configuredEnvironment ||
    gateRequest.decisionKey !== `${captureRequest.capabilityId}-${configuredEnvironment}`
  ) {
    throw new TypeError(
      'The Gate decision key and environment must match the configured authority environment.'
    );
  }
  return {
    capture: { gateRequest, captureRequest },
    fieldMapId: envelope.fieldMapId,
    fieldMap: parseAflTradeFitzRoyFieldMap(envelope.fieldMap),
    effectiveAt: new Date(envelope.effectiveAt).toISOString(),
  };
}

export async function runAflTradeFitzRoyProviderIngestionCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  readInput?: (path: string) => Promise<string>;
  writeOutput?: (line: string) => void;
  createRuntime?: (config: AflTradeProviderIngestionConfig) => AflTradeProviderIngestionRuntime;
}) {
  const inputPath = parseInputPath(input.argv);
  const config = parseAflTradeProviderIngestionConfig(input.env);
  const command = parseCommand(
    await (input.readInput ?? ((path) => readFile(path, 'utf8')))(inputPath),
    config.environment
  );
  const runtime = (input.createRuntime ?? createAflTradeProviderIngestionRuntime)(config);
  try {
    const result = await runtime.ingest(command);
    const output = {
      captureReceiptId: result.receipt.captureReceiptId,
      snapshotId: result.snapshotId,
      sourceCaptureId: result.staging.capture.captureId,
      normalizationRunId: result.staging.normalization.normalizationRunId,
      normalizationStatus: result.staging.normalization.status,
      idempotentReplay:
        result.staging.capture.idempotentReplay && result.staging.normalization.idempotentReplay,
    };
    (input.writeOutput ?? ((line) => process.stdout.write(`${line}\n`)))(JSON.stringify(output));
    return output;
  } finally {
    await runtime.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runAflTradeFitzRoyProviderIngestionCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'AFL trade provider ingestion failed; no source capture or publication was assumed.\n'
    );
    process.exitCode = 1;
  });
}
