import { z } from 'zod';

const artifactIdSchema = z.string().regex(/^artifact:[a-f0-9]{64}$/);
const positiveInteger = z.coerce.number().int().positive();
const deployedEnvironmentSchema = z.enum(['non_production', 'production']);

const providerPolicySchema = z
  .object({
    requests: positiveInteger,
    perSeconds: positiveInteger,
    burst: positiveInteger,
    cacheSeconds: positiveInteger,
    maximumLeaseMs: positiveInteger.max(24 * 60 * 60 * 1_000),
    egressPolicyEvidenceId: artifactIdSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.burst < policy.requests) {
      context.addIssue({
        code: 'custom',
        path: ['burst'],
        message: 'Provider burst must be at least the reviewed request count.',
      });
    }
  });

const rawConfigSchema = z
  .object({
    environment: deployedEnvironmentSchema,
    databaseUrl: z.string().url().startsWith('postgresql://'),
    redisUrl: z
      .string()
      .url()
      .refine((value) => /^rediss?:\/\//.test(value)),
    objectStorage: z
      .object({
        region: z.string().trim().min(1),
        bucket: z.string().trim().min(3),
        keyPrefix: z.string().trim().min(1),
        kmsKeyId: z.string().trim().min(1),
        repositoryId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
        infrastructureEvidenceIds: z.array(artifactIdSchema).min(1),
        allowedJurisdictions: z.array(z.string().trim().min(1)).min(1),
      })
      .strict(),
    userAgent: z
      .string()
      .trim()
      .min(20)
      .max(500)
      .regex(/contact\s*:/i),
    limits: z
      .object({
        timeoutMs: positiveInteger.max(120_000),
        maximumSourceBytes: positiveInteger.max(128 * 1024 * 1024),
        rawRetentionDays: positiveInteger,
      })
      .strict(),
    providerPolicies: z
      .object({
        draftguru: providerPolicySchema,
        footywire: providerPolicySchema,
        official_afl: providerPolicySchema,
      })
      .strict(),
  })
  .strict()
  .transform((config) => ({
    ...config,
    providerPolicies: Object.fromEntries(
      Object.entries(config.providerPolicies).map(([provider, policy]) => [
        provider,
        {
          upstreamRate: {
            requests: policy.requests,
            perSeconds: policy.perSeconds,
            burst: policy.burst,
          },
          cacheSeconds: policy.cacheSeconds,
          maximumLeaseMs: policy.maximumLeaseMs,
          egressPolicyEvidenceId: policy.egressPolicyEvidenceId,
        },
      ])
    ) as {
      draftguru: {
        upstreamRate: { requests: number; perSeconds: number; burst: number };
        cacheSeconds: number;
        maximumLeaseMs: number;
        egressPolicyEvidenceId: string;
      };
      footywire: {
        upstreamRate: { requests: number; perSeconds: number; burst: number };
        cacheSeconds: number;
        maximumLeaseMs: number;
        egressPolicyEvidenceId: string;
      };
      official_afl: {
        upstreamRate: { requests: number; perSeconds: number; burst: number };
        cacheSeconds: number;
        maximumLeaseMs: number;
        egressPolicyEvidenceId: string;
      };
    },
  }));

export type AflTradeExternalIngestionConfig = z.infer<typeof rawConfigSchema>;

function required(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for deployed external-source ingestion.`);
  return value;
}

function csv(value: string): string[] {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort();
  if (entries.length === 0 || new Set(entries).size !== entries.length) {
    throw new TypeError(
      'Comma-separated external ingestion settings must be non-empty and unique.'
    );
  }
  return entries;
}

function parsePolicies(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (cause) {
    throw new TypeError('AFL_TRADE_EXTERNAL_SOURCE_POLICIES_JSON must be valid JSON.', { cause });
  }
}

export function parseAflTradeExternalIngestionConfig(
  env: Readonly<Record<string, string | undefined>>
): AflTradeExternalIngestionConfig {
  return rawConfigSchema.parse({
    environment: required(env, 'AFL_TRADE_CAPTURE_ENVIRONMENT'),
    databaseUrl: required(env, 'AFL_OUTCOMES_DATABASE_URL'),
    redisUrl: required(env, 'AFL_TRADE_CAPTURE_REDIS_URL'),
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
    userAgent: required(env, 'AFL_TRADE_EXTERNAL_USER_AGENT'),
    limits: {
      timeoutMs: required(env, 'AFL_TRADE_EXTERNAL_TIMEOUT_MS'),
      maximumSourceBytes: required(env, 'AFL_TRADE_EXTERNAL_MAX_SOURCE_BYTES'),
      rawRetentionDays: required(env, 'AFL_TRADE_EXTERNAL_RAW_RETENTION_DAYS'),
    },
    providerPolicies: parsePolicies(required(env, 'AFL_TRADE_EXTERNAL_SOURCE_POLICIES_JSON')),
  });
}
