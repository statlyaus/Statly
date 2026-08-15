import { Buffer } from 'node:buffer';
import { isAbsolute } from 'node:path';

import { z } from 'zod';

const immutableReferenceSchema = z.string().regex(/^[a-z][a-z0-9-]*:[a-f0-9]{64}$/);
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

const postgresUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .superRefine((value, context) => {
    try {
      const protocol = new URL(value).protocol;
      if (protocol !== 'postgres:' && protocol !== 'postgresql:') throw new Error();
    } catch {
      context.addIssue({ code: 'custom', message: 'A PostgreSQL connection URL is required.' });
    }
  });

const cursorSecretSchema = z
  .string()
  .trim()
  .superRefine((value, context) => {
    const bytes = Buffer.from(value, 'base64');
    if (bytes.byteLength < 32 || bytes.toString('base64') !== value) {
      context.addIssue({
        code: 'custom',
        message: 'A canonical base64 cursor secret of at least 32 bytes is required.',
      });
    }
  })
  .transform((value) => new Uint8Array(Buffer.from(value, 'base64')));

const sharedPostgresConfigSchema = z.object({
  AFL_TRADE_PUBLIC_READ_MODE: z.literal('postgres'),
  AFL_OUTCOMES_DATABASE_URL: postgresUrlSchema,
  AFL_OUTCOMES_CURSOR_HMAC_SECRET_B64: cursorSecretSchema,
});

const localArtifactRootSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .superRefine((value, context) => {
    if (!isAbsolute(value)) {
      context.addIssue({ code: 'custom', message: 'An absolute local artifact root is required.' });
    }
  });

const localPostgresConfigSchema = sharedPostgresConfigSchema
  .extend({
    AFL_TRADE_PUBLIC_READ_ENVIRONMENT: z.literal('test_fixture'),
    AFL_TRADE_LOCAL_ARTIFACT_ROOT: localArtifactRootSchema,
  })
  .transform((value) => ({
    mode: value.AFL_TRADE_PUBLIC_READ_MODE,
    environment: value.AFL_TRADE_PUBLIC_READ_ENVIRONMENT,
    databaseUrl: value.AFL_OUTCOMES_DATABASE_URL,
    cursorSecret: value.AFL_OUTCOMES_CURSOR_HMAC_SECRET_B64,
    artifactStorage: {
      kind: 'local_filesystem' as const,
      rootDirectory: value.AFL_TRADE_LOCAL_ARTIFACT_ROOT,
    },
  }));

const hostedPostgresConfigSchema = sharedPostgresConfigSchema
  .extend({
    AFL_TRADE_PUBLIC_READ_ENVIRONMENT: z.enum(['non_production', 'production']),
    AFL_TRADE_OBJECT_BUCKET: z
      .string()
      .trim()
      .min(3)
      .max(63)
      .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/),
    AFL_TRADE_OBJECT_PREFIX: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9!_.*'()/-]*$/),
    AFL_TRADE_OBJECT_KMS_KEY_ID: z.string().trim().min(1).max(2_048),
    AFL_TRADE_OBJECT_REPOSITORY_ID: publicIdSchema,
    AFL_TRADE_OBJECT_POLICY_EVIDENCE_ID: immutableReferenceSchema,
    AWS_REGION: z
      .string()
      .trim()
      .min(3)
      .max(64)
      .regex(/^[a-z]{2}(?:-gov)?-[a-z0-9-]+-\d+$/),
  })
  .transform((value) => ({
    mode: value.AFL_TRADE_PUBLIC_READ_MODE,
    environment: value.AFL_TRADE_PUBLIC_READ_ENVIRONMENT,
    databaseUrl: value.AFL_OUTCOMES_DATABASE_URL,
    cursorSecret: value.AFL_OUTCOMES_CURSOR_HMAC_SECRET_B64,
    artifactStorage: {
      kind: 's3' as const,
      bucket: value.AFL_TRADE_OBJECT_BUCKET,
      keyPrefix: value.AFL_TRADE_OBJECT_PREFIX,
      kmsKeyId: value.AFL_TRADE_OBJECT_KMS_KEY_ID,
      policyEvidenceId: value.AFL_TRADE_OBJECT_POLICY_EVIDENCE_ID,
      region: value.AWS_REGION,
      repositoryId: value.AFL_TRADE_OBJECT_REPOSITORY_ID,
    },
  }));

export type AflTradePublicReadConfig =
  | { readonly mode: 'disabled' }
  | z.output<typeof localPostgresConfigSchema>
  | z.output<typeof hostedPostgresConfigSchema>;

export function parseAflTradePublicReadConfig(
  environment: Readonly<Record<string, string | undefined>>
): AflTradePublicReadConfig {
  if (
    environment.AFL_TRADE_PUBLIC_READ_MODE === undefined ||
    environment.AFL_TRADE_PUBLIC_READ_MODE === 'disabled'
  ) {
    return { mode: 'disabled' };
  }

  const schema =
    environment.AFL_TRADE_PUBLIC_READ_ENVIRONMENT === 'test_fixture'
      ? localPostgresConfigSchema
      : hostedPostgresConfigSchema;
  const parsed = schema.safeParse(environment);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))]
      .filter(Boolean)
      .sort()
      .join(', ');
    throw new Error(
      `Invalid AFL trade public read configuration${fields.length > 0 ? `: ${fields}` : '.'}`
    );
  }
  return parsed.data;
}
