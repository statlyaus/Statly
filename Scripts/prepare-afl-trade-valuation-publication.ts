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
import { createPostgresAflTradePublicationRepository } from '../src/server/aflTradeIntelligence/publication/postgresPublicationRepository';
import { aflTradeProjectionPresentationUniversalLayerSchema } from '../src/server/aflTradeIntelligence/publication/projectionPresentationPolicy';
import { createPostgresAflTradeValuationPublicationCommandService } from '../src/server/aflTradeIntelligence/publication/valuationPublicationCommandService';
import { createPostgresAflTradeValuationPublicationPreparationService } from '../src/server/aflTradeIntelligence/publication/valuationPublicationPreparationService';

const MAXIMUM_DERIVED_PRIVATE_ARTIFACT_BYTES = 128 * 1024 * 1024;

const requiredEvidenceSchema = z
  .unknown()
  .refine((value) => value !== undefined && value !== null, 'Reviewed evidence is required.');
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
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

const configurationSchema = z
  .object({
    AFL_TRADE_VALUATION_ENVIRONMENT: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    AFL_OUTCOMES_DATABASE_URL: postgresUrlSchema,
    AFL_TRADE_VALUATION_OBJECT_BUCKET: z
      .string()
      .trim()
      .min(3)
      .max(63)
      .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/),
    AFL_TRADE_VALUATION_OBJECT_PREFIX: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9!_.*'()/-]*$/),
    AFL_TRADE_VALUATION_OBJECT_KMS_KEY_ID: z.string().trim().min(1).max(2_048),
    AFL_TRADE_VALUATION_OBJECT_REPOSITORY_ID: publicIdSchema,
    AFL_TRADE_VALUATION_OBJECT_POLICY_EVIDENCE_ID: immutableReferenceSchema,
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
      bucket: value.AFL_TRADE_VALUATION_OBJECT_BUCKET,
      keyPrefix: value.AFL_TRADE_VALUATION_OBJECT_PREFIX,
      kmsKeyId: value.AFL_TRADE_VALUATION_OBJECT_KMS_KEY_ID,
      repositoryId: value.AFL_TRADE_VALUATION_OBJECT_REPOSITORY_ID,
      policyEvidenceId: value.AFL_TRADE_VALUATION_OBJECT_POLICY_EVIDENCE_ID,
      region: value.AWS_REGION,
    },
  }));

const commandSchema = z
  .object({
    inventoryIndexVerification: requiredEvidenceSchema,
    inventoryCustodyInputs: z
      .array(
        z
          .object({
            verification: requiredEvidenceSchema,
            assessmentVerification: requiredEvidenceSchema,
          })
          .strict()
      )
      .min(1)
      .max(10_000),
    actor: z.string().trim().min(1).max(200),
    preparationKey: publicIdSchema,
    universalLayer: aflTradeProjectionPresentationUniversalLayerSchema,
    maximumConcurrentInventories: z.number().int().min(1).max(16).optional(),
    publicationCandidate: requiredEvidenceSchema,
  })
  .strict();

const argvSchema = z
  .tuple([z.literal('--input'), z.string().trim().min(1).max(4_096)])
  .transform(([, inputPath]) => inputPath);

type ValuationPublicationConfiguration = z.output<typeof configurationSchema>;
type ValuationPublicationCommand = z.output<typeof commandSchema>;

export interface AflTradeValuationPublicationPreparationSummary {
  readonly status: 'candidate_registered';
  readonly publicationEligible: false;
  readonly environment: ValuationPublicationConfiguration['environment'];
  readonly preparationKey: string;
  readonly publicationId: string;
  readonly custodyIndexId: string;
  readonly registryRevision: number;
  readonly idempotentReplay: boolean;
}

interface ValuationPublicationPreparationConnection {
  prepare(
    command: ValuationPublicationCommand
  ): Promise<AflTradeValuationPublicationPreparationSummary>;
  close(): Promise<void>;
}

interface ValuationPublicationPreparationCommandDependencies {
  readInput(path: string): Promise<unknown>;
  connect(
    configuration: ValuationPublicationConfiguration
  ): Promise<ValuationPublicationPreparationConnection>;
  writeOutput(line: string): void;
}

function parseConfiguration(
  environment: Readonly<Record<string, string | undefined>>
): ValuationPublicationConfiguration {
  const parsed = configurationSchema.safeParse(environment);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))]
      .filter(Boolean)
      .sort()
      .join(', ');
    throw new Error(
      `Invalid AFL trade valuation publication configuration${fields ? `: ${fields}` : '.'}`
    );
  }
  return parsed.data;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function connectPostgres(
  configuration: ValuationPublicationConfiguration
): Promise<ValuationPublicationPreparationConnection> {
  const pool = new Pool({ connectionString: configuration.databaseUrl });
  const s3 = new S3Client({ region: configuration.objectStorage.region });
  const client = createPgAflOutcomeSqlClient(pool);
  const custodyProfile = createAflTradeArtifactCustodyProfile({
    schemaVersion: 'afl-trade-artifact-custody-profile/v1',
    subject: 'afl-trade-intelligence',
    contractRole: 'requirements_only_not_readiness_or_authorization',
    repositoryId: configuration.objectStorage.repositoryId,
    environment: configuration.environment,
    artifactClass: 'derived_private',
    maximumObjectBytes: MAXIMUM_DERIVED_PRIVATE_ARTIFACT_BYTES,
    keyDerivation: 'profile_sha256_two_level_fanout_v1',
    conditionalCreate: 'if_none_match_star_required',
    encryption: {
      inTransit: 'tls_required',
      atRest: {
        mode: 'customer_managed',
        keyReferenceSha256: createHash('sha256')
          .update(configuration.objectStorage.kmsKeyId, 'utf8')
          .digest('hex'),
      },
    },
    retention: {
      deletion: {
        kind: 'no_scheduled_deletion',
        maximumDays: null,
        enforcement: 'not_applicable',
      },
      deleteOnWithdrawal: true,
      worm: null,
    },
    residency: {
      allowedJurisdictions: ['Australia'],
      crossJurisdictionTransfer: 'prohibited',
    },
    infrastructureEvidenceIds: [configuration.objectStorage.policyEvidenceId],
  });
  const artifactRepository = createAflTradeDurableObjectArtifactRepository({
    objectStore: createAflTradeS3ConditionalObjectStore({
      client: s3,
      bucket: configuration.objectStorage.bucket,
      keyPrefix: configuration.objectStorage.keyPrefix,
      kmsKeyId: configuration.objectStorage.kmsKeyId,
    }),
    custodyProfile,
  });
  const publicationRepository = createPostgresAflTradePublicationRepository(client);
  const publicationCommand = createPostgresAflTradeValuationPublicationCommandService({
    client,
    publicationRepository,
    gateRepository: createPostgresAflTradeGateDecisionLedgerRepository(client),
    environment: configuration.environment,
    artifactRepository,
  });

  return {
    async prepare(command) {
      const preparation = createPostgresAflTradeValuationPublicationPreparationService({
        client,
        artifactRepository,
        environment: configuration.environment,
        preparePublicationCandidate: async () => command.publicationCandidate,
        publicationCommand,
      });
      const result = await preparation.prepare({
        inventoryIndexVerification: command.inventoryIndexVerification,
        inventoryCustodyInputs: command.inventoryCustodyInputs,
        actor: command.actor,
        preparationKey: command.preparationKey,
        universalLayer: command.universalLayer,
        maximumConcurrentInventories: command.maximumConcurrentInventories,
      });
      return Object.freeze({
        status: result.status,
        publicationEligible: result.publicationEligible,
        environment: configuration.environment,
        preparationKey: command.preparationKey,
        publicationId: result.publication.publicationManifest.publicationId,
        custodyIndexId:
          result.custodyIndexVerification.output.valuationOutputCustodyIndex
            .valuationOutputCustodyIndexId,
        registryRevision: result.mutation.registry.revision,
        idempotentReplay: result.mutation.idempotentReplay,
      });
    },
    async close() {
      s3.destroy();
      await pool.end();
    },
  };
}

const defaultDependencies: ValuationPublicationPreparationCommandDependencies = {
  readInput: readJson,
  connect: connectPostgres,
  writeOutput: (line) => process.stdout.write(`${line}\n`),
};

export async function runAflTradePrepareValuationPublicationCommand(
  input: {
    argv: readonly string[];
    env: Readonly<Record<string, string | undefined>>;
  },
  dependencies: ValuationPublicationPreparationCommandDependencies = defaultDependencies
): Promise<AflTradeValuationPublicationPreparationSummary> {
  const inputPath = argvSchema.parse(input.argv);
  const configuration = parseConfiguration(input.env);
  const command = commandSchema.parse(await dependencies.readInput(inputPath));
  const connection = await dependencies.connect(configuration);
  try {
    const result = await connection.prepare(command);
    dependencies.writeOutput(JSON.stringify(result));
    return result;
  } finally {
    await connection.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runAflTradePrepareValuationPublicationCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'AFL trade valuation publication preparation failed; no validation, approval, publication, or activation was assumed.\n'
    );
    process.exitCode = 1;
  });
}
