import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { S3Client } from '@aws-sdk/client-s3';
import { Redis } from 'ioredis';
import { Pool } from 'pg';

import { createAflTradeArtifactCustodyProfile } from '../artifacts/artifactCustodyProfile';
import { createAflTradeDurableObjectArtifactRepository } from '../artifacts/durableObjectArtifactRepository';
import { createAflTradeS3ConditionalObjectStore } from '../artifacts/s3ConditionalObjectStore';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '../governance/postgresGateDecisionLedgerRepository';
import { createPgAflOutcomeSqlClient } from '../outcomes/pgOutcomeSqlClient';
import { createAflTradeRedisCaptureAdmission } from '../source/fitzRoyCaptureAdmission';
import { parseAflTradeFitzRoyCaptureRequest } from '../source/fitzRoyCaptureContracts';
import type { AflTradeFitzRoyCaptureCommand } from '../source/fitzRoyCaptureRuntime';
import {
  createAflTradeEd25519EgressExecutionVerifier,
  createAflTradeHttpFitzRoyProcessExecutor,
} from '../source/fitzRoyHttpEgressExecutor';
import { AflTradeLocalRscriptDecodeExecutor } from '../source/fitzRoyObservationDecodeRuntime';
import {
  ingestAuthorizedAflTradeFitzRoyProviderSeason,
  type AflTradeFitzRoyProviderIngestionCommand,
  type AflTradeFitzRoyProviderIngestionResult,
} from '../source/fitzRoyProviderIngestion';
import { createAflTradeIoredisCaptureAdmissionStore } from '../source/fitzRoyRedisCaptureAdmissionStore';
import { PostgresAflTradeProviderObservationRepository } from '../source/postgresProviderObservationRepository';
import { PostgresAflTradeSourceCaptureRepository } from '../source/postgresSourceCaptureRepository';
import type { AflTradeProviderIngestionConfig } from './providerIngestionConfig';

export interface AflTradeDeployedProviderIngestionCommand extends Omit<
  AflTradeFitzRoyProviderIngestionCommand,
  'capture'
> {
  capture: Omit<AflTradeFitzRoyCaptureCommand, 'ledger' | 'sourceRights'>;
}

export interface AflTradeProviderIngestionRuntime {
  ingest(
    command: AflTradeDeployedProviderIngestionCommand
  ): Promise<AflTradeFitzRoyProviderIngestionResult>;
  close(): Promise<void>;
}

export function createAflTradeProviderIngestionCustodyProfile(
  config: AflTradeProviderIngestionConfig,
  input: {
    artifactClass: 'raw_source' | 'capture_metadata';
    maximumObjectBytes: number;
    retentionDays: number;
  }
) {
  return createAflTradeArtifactCustodyProfile({
    schemaVersion: 'afl-trade-artifact-custody-profile/v1',
    subject: 'afl-trade-intelligence',
    contractRole: 'requirements_only_not_readiness_or_authorization',
    repositoryId: `${config.objectStorage.repositoryId}-${input.artifactClass}`,
    environment: config.environment,
    artifactClass: input.artifactClass,
    maximumObjectBytes: input.maximumObjectBytes,
    keyDerivation: 'profile_sha256_two_level_fanout_v1',
    conditionalCreate: 'if_none_match_star_required',
    encryption: {
      inTransit: 'tls_required',
      atRest: {
        mode: 'customer_managed',
        keyReferenceSha256: createHash('sha256')
          .update(config.objectStorage.kmsKeyId, 'utf8')
          .digest('hex'),
      },
    },
    retention: {
      deletion: {
        kind: 'maximum_age',
        maximumDays: input.retentionDays,
        enforcement: 'provider_lifecycle_required',
      },
      deleteOnWithdrawal: true,
      worm: null,
    },
    residency: {
      allowedJurisdictions: config.objectStorage.allowedJurisdictions,
      crossJurisdictionTransfer: 'approved_jurisdictions_only',
    },
    infrastructureEvidenceIds: config.objectStorage.infrastructureEvidenceIds,
  });
}

export function createAflTradeProviderIngestionRuntime(
  config: AflTradeProviderIngestionConfig
): AflTradeProviderIngestionRuntime {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
  });
  const s3 = new S3Client({ region: config.objectStorage.region });
  const client = createPgAflOutcomeSqlClient(pool);
  const gateRepository = createPostgresAflTradeGateDecisionLedgerRepository(client);
  const objectStore = createAflTradeS3ConditionalObjectStore({
    client: s3,
    bucket: config.objectStorage.bucket,
    keyPrefix: config.objectStorage.keyPrefix,
    kmsKeyId: config.objectStorage.kmsKeyId,
  });
  const rawArtifactRepository = createAflTradeDurableObjectArtifactRepository({
    objectStore,
    custodyProfile: createAflTradeProviderIngestionCustodyProfile(config, {
      artifactClass: 'raw_source',
      maximumObjectBytes: config.limits.maximumSourceBytes,
      retentionDays: config.limits.rawRetentionDays,
    }),
  });
  const metadataArtifactRepository = createAflTradeDurableObjectArtifactRepository({
    objectStore,
    custodyProfile: createAflTradeProviderIngestionCustodyProfile(config, {
      artifactClass: 'capture_metadata',
      maximumObjectBytes: Math.max(
        config.limits.maximumDiagnosticsBytes,
        config.limits.maximumOutputBytes
      ),
      retentionDays: config.limits.metadataRetentionDays,
    }),
  });
  const verifier = createAflTradeEd25519EgressExecutionVerifier(config.egressPublicKeys);
  const executor = createAflTradeHttpFitzRoyProcessExecutor({
    endpoint: config.egressEndpoint,
    bearerToken: config.egressBearerToken,
    egressPolicyEvidenceIds: config.egressPolicyEvidenceIds,
  });
  const captureAdmission = createAflTradeRedisCaptureAdmission({
    redis: createAflTradeIoredisCaptureAdmissionStore(redis),
    createToken: randomUUID,
  });
  const clock = { now: () => new Date().toISOString() };
  const sourceCaptureRepository = new PostgresAflTradeSourceCaptureRepository(client);
  const providerObservationRepository = new PostgresAflTradeProviderObservationRepository(client);

  return {
    async ingest(command) {
      if (command.capture.gateRequest.environment !== config.environment) {
        throw new TypeError(
          'Provider ingestion requires a Gate request matching the configured authority environment.'
        );
      }
      const captureRequest = parseAflTradeFitzRoyCaptureRequest(command.capture.captureRequest);
      const expectedDecisionKey = `${captureRequest.capabilityId}-${config.environment}`;
      if (command.capture.gateRequest.decisionKey !== expectedDecisionKey) {
        throw new TypeError(
          'Provider ingestion requires a Gate request matching the configured authority decision key.'
        );
      }
      const authority = await gateRepository.resolveAuthorization(
        command.capture.gateRequest.rightsArtifactId
      );
      return ingestAuthorizedAflTradeFitzRoyProviderSeason(
        {
          ...command,
          capture: {
            ...command.capture,
            ledger: authority.ledger,
            sourceRights: authority.sourceRights,
          },
        },
        {
          capture: {
            rawArtifactRepository,
            metadataArtifactRepository,
            executor,
            clock,
            runtimeIdentity: {
              ...config.runtimeIdentity,
              imageDigest: config.runtimeIdentity.imageDigest as `sha256:${string}`,
            },
            timeoutMs: config.limits.captureTimeoutMs,
            maximumSourceBytes: config.limits.maximumSourceBytes,
            maximumDiagnosticsBytes: config.limits.maximumDiagnosticsBytes,
            captureAdmission,
            egressExecutionVerifier: verifier,
            authorizationResolver: gateRepository,
          },
          staging: {
            rawArtifactRepository,
            sourceCaptureRepository,
            providerObservationRepository,
            decoderExecutor: new AflTradeLocalRscriptDecodeExecutor({
              rscriptPath: config.rscriptPath,
            }),
            clock,
            dependencyLockSha256: config.runtimeIdentity.dependencyLockSha256,
            imageDigest: config.runtimeIdentity.imageDigest as `sha256:${string}`,
            timeoutMs: config.limits.decoderTimeoutMs,
            maximumSourceBytes: config.limits.maximumSourceBytes,
            maximumRows: config.limits.maximumRows,
            maximumFields: config.limits.maximumFields,
            maximumCells: config.limits.maximumCells,
            maximumCellBytes: config.limits.maximumCellBytes,
            maximumOutputBytes: config.limits.maximumOutputBytes,
            egressExecutionVerifier: verifier,
          },
          clock,
        }
      );
    },
    async close() {
      s3.destroy();
      await Promise.all([pool.end(), redis.quit()]);
    },
  };
}
