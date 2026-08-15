import 'server-only';

import { createHash } from 'node:crypto';

import { S3Client } from '@aws-sdk/client-s3';
import { Pool } from 'pg';

import { createPostgresDraftTradeReadRepository } from '@/lib/draftTrades/postgres';
import type { DraftTradeReadRepository } from '@/lib/draftTrades/read';

import { createAflTradeArtifactCustodyProfile } from '../artifacts/artifactCustodyProfile';
import { createAflTradeDurableObjectArtifactRepository } from '../artifacts/durableObjectArtifactRepository';
import { createAflTradeS3ConditionalObjectStore } from '../artifacts/s3ConditionalObjectStore';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import { createLocalAflTradeArtifactRepository } from '../development/localFileConditionalObjectStore';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '../governance/postgresGateDecisionLedgerRepository';
import {
  createAflDraftHistoryReadService,
  type AflDraftHistoryReadService,
} from '../outcomes/draftHistoryReadService';
import type { AflDraftTradeOutcomeReadService } from '../outcomes/outcomeReadService';
import { createPgAflOutcomeSqlClient } from '../outcomes/pgOutcomeSqlClient';
import { createAflTradePromotionBackedArchiveSelector } from '../outcomes/promotionBackedArchiveSelection';
import { createPostgresAflDraftHistoryRepository } from '../outcomes/postgresDraftHistoryReadRepository';
import { PostgresAflTradePromotionBackedGate2Repository } from '../outcomes/postgresPromotionBackedGate2Repository';
import { createPostgresAflTradePromotionBackedPublicArchiveReadRepository } from '../outcomes/postgresPromotionBackedPublicArchiveReadRepository';
import { createPostgresAflDraftTradeOutcomeReadService } from '../outcomes/postgresOutcomeProjectionReadRepository';
import { PostgresAflDraftTradeOutcomeRegistrySnapshotStore } from '../outcomes/postgresOutcomeReleaseRepository';
import { aflDraftTradePrePublicationOutcomeReadService } from '../outcomes/prePublicationOutcomeReadService';
import { createGovernedAflTradePublicationSelector } from '../publication/governedPublicationSelector';
import {
  aflTradePrePublicationMethodologyReadService,
  createAflTradeMethodologyReadService,
  type AflTradeMethodologyReadService,
} from '../publication/methodologyReadService';
import { createPostgresAflTradeProjectionArtifactReleaseSource } from '../publication/postgresProjectionArtifactReleaseSource';
import { createPostgresAflTradeProjectionFreshnessHighWaterStore } from '../publication/postgresProjectionFreshnessHighWaterStore';
import { createPostgresAflTradePublicationRepository } from '../publication/postgresPublicationRepository';
import { aflTradePrePublicationValueReadService } from '../publication/prePublicationValueReadService';
import {
  AFL_TRADE_PROJECTION_ARTIFACT_READ_RELEASE_MAX_BYTES,
  createAflTradeProjectionArtifactReadRepository,
} from '../publication/projectionArtifactReadRepository';
import { createResolvingAflTradeProjectionReadRepository } from '../publication/resolvingProjectionReadRepository';
import {
  createAflTradeValueReadService,
  type AflTradeValueReadService,
} from '../publication/valueReadService';
import { parseAflTradePublicReadConfig, type AflTradePublicReadConfig } from './publicReadConfig';

export interface AflTradePublicReadRuntime {
  readonly mode: 'disabled' | 'postgres';
  readonly outcomeReadService: AflDraftTradeOutcomeReadService;
  readonly valueReadService: AflTradeValueReadService;
  readonly methodologyReadService: AflTradeMethodologyReadService;
  readonly archiveReadRepository: DraftTradeReadRepository;
  readonly draftHistoryReadService: AflDraftHistoryReadService;
  close(): Promise<void>;
}

type PostgresConfig = Extract<AflTradePublicReadConfig, { mode: 'postgres' }>;

type GlobalWithLocalOutcomePool = typeof globalThis & {
  __statlyAflTradeLocalOutcomePool?: Pool;
};

export function createAflTradePublicReadPoolOptions(config: PostgresConfig): {
  readonly connectionString: string;
  readonly max?: number;
} {
  return config.environment === 'test_fixture'
    ? { connectionString: config.databaseUrl, max: 1 }
    : { connectionString: config.databaseUrl };
}

export function createAflTradePublicProjectionArtifactRepository(
  config: PostgresConfig,
  dependencies: { s3Client?: S3Client } = {}
): AflTradeImmutableArtifactRepository {
  if (config.artifactStorage.kind === 'local_filesystem') {
    return createLocalAflTradeArtifactRepository({
      rootDirectory: config.artifactStorage.rootDirectory,
      repositoryId: 'statly-local-afl-trade-projections',
      artifactClass: 'public_projection',
      maximumObjectBytes: AFL_TRADE_PROJECTION_ARTIFACT_READ_RELEASE_MAX_BYTES,
    });
  }
  const storage = config.artifactStorage;
  const custodyProfile = createAflTradeArtifactCustodyProfile({
    schemaVersion: 'afl-trade-artifact-custody-profile/v1',
    subject: 'afl-trade-intelligence',
    contractRole: 'requirements_only_not_readiness_or_authorization',
    repositoryId: storage.repositoryId,
    environment: config.environment,
    artifactClass: 'public_projection',
    maximumObjectBytes: AFL_TRADE_PROJECTION_ARTIFACT_READ_RELEASE_MAX_BYTES,
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
      deleteOnWithdrawal: true,
      worm: null,
    },
    residency: {
      allowedJurisdictions: ['Australia'],
      crossJurisdictionTransfer: 'prohibited',
    },
    infrastructureEvidenceIds: [storage.policyEvidenceId],
  });
  return createAflTradeDurableObjectArtifactRepository({
    objectStore: createAflTradeS3ConditionalObjectStore({
      client: dependencies.s3Client ?? new S3Client({ region: storage.region }),
      bucket: storage.bucket,
      keyPrefix: storage.keyPrefix,
      kmsKeyId: storage.kmsKeyId,
    }),
    custodyProfile,
  });
}

async function createPostgresRuntime(config: PostgresConfig): Promise<AflTradePublicReadRuntime> {
  const globalWithLocalPool = globalThis as GlobalWithLocalOutcomePool;
  const ownsPool = config.environment !== 'test_fixture';
  const pool = ownsPool
    ? new Pool(createAflTradePublicReadPoolOptions(config))
    : (globalWithLocalPool.__statlyAflTradeLocalOutcomePool ??= new Pool(
        createAflTradePublicReadPoolOptions(config)
      ));
  const s3 =
    config.artifactStorage.kind === 's3'
      ? new S3Client({ region: config.artifactStorage.region })
      : null;
  try {
    const client = createPgAflOutcomeSqlClient(pool);
    const gateRepository = createPostgresAflTradeGateDecisionLedgerRepository(client);
    const now = () => new Date().toISOString();
    const factualRegistryStore = new PostgresAflDraftTradeOutcomeRegistrySnapshotStore(client);
    const gate2Repository = new PostgresAflTradePromotionBackedGate2Repository(client);
    const promotionArchiveSelector = createAflTradePromotionBackedArchiveSelector({
      loadRegistry: () => factualRegistryStore.load(),
      loadGateDecisionLedger: async () => (await gateRepository.load()).ledger,
      loadGate2Authority: (releaseId) => gate2Repository.loadCurrentAuthority(releaseId),
      expectedEnvironment: config.environment,
      now,
    });
    const publicArchiveRepository =
      createPostgresAflTradePromotionBackedPublicArchiveReadRepository({ client });
    const archiveReadRepository = createPostgresDraftTradeReadRepository({
      archiveSelector: promotionArchiveSelector,
      archiveRepository: publicArchiveRepository,
    });
    const artifactRepository = createAflTradePublicProjectionArtifactRepository(config, {
      ...(s3 === null ? {} : { s3Client: s3 }),
    });
    const releaseSource = createPostgresAflTradeProjectionArtifactReleaseSource({
      client,
      artifactRepository,
    });
    const freshnessHighWaterStore = createPostgresAflTradeProjectionFreshnessHighWaterStore(client);
    const projectionRepository = createResolvingAflTradeProjectionReadRepository({
      factory: (projectionId) =>
        createAflTradeProjectionArtifactReadRepository({
          projectionId,
          releaseSource,
          freshnessHighWaterStore,
        }),
      isFactualArchiveTrade: async (tradeId) =>
        (await archiveReadRepository.getById(tradeId)) !== null,
    });
    const publicationSelector = createGovernedAflTradePublicationSelector({
      publicationRepository: createPostgresAflTradePublicationRepository(client),
      gateRepository,
      environment: config.environment,
      now,
    });

    return {
      mode: 'postgres',
      outcomeReadService: createPostgresAflDraftTradeOutcomeReadService({
        client,
        cursorSecret: config.cursorSecret,
        expectedEnvironment: config.environment,
        loadSourceRightsDecisionLedger: async () => (await gateRepository.load()).ledger,
        now,
      }),
      valueReadService: createAflTradeValueReadService({
        publicationSelector,
        projectionRepository,
        now,
      }),
      methodologyReadService: createAflTradeMethodologyReadService({
        publicationSelector,
        projectionRepository,
        now: () => new Date(),
      }),
      archiveReadRepository,
      draftHistoryReadService: createAflDraftHistoryReadService({
        archiveSelector: promotionArchiveSelector,
        repository: createPostgresAflDraftHistoryRepository({
          archiveRepository: publicArchiveRepository,
        }),
        now,
      }),
      async close() {
        s3?.destroy();
        if (ownsPool) await pool.end();
      },
    };
  } catch (error) {
    s3?.destroy();
    await pool.end();
    if (!ownsPool && globalWithLocalPool.__statlyAflTradeLocalOutcomePool === pool) {
      delete globalWithLocalPool.__statlyAflTradeLocalOutcomePool;
    }
    throw error;
  }
}

const disabledRuntime: AflTradePublicReadRuntime = Object.freeze({
  mode: 'disabled',
  outcomeReadService: aflDraftTradePrePublicationOutcomeReadService,
  valueReadService: aflTradePrePublicationValueReadService,
  methodologyReadService: aflTradePrePublicationMethodologyReadService,
  archiveReadRepository: {
    async listTradesByYear() {
      return [];
    },
    async listYears() {
      return [];
    },
    async getById() {
      return null;
    },
    async listRefsByClub() {
      return [];
    },
    async listClubs() {
      return [];
    },
    async searchTrades() {
      return [];
    },
  },
  draftHistoryReadService: createAflDraftHistoryReadService({
    archiveSelector: {
      async capture() {
        return {
          registryRevision: 0,
          selection: null,
          unavailabilityReason: 'no_active_release',
        };
      },
    },
    repository: {
      async listYears() {
        throw new Error('No approved AFL draft-history release is active.');
      },
      async readYear() {
        throw new Error('No approved AFL draft-history release is active.');
      },
    },
  }),
  async close() {},
});

export async function createAflTradePublicReadRuntime(
  config: AflTradePublicReadConfig,
  dependencies: {
    createPostgres?: (config: PostgresConfig) => Promise<AflTradePublicReadRuntime>;
  } = {}
): Promise<AflTradePublicReadRuntime> {
  if (config.mode === 'disabled') return disabledRuntime;
  return (dependencies.createPostgres ?? createPostgresRuntime)(config);
}

export function createAflTradePublicReadRuntimeLoader(input: {
  loadConfig: () => AflTradePublicReadConfig;
  createRuntime: (config: AflTradePublicReadConfig) => Promise<AflTradePublicReadRuntime>;
}) {
  let current: Promise<AflTradePublicReadRuntime> | null = null;
  return {
    async get() {
      if (current !== null) return current;
      const starting = input.createRuntime(input.loadConfig());
      current = starting;
      try {
        return await starting;
      } catch (error) {
        if (current === starting) current = null;
        throw error;
      }
    },
    async shutdown() {
      const running = current;
      current = null;
      if (running !== null) await (await running).close();
    },
  };
}

const processRuntime = createAflTradePublicReadRuntimeLoader({
  loadConfig: () => parseAflTradePublicReadConfig(process.env),
  createRuntime: createAflTradePublicReadRuntime,
});

export const getPublicAflTradeReadRuntime = () => processRuntime.get();
export const shutdownPublicAflTradeReadRuntime = () => processRuntime.shutdown();
