import { z } from 'zod';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const imageDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const artifactIdSchema = z.string().regex(/^artifact:[a-f0-9]{64}$/);
const positiveInteger = z.coerce.number().int().positive();
const deployedEnvironmentSchema = z.enum(['non_production', 'production']);

const configSchema = z
  .object({
    environment: deployedEnvironmentSchema,
    databaseUrl: z
      .string()
      .url()
      .refine((value) => value.startsWith('postgresql://')),
    redisUrl: z
      .string()
      .url()
      .refine((value) => value.startsWith('redis')),
    egressEndpoint: z
      .string()
      .url()
      .refine((value) => value.startsWith('https://')),
    egressBearerToken: z.string().min(20),
    egressPublicKeys: z.record(z.string().min(1), z.string().min(1)),
    egressPolicyEvidenceIds: z.array(artifactIdSchema).min(1),
    objectStorage: z
      .object({
        region: z.string().min(1),
        bucket: z.string().min(3),
        keyPrefix: z.string().min(1),
        kmsKeyId: z.string().min(1),
        repositoryId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
        infrastructureEvidenceIds: z.array(artifactIdSchema).min(1),
        allowedJurisdictions: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    runtimeIdentity: z
      .object({
        rVersion: z.literal('4.5.1'),
        dependencyLockSha256: sha256Schema,
        imageDigest: imageDigestSchema,
      })
      .strict(),
    rscriptPath: z.string().min(1),
    limits: z
      .object({
        captureTimeoutMs: positiveInteger.max(24 * 60 * 60 * 1_000),
        decoderTimeoutMs: positiveInteger.max(24 * 60 * 60 * 1_000),
        maximumSourceBytes: positiveInteger,
        maximumDiagnosticsBytes: positiveInteger,
        maximumRows: positiveInteger,
        maximumFields: positiveInteger,
        maximumCells: positiveInteger,
        maximumCellBytes: positiveInteger,
        maximumOutputBytes: positiveInteger,
        rawRetentionDays: positiveInteger,
        metadataRetentionDays: positiveInteger,
      })
      .strict(),
  })
  .strict();

export type AflTradeProviderIngestionConfig = z.infer<typeof configSchema>;

function required(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new TypeError(`${name} is required for deployed provider ingestion.`);
  }
  return value;
}

function parseJsonRecord(value: string, name: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (cause) {
    throw new TypeError(`${name} must be a JSON object.`, { cause });
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((entry) => typeof entry !== 'string')
  ) {
    throw new TypeError(`${name} must map key identifiers to string values.`);
  }
  return parsed as Record<string, string>;
}

function csv(value: string): string[] {
  const values = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort();
  if (new Set(values).size !== values.length) {
    throw new TypeError('Comma-separated provider-ingestion configuration must be unique.');
  }
  return values;
}

export function parseAflTradeProviderIngestionConfig(
  env: Readonly<Record<string, string | undefined>>
): AflTradeProviderIngestionConfig {
  return configSchema.parse({
    environment: required(env, 'AFL_TRADE_CAPTURE_ENVIRONMENT'),
    databaseUrl: required(env, 'AFL_OUTCOMES_DATABASE_URL'),
    redisUrl: required(env, 'AFL_TRADE_CAPTURE_REDIS_URL'),
    egressEndpoint: required(env, 'AFL_TRADE_FITZROY_EGRESS_ENDPOINT'),
    egressBearerToken: required(env, 'AFL_TRADE_FITZROY_EGRESS_BEARER_TOKEN'),
    egressPublicKeys: parseJsonRecord(
      required(env, 'AFL_TRADE_FITZROY_EGRESS_PUBLIC_KEYS_JSON'),
      'AFL_TRADE_FITZROY_EGRESS_PUBLIC_KEYS_JSON'
    ),
    egressPolicyEvidenceIds: csv(required(env, 'AFL_TRADE_FITZROY_EGRESS_POLICY_EVIDENCE_IDS')),
    objectStorage: {
      region: required(env, 'AFL_TRADE_OBJECT_REGION'),
      bucket: required(env, 'AFL_TRADE_OBJECT_BUCKET'),
      keyPrefix: required(env, 'AFL_TRADE_OBJECT_PREFIX'),
      kmsKeyId: required(env, 'AFL_TRADE_OBJECT_KMS_KEY_ID'),
      repositoryId: required(env, 'AFL_TRADE_CAPTURE_REPOSITORY_ID'),
      infrastructureEvidenceIds: csv(
        required(env, 'AFL_TRADE_CAPTURE_INFRASTRUCTURE_EVIDENCE_IDS')
      ),
      allowedJurisdictions: csv(required(env, 'AFL_TRADE_CAPTURE_ALLOWED_JURISDICTIONS')),
    },
    runtimeIdentity: {
      rVersion: required(env, 'AFL_TRADE_FITZROY_R_VERSION'),
      dependencyLockSha256: required(env, 'AFL_TRADE_FITZROY_LOCK_SHA256'),
      imageDigest: required(env, 'AFL_TRADE_FITZROY_IMAGE_DIGEST'),
    },
    rscriptPath: required(env, 'AFL_TRADE_FITZROY_RSCRIPT_PATH'),
    limits: {
      captureTimeoutMs: required(env, 'AFL_TRADE_FITZROY_CAPTURE_TIMEOUT_MS'),
      decoderTimeoutMs: required(env, 'AFL_TRADE_FITZROY_DECODER_TIMEOUT_MS'),
      maximumSourceBytes: required(env, 'AFL_TRADE_FITZROY_MAX_SOURCE_BYTES'),
      maximumDiagnosticsBytes: required(env, 'AFL_TRADE_FITZROY_MAX_DIAGNOSTICS_BYTES'),
      maximumRows: required(env, 'AFL_TRADE_FITZROY_MAX_ROWS'),
      maximumFields: required(env, 'AFL_TRADE_FITZROY_MAX_FIELDS'),
      maximumCells: required(env, 'AFL_TRADE_FITZROY_MAX_CELLS'),
      maximumCellBytes: required(env, 'AFL_TRADE_FITZROY_MAX_CELL_BYTES'),
      maximumOutputBytes: required(env, 'AFL_TRADE_FITZROY_MAX_OUTPUT_BYTES'),
      rawRetentionDays: required(env, 'AFL_TRADE_FITZROY_RAW_RETENTION_DAYS'),
      metadataRetentionDays: required(env, 'AFL_TRADE_FITZROY_METADATA_RETENTION_DAYS'),
    },
  });
}
