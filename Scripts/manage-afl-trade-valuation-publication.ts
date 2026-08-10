import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { S3Client } from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import { z } from 'zod';

import { createAflTradeArtifactCustodyProfile } from '../src/server/aflTradeIntelligence/artifacts/artifactCustodyProfile';
import { createAflTradeDurableObjectArtifactRepository } from '../src/server/aflTradeIntelligence/artifacts/durableObjectArtifactRepository';
import { createAflTradeS3ConditionalObjectStore } from '../src/server/aflTradeIntelligence/artifacts/s3ConditionalObjectStore';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '../src/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { AFL_TRADE_DECISION_ENVIRONMENTS } from '../src/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import type { AflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  createPostgresAflTradePublicationRepository,
  type AflTradePublicationMutationResult,
} from '../src/server/aflTradeIntelligence/publication/postgresPublicationRepository';
import { AFL_TRADE_PROJECTION_RELEASE_ARTIFACT_MAX_BYTES } from '../src/server/aflTradeIntelligence/publication/projectionReleaseArtifact';
import {
  createAflTradeValuationPublicationCommandService,
  createPostgresAflTradeValuationPublicationCommandService,
  type AflTradeValuationPublicationCommandService,
} from '../src/server/aflTradeIntelligence/publication/valuationPublicationCommandService';

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const publicationIdSchema = z.string().regex(/^publication:[a-f0-9]{64}$/);
const gateDecisionIdSchema = z.string().regex(/^gate-decision:[a-f0-9]{64}$/);
const immutableReferenceSchema = z.string().regex(/^[a-z][a-z0-9-]*:[a-f0-9]{64}$/);
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
const requiredVerificationSchema = z
  .unknown()
  .refine((value) => value !== undefined && value !== null, 'Reviewed verification is required.');

const baseConfigurationSchema = z
  .object({
    AFL_TRADE_VALUATION_ENVIRONMENT: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    AFL_OUTCOMES_DATABASE_URL: postgresUrlSchema,
  })
  .transform((value) => ({
    environment: value.AFL_TRADE_VALUATION_ENVIRONMENT,
    databaseUrl: value.AFL_OUTCOMES_DATABASE_URL,
  }));

const projectionConfigurationSchema = z
  .object({
    AFL_TRADE_VALUATION_ENVIRONMENT: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    AFL_OUTCOMES_DATABASE_URL: postgresUrlSchema,
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
    environment: value.AFL_TRADE_VALUATION_ENVIRONMENT,
    databaseUrl: value.AFL_OUTCOMES_DATABASE_URL,
    objectStorage: {
      bucket: value.AFL_TRADE_OBJECT_BUCKET,
      keyPrefix: value.AFL_TRADE_OBJECT_PREFIX,
      kmsKeyId: value.AFL_TRADE_OBJECT_KMS_KEY_ID,
      repositoryId: value.AFL_TRADE_OBJECT_REPOSITORY_ID,
      policyEvidenceId: value.AFL_TRADE_OBJECT_POLICY_EVIDENCE_ID,
      region: value.AWS_REGION,
    },
  }));

const validateCommandSchema = z
  .object({
    action: z.literal('validate'),
    verification: requiredVerificationSchema,
    actor: z.string().trim().min(1).max(200),
  })
  .strict();
const authorizeCommandSchema = z
  .object({
    action: z.enum(['approve', 'publish']),
    publicationId: publicationIdSchema,
    gateDecisionId: gateDecisionIdSchema,
    actor: z.string().trim().min(1).max(200),
  })
  .strict();
const dispositionCommandSchema = z
  .object({
    action: z.enum(['reject', 'withdraw']),
    publicationId: publicationIdSchema,
    actor: z.string().trim().min(1).max(200),
    evidenceId: immutableReferenceSchema,
    reason: z.string().trim().min(1).max(2_000),
  })
  .strict();
const commandSchema = z.discriminatedUnion('action', [
  validateCommandSchema,
  authorizeCommandSchema,
  dispositionCommandSchema,
]);
const argvSchema = z
  .tuple([z.literal('--input'), z.string().trim().min(1).max(4_096)])
  .transform(([, inputPath]) => inputPath);

type LifecycleCommand = z.output<typeof commandSchema>;
type BaseConfiguration = z.output<typeof baseConfigurationSchema>;
type ProjectionConfiguration = z.output<typeof projectionConfigurationSchema>;
type LifecycleConfiguration = BaseConfiguration | ProjectionConfiguration;

export interface AflTradeValuationPublicationLifecycleSummary {
  readonly action: LifecycleCommand['action'];
  readonly publicationId: string;
  readonly projectionId: string | null;
  readonly state: string;
  readonly registryRevision: number;
  readonly activePublicationId: string | null;
  readonly idempotentReplay: boolean;
}

interface ValuationPublicationLifecycleConnection {
  execute(command: LifecycleCommand): Promise<AflTradeValuationPublicationLifecycleSummary>;
  close(): Promise<void>;
}

interface ValuationPublicationLifecycleDependencies {
  readInput(path: string): Promise<unknown>;
  connect(configuration: LifecycleConfiguration): Promise<ValuationPublicationLifecycleConnection>;
  writeOutput(line: string): void;
}

function configurationError(error: z.ZodError): Error {
  const fields = [...new Set(error.issues.map((issue) => String(issue.path[0])))]
    .filter(Boolean)
    .sort()
    .join(', ');
  return new Error(
    `Invalid AFL trade valuation publication lifecycle configuration${fields ? `: ${fields}` : '.'}`
  );
}

function parseBaseConfiguration(
  environment: Readonly<Record<string, string | undefined>>
): BaseConfiguration {
  const parsed = baseConfigurationSchema.safeParse(environment);
  if (!parsed.success) throw configurationError(parsed.error);
  return parsed.data;
}

function parseConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
  command: LifecycleCommand
): LifecycleConfiguration {
  if (command.action !== 'validate') return parseBaseConfiguration(environment);
  const parsed = projectionConfigurationSchema.safeParse(environment);
  if (!parsed.success) throw configurationError(parsed.error);
  return parsed.data;
}

function hasObjectStorage(
  configuration: LifecycleConfiguration
): configuration is ProjectionConfiguration {
  return 'objectStorage' in configuration;
}

function summarize(
  action: LifecycleCommand['action'],
  publicationId: string,
  mutation: AflTradePublicationMutationResult
): AflTradeValuationPublicationLifecycleSummary {
  const record = mutation.registry.publications[publicationId];
  if (!record) {
    throw new TypeError('Publication lifecycle mutation omitted its exact target record.');
  }
  return Object.freeze({
    action,
    publicationId,
    projectionId: record.projectionId,
    state: record.state,
    registryRevision: mutation.registry.revision,
    activePublicationId: mutation.registry.activeByScope[record.scopeKey]?.publicationId ?? null,
    idempotentReplay: mutation.idempotentReplay,
  });
}

function createLifecycleService(input: {
  client: AflOutcomeSqlClient;
  configuration: LifecycleConfiguration;
  s3: S3Client | null;
}): AflTradeValuationPublicationCommandService {
  const publicationRepository = createPostgresAflTradePublicationRepository(input.client);
  const gateRepository = createPostgresAflTradeGateDecisionLedgerRepository(input.client);
  if (!hasObjectStorage(input.configuration)) {
    return createAflTradeValuationPublicationCommandService({
      client: input.client,
      publicationRepository,
      gateRepository,
      environment: input.configuration.environment,
      persistProjectionRelease: async () => {
        throw new TypeError('Projection validation requires configured durable object custody.');
      },
    });
  }
  if (input.s3 === null) throw new TypeError('Projection validation requires an S3 client.');
  const storage = input.configuration.objectStorage;
  const custodyProfile = createAflTradeArtifactCustodyProfile({
    schemaVersion: 'afl-trade-artifact-custody-profile/v1',
    subject: 'afl-trade-intelligence',
    contractRole: 'requirements_only_not_readiness_or_authorization',
    repositoryId: storage.repositoryId,
    environment: input.configuration.environment,
    artifactClass: 'public_projection',
    maximumObjectBytes: AFL_TRADE_PROJECTION_RELEASE_ARTIFACT_MAX_BYTES,
    keyDerivation: 'profile_sha256_two_level_fanout_v1',
    conditionalCreate: 'if_none_match_star_required',
    encryption: {
      inTransit: 'tls_required',
      atRest: {
        mode: 'customer_managed',
        keyReferenceSha256: createHash('sha256').update(storage.kmsKeyId, 'utf8').digest('hex'),
      },
    },
    retention: {
      deletion: {
        kind: 'no_scheduled_deletion',
        maximumDays: null,
        enforcement: 'not_applicable',
      },
      deleteOnWithdrawal: false,
      worm: null,
    },
    residency: {
      allowedJurisdictions: ['Australia'],
      crossJurisdictionTransfer: 'prohibited',
    },
    infrastructureEvidenceIds: [storage.policyEvidenceId],
  });
  const artifactRepository = createAflTradeDurableObjectArtifactRepository({
    objectStore: createAflTradeS3ConditionalObjectStore({
      client: input.s3,
      bucket: storage.bucket,
      keyPrefix: storage.keyPrefix,
      kmsKeyId: storage.kmsKeyId,
    }),
    custodyProfile,
  });
  return createPostgresAflTradeValuationPublicationCommandService({
    client: input.client,
    publicationRepository,
    gateRepository,
    environment: input.configuration.environment,
    artifactRepository,
  });
}

async function connectPostgres(
  configuration: LifecycleConfiguration
): Promise<ValuationPublicationLifecycleConnection> {
  const pool = new Pool({ connectionString: configuration.databaseUrl });
  const s3 = hasObjectStorage(configuration)
    ? new S3Client({ region: configuration.objectStorage.region })
    : null;
  try {
    const service = createLifecycleService({
      client: createPgAflOutcomeSqlClient(pool),
      configuration,
      s3,
    });
    return {
      async execute(command) {
        if (command.action === 'validate') {
          const result = await service.validate({
            verification: command.verification,
            actor: command.actor,
          });
          const manifest = result.custody.releaseArtifact.verification.output.projectionManifest;
          return summarize(command.action, manifest.content.publicationId, result.mutation);
        }
        if (command.action === 'approve' || command.action === 'publish') {
          const mutation = await service.authorize(command);
          return summarize(command.action, command.publicationId, mutation);
        }
        const mutation = await service.disposition(command);
        return summarize(command.action, command.publicationId, mutation);
      },
      async close() {
        s3?.destroy();
        await pool.end();
      },
    };
  } catch (error) {
    s3?.destroy();
    await pool.end();
    throw error;
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

const defaultDependencies: ValuationPublicationLifecycleDependencies = {
  readInput: readJson,
  connect: connectPostgres,
  writeOutput: (line) => process.stdout.write(`${line}\n`),
};

export async function runAflTradeManageValuationPublicationCommand(
  input: {
    argv: readonly string[];
    env: Readonly<Record<string, string | undefined>>;
  },
  dependencies: ValuationPublicationLifecycleDependencies = defaultDependencies
): Promise<AflTradeValuationPublicationLifecycleSummary> {
  const inputPath = argvSchema.parse(input.argv);
  parseBaseConfiguration(input.env);
  const command = commandSchema.parse(await dependencies.readInput(inputPath));
  const connection = await dependencies.connect(parseConfiguration(input.env, command));
  let result: AflTradeValuationPublicationLifecycleSummary;
  try {
    result = await connection.execute(command);
  } catch (executionError) {
    try {
      await connection.close();
    } catch {
      // The transition failure is authoritative; cleanup failure must not replace it.
    }
    throw executionError;
  }
  try {
    await connection.close();
  } catch (cleanupError) {
    dependencies.writeOutput(JSON.stringify({ ...result, cleanupStatus: 'failed' }));
    throw new Error(
      'Valuation publication transition committed, but infrastructure cleanup failed.',
      { cause: cleanupError }
    );
  }
  dependencies.writeOutput(JSON.stringify({ ...result, cleanupStatus: 'closed' }));
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runAflTradeManageValuationPublicationCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'AFL trade valuation publication lifecycle command failed; no unreviewed transition or fallback activation was assumed.\n'
    );
    process.exitCode = 1;
  });
}
