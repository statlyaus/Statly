import type { AflTradeArtifactRef } from '../artifacts/artifactReference';
import type { AflTradeEvidenceStoreBinding } from '../artifacts/artifactStoreLocation';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  createLocalAflTradeNonProductionArtifactRepository,
  createLocalAflTradePrivateDerivedArtifactRepository,
} from './localFileConditionalObjectStore';

const LOCAL_STORE_ASSURANCE = 'local_non_production_filesystem';
const REPOSITORY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

/**
 * One repository rooted where the registered local non-production store says, never at a
 * caller-chosen directory. It carries its store location, so every custody row written for its
 * artifacts records where the bytes live.
 */
export async function bindLocalAflTradeArtifactRepository(
  client: AflOutcomeSqlClient,
  input: {
    storeId: string;
    repositoryId: string;
    artifactClass: 'raw_source' | 'capture_metadata' | 'derived_private';
    maximumObjectBytes: number;
  }
): Promise<AflTradeImmutableArtifactRepository> {
  if (!REPOSITORY_ID_PATTERN.test(input.repositoryId) || input.repositoryId.includes('..')) {
    throw new TypeError('A store repository id must be one lowercase path segment.');
  }
  const result = await client.query<{
    environment: string;
    assurance: string;
    root_locator: string;
  }>(
    `SELECT environment::text AS environment, assurance, root_locator
       FROM outcome_artifact_store WHERE store_id=$1`,
    [input.storeId]
  );
  const store = result.rows[0];
  if (store === undefined) {
    throw new Error(`Artifact store ${input.storeId} is not registered.`);
  }
  if (store.assurance !== LOCAL_STORE_ASSURANCE || store.environment !== 'non_production') {
    throw new Error(`Artifact store ${input.storeId} is not a local non-production store.`);
  }
  const repository =
    input.artifactClass === 'derived_private'
      ? createLocalAflTradePrivateDerivedArtifactRepository({
          rootDirectory: store.root_locator,
          repositoryId: input.repositoryId,
          maximumObjectBytes: input.maximumObjectBytes,
        })
      : createLocalAflTradeNonProductionArtifactRepository({
          rootDirectory: store.root_locator,
          repositoryId: input.repositoryId,
          artifactClass: input.artifactClass,
          maximumObjectBytes: input.maximumObjectBytes,
        });
  return {
    assurance: repository.assurance,
    artifactClass: repository.artifactClass,
    custodyProfile: repository.custodyProfile,
    putIfAbsent: (reference, bytes) => repository.putIfAbsent(reference, bytes),
    loadExact: (reference, maximumBytes) => repository.loadExact(reference, maximumBytes),
    storeLocation: {
      storeId: input.storeId,
      // Matches the repository's own layout: <repository>/<assurance>/sha256/<aa>/<bb>/<sha>.
      objectKeyFor: (reference: AflTradeArtifactRef) => {
        const sha = reference.contentSha256;
        return `${input.repositoryId}/${repository.assurance}/sha256/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}`;
      },
    },
  };
}

/**
 * Binds reviewed-registration evidence to one repository of the registered local non-production
 * store (see {@link bindLocalAflTradeArtifactRepository}).
 */
export async function bindLocalAflTradeArtifactStore(
  client: AflOutcomeSqlClient,
  input: {
    storeId: string;
    repositoryId: string;
    artifactClass: 'raw_source' | 'capture_metadata';
    maximumObjectBytes: number;
  }
): Promise<AflTradeEvidenceStoreBinding> {
  const repository = await bindLocalAflTradeArtifactRepository(client, input);
  const location = repository.storeLocation!;
  return {
    storeId: location.storeId,
    putIfAbsent: (reference, bytes) => repository.putIfAbsent(reference, bytes),
    loadExact: (reference, maximumBytes) => repository.loadExact(reference, maximumBytes),
    objectKeyFor: (reference) => location.objectKeyFor(reference),
  };
}
