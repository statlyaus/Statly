import { describe, expect, it, vi } from 'vitest';

import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeArtifactCustodyProfile } from '@/server/aflTradeIntelligence/artifacts/artifactCustodyProfile';
import type { AflTradeImmutableArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { AFL_TRADE_PROJECTION_ARTIFACT_READ_RELEASE_MAX_BYTES } from '@/server/aflTradeIntelligence/publication/projectionArtifactReadRepository';
import { createPostgresAflTradeProjectionArtifactReleaseSource } from '@/server/aflTradeIntelligence/publication/postgresProjectionArtifactReleaseSource';

class QueryFixture implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  constructor(private readonly rows: Record<string, unknown>[]) {}

  transaction<T>(callback: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    return callback(this);
  }

  async query<Row = Record<string, unknown>>(
    _sql: string,
    _values?: readonly unknown[]
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    return { rows: this.rows as unknown as Row[], rowCount: this.rows.length };
  }
}

function durableReader(
  reference: ReturnType<typeof createAflTradeByteArtifactRef>,
  bytes: Uint8Array
) {
  const custodyProfile = createAflTradeArtifactCustodyProfile({
    schemaVersion: 'afl-trade-artifact-custody-profile/v1',
    subject: 'afl-trade-intelligence',
    contractRole: 'requirements_only_not_readiness_or_authorization',
    repositoryId: 'projection-release-source-test',
    environment: 'non_production',
    artifactClass: 'public_projection',
    maximumObjectBytes: AFL_TRADE_PROJECTION_ARTIFACT_READ_RELEASE_MAX_BYTES,
    keyDerivation: 'profile_sha256_two_level_fanout_v1',
    conditionalCreate: 'if_none_match_star_required',
    encryption: {
      inTransit: 'tls_required',
      atRest: { mode: 'customer_managed', keyReferenceSha256: 'a'.repeat(64) },
    },
    retention: {
      deletion: { kind: 'no_scheduled_deletion', maximumDays: null, enforcement: 'not_applicable' },
      deleteOnWithdrawal: false,
      worm: null,
    },
    residency: {
      allowedJurisdictions: ['Australia'],
      crossJurisdictionTransfer: 'prohibited',
    },
    infrastructureEvidenceIds: [`artifact:${'b'.repeat(64)}`],
  });
  return {
    assurance: 'durable_object_storage' as const,
    artifactClass: 'public_projection' as const,
    custodyProfile,
    putIfAbsent: vi.fn(),
    loadExact: vi.fn(async () => ({ reference, bytes })),
  } satisfies AflTradeImmutableArtifactRepository;
}

describe('PostgreSQL AFL trade projection release source', () => {
  it('loads only the exact custody-bound projection bytes within the caller bound', async () => {
    const bytes = new TextEncoder().encode('{"fixture":true}');
    const reference = createAflTradeByteArtifactRef(
      bytes,
      'application/json',
      '2026-08-08T00:00:00.000Z'
    );
    const repository = durableReader(reference, bytes);
    const source = createPostgresAflTradeProjectionArtifactReleaseSource({
      client: new QueryFixture([
        {
          projection_id: `projection:${'1'.repeat(64)}`,
          artifact_id: reference.artifactId,
          content_sha256: reference.contentSha256,
          storage_uri: reference.storageUri,
          media_type: reference.mediaType,
          byte_length: String(reference.byteLength),
          created_at: reference.createdAt,
          artifact_class: 'public_projection',
          environment: 'non_production',
          custody_profile_id: repository.custodyProfile.profileId,
        },
      ]),
      artifactRepository: repository,
    });

    const result = await source.loadRelease(`projection:${'1'.repeat(64)}`, {
      maxBytes: AFL_TRADE_PROJECTION_ARTIFACT_READ_RELEASE_MAX_BYTES,
    });

    expect(result).toBeInstanceOf(Uint8Array);
    if (!(result instanceof Uint8Array)) throw new Error('Expected exact projection bytes.');
    expect(Array.from(result)).toEqual(Array.from(bytes));
    expect(repository.loadExact).toHaveBeenCalledWith(
      reference,
      AFL_TRADE_PROJECTION_ARTIFACT_READ_RELEASE_MAX_BYTES
    );
  });

  it('rejects oversized custody metadata before object storage is read', async () => {
    const bytes = new TextEncoder().encode('{}');
    const reference = createAflTradeByteArtifactRef(
      bytes,
      'application/json',
      '2026-08-08T00:00:00.000Z'
    );
    const repository = durableReader(reference, bytes);
    const source = createPostgresAflTradeProjectionArtifactReleaseSource({
      client: new QueryFixture([
        {
          projection_id: `projection:${'1'.repeat(64)}`,
          artifact_id: reference.artifactId,
          content_sha256: reference.contentSha256,
          storage_uri: reference.storageUri,
          media_type: reference.mediaType,
          byte_length: String(AFL_TRADE_PROJECTION_ARTIFACT_READ_RELEASE_MAX_BYTES + 1),
          created_at: reference.createdAt,
          artifact_class: 'public_projection',
          environment: 'non_production',
          custody_profile_id: repository.custodyProfile.profileId,
        },
      ]),
      artifactRepository: repository,
    });

    await expect(
      source.loadRelease(`projection:${'1'.repeat(64)}`, {
        maxBytes: AFL_TRADE_PROJECTION_ARTIFACT_READ_RELEASE_MAX_BYTES,
      })
    ).rejects.toThrow(/maximum/i);
    expect(repository.loadExact).not.toHaveBeenCalled();
  });

  it('rejects a fixture-filesystem reader for a non-fixture custody row', async () => {
    const bytes = new TextEncoder().encode('{}');
    const reference = createAflTradeByteArtifactRef(
      bytes,
      'application/json',
      '2026-08-08T00:00:00.000Z'
    );
    const repository = {
      ...durableReader(reference, bytes),
      assurance: 'fixture_filesystem' as const,
      custodyProfile: null,
    };
    const source = createPostgresAflTradeProjectionArtifactReleaseSource({
      client: new QueryFixture([
        {
          projection_id: `projection:${'1'.repeat(64)}`,
          artifact_id: reference.artifactId,
          content_sha256: reference.contentSha256,
          storage_uri: reference.storageUri,
          media_type: reference.mediaType,
          byte_length: String(reference.byteLength),
          created_at: reference.createdAt,
          artifact_class: 'public_projection',
          environment: 'non_production',
          custody_profile_id: null,
        },
      ]),
      artifactRepository: repository,
    });

    await expect(
      source.loadRelease(`projection:${'1'.repeat(64)}`, {
        maxBytes: AFL_TRADE_PROJECTION_ARTIFACT_READ_RELEASE_MAX_BYTES,
      })
    ).rejects.toThrow(/custody metadata/i);
    expect(repository.loadExact).not.toHaveBeenCalled();
  });

  it('refuses to compose against fixture memory or another custody class', () => {
    const bytes = new TextEncoder().encode('{}');
    const reference = createAflTradeByteArtifactRef(
      bytes,
      'application/json',
      '2026-08-08T00:00:00.000Z'
    );
    const repository = {
      ...durableReader(reference, bytes),
      assurance: 'fixture_memory' as const,
    };

    expect(() =>
      createPostgresAflTradeProjectionArtifactReleaseSource({
        client: new QueryFixture([]),
        artifactRepository: repository,
      })
    ).toThrow(/durable/i);

    expect(() =>
      createPostgresAflTradeProjectionArtifactReleaseSource({
        client: new QueryFixture([]),
        artifactRepository: {
          ...durableReader(reference, bytes),
          assurance: 'fixture_filesystem',
        },
      })
    ).toThrow(/durable/i);
  });
});
