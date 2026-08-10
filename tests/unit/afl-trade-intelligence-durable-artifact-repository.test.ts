import { describe, expect, it } from 'vitest';

import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeArtifactCustodyProfile } from '@/server/aflTradeIntelligence/artifacts/artifactCustodyProfile';
import {
  AflTradeConditionalObjectStoreError,
  type AflTradeConditionalObjectCreateRequest,
  type AflTradeConditionalObjectIdentity,
  type AflTradeConditionalObjectReadRequest,
  type AflTradeConditionalObjectStore,
} from '@/server/aflTradeIntelligence/artifacts/conditionalObjectStore';
import { createAflTradeDurableObjectArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/durableObjectArtifactRepository';
import { verifyAflTradeArtifactReadback } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';

const sha = (character: string) => character.repeat(64);

function profile(
  maximumObjectBytes = 1024,
  overrides?: {
    environment?: 'test_fixture' | 'non_production' | 'production';
    providerManagedEncryption?: boolean;
    worm?: { mode: 'governance' | 'compliance'; minimumDays: number } | null;
    maximumDays?: number;
  }
) {
  return createAflTradeArtifactCustodyProfile({
    schemaVersion: 'afl-trade-artifact-custody-profile/v1',
    subject: 'afl-trade-intelligence',
    contractRole: 'requirements_only_not_readiness_or_authorization',
    repositoryId: 'afl-trade-source-evidence',
    environment: overrides?.environment ?? 'non_production',
    artifactClass: 'raw_source',
    maximumObjectBytes,
    keyDerivation: 'profile_sha256_two_level_fanout_v1',
    conditionalCreate: 'if_none_match_star_required',
    encryption: {
      inTransit: 'tls_required',
      atRest: overrides?.providerManagedEncryption
        ? { mode: 'provider_managed', keyReferenceSha256: null }
        : { mode: 'customer_managed', keyReferenceSha256: sha('b') },
    },
    retention: {
      deletion: {
        kind: 'maximum_age',
        maximumDays: overrides?.maximumDays ?? 30,
        enforcement: 'provider_lifecycle_required',
      },
      deleteOnWithdrawal: overrides?.worm === undefined || overrides.worm === null,
      worm: overrides?.worm ?? null,
    },
    residency: {
      allowedJurisdictions: ['Australia'],
      crossJurisdictionTransfer: 'prohibited',
    },
    infrastructureEvidenceIds: [`storage-policy:${sha('c')}`],
  });
}

class FakeConditionalObjectStore implements AflTradeConditionalObjectStore {
  readonly objects = new Map<
    string,
    { identity: AflTradeConditionalObjectIdentity; bytes: Uint8Array }
  >();
  readCalls = 0;
  createConflictCount = 0;
  encryptionKeyReferenceSha256 = sha('b');
  providerManagedEncryption = false;
  writeOnceRetention: AflTradeConditionalObjectIdentity['writeOnceRetention'] = null;
  readIdentityPatch: Partial<AflTradeConditionalObjectIdentity> | null = null;

  async createIfAbsent(request: AflTradeConditionalObjectCreateRequest) {
    if (this.createConflictCount > 0) {
      this.createConflictCount -= 1;
      throw new AflTradeConditionalObjectStoreError(
        'PRECONDITION_FAILED',
        'Fabricated concurrent writer conflict.'
      );
    }
    if (this.objects.has(request.objectKey)) {
      throw new AflTradeConditionalObjectStoreError(
        'ALREADY_EXISTS',
        'Fabricated existing object.'
      );
    }
    const identity: AflTradeConditionalObjectIdentity = {
      objectKey: request.objectKey,
      versionId: 'version-1',
      eTag: 'opaque-multipart-etag-not-a-digest',
      byteLength: request.bytes.byteLength,
      mediaType: request.mediaType,
      checksumSha256: request.checksumSha256,
      metadata: { ...request.metadata },
      encryption: this.providerManagedEncryption
        ? { mode: 'provider_managed', keyReferenceSha256: null }
        : {
            mode: 'provider_kms',
            keyReferenceSha256: this.encryptionKeyReferenceSha256,
          },
      writeOnceRetention: this.writeOnceRetention,
    };
    this.objects.set(request.objectKey, {
      identity,
      bytes: Uint8Array.from(request.bytes),
    });
    return identity;
  }

  async headExact(request: { objectKey: string }) {
    return this.objects.get(request.objectKey)?.identity ?? null;
  }

  async readExactBounded(request: AflTradeConditionalObjectReadRequest) {
    this.readCalls += 1;
    const stored = this.objects.get(request.objectKey);
    if (stored === undefined) {
      throw new AflTradeConditionalObjectStoreError('NOT_FOUND', 'Fabricated missing object.');
    }
    if (stored.bytes.byteLength > request.maximumBytes) {
      throw new AflTradeConditionalObjectStoreError(
        'OBJECT_TOO_LARGE',
        'Fabricated stream overflow.'
      );
    }
    return {
      identity: { ...stored.identity, ...this.readIdentityPatch },
      bytes: Uint8Array.from(stored.bytes),
    };
  }
}

describe('durable AFL trade artifact repository', () => {
  it('creates once, preserves first-writer metadata, and verifies bounded bytes independently', async () => {
    const store = new FakeConditionalObjectStore();
    const repository = createAflTradeDurableObjectArtifactRepository({
      objectStore: store,
      custodyProfile: profile(),
    });
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const first = createAflTradeByteArtifactRef(
      bytes,
      'application/octet-stream',
      '2026-08-07T01:00:00.000Z'
    );
    const later = createAflTradeByteArtifactRef(bytes, first.mediaType, '2026-08-07T02:00:00.000Z');

    await expect(repository.putIfAbsentWithObservation(first, bytes)).resolves.toMatchObject({
      status: 'stored',
      reference: first,
      observation: {
        assurance: 'durable_object_storage',
        opaqueEntityTag: 'opaque-multipart-etag-not-a-digest',
      },
    });
    await expect(repository.putIfAbsentWithObservation(later, bytes)).resolves.toMatchObject({
      status: 'already_present',
      reference: first,
    });
    const loaded = await repository.loadExactWithObservation(first, 4);
    expect(loaded).toMatchObject({ reference: first, bytes });
    expect(store.readCalls).toBe(1);
    expect(loaded?.observation.providerChecksumSha256).toBe(first.contentSha256);
    await expect(
      verifyAflTradeArtifactReadback(
        repository,
        first,
        '2026-08-07T03:00:00.000Z',
        bytes.byteLength
      )
    ).resolves.toMatchObject({
      content: {
        schemaVersion: 'afl-trade-artifact-readback/v4',
        repositoryAssurance: 'durable_object_storage',
        artifactClass: 'raw_source',
        custodyProfileId: repository.custodyProfile.profileId,
        custodyProfile: repository.custodyProfile,
        custodyEnvironment: 'non_production',
      },
    });
  });

  it('retries a bounded create conflict and never reads after an oversized HEAD', async () => {
    const store = new FakeConditionalObjectStore();
    store.createConflictCount = 1;
    const repository = createAflTradeDurableObjectArtifactRepository({
      objectStore: store,
      custodyProfile: profile(4),
    });
    const bytes = Uint8Array.from([5, 6, 7, 8]);
    const reference = createAflTradeByteArtifactRef(
      bytes,
      'application/octet-stream',
      '2026-08-07T01:00:00.000Z'
    );
    await expect(repository.putIfAbsent(reference, bytes)).resolves.toMatchObject({
      status: 'stored',
    });
    await expect(repository.loadExact(reference, 3)).rejects.toMatchObject({
      code: 'ARTIFACT_TOO_LARGE',
    });
    expect(store.readCalls).toBe(0);
  });

  it('fails closed on profile, metadata, media, and conditional-read drift', async () => {
    const store = new FakeConditionalObjectStore();
    const repository = createAflTradeDurableObjectArtifactRepository({
      objectStore: store,
      custodyProfile: profile(),
    });
    const bytes = Uint8Array.from([9, 10]);
    const reference = createAflTradeByteArtifactRef(
      bytes,
      'application/octet-stream',
      '2026-08-07T01:00:00.000Z'
    );
    await repository.putIfAbsent(reference, bytes);
    store.encryptionKeyReferenceSha256 = sha('d');
    const anotherBytes = Uint8Array.from([11, 12]);
    const anotherReference = createAflTradeByteArtifactRef(
      anotherBytes,
      reference.mediaType,
      reference.createdAt
    );
    await expect(repository.putIfAbsent(anotherReference, anotherBytes)).rejects.toMatchObject({
      code: 'STORAGE_POLICY_MISMATCH',
    });
    store.readIdentityPatch = { mediaType: 'text/plain' };
    await expect(repository.loadExact(reference, 10)).rejects.toMatchObject({
      code: 'READBACK_MISMATCH',
    });
  });

  it('supports an explicitly required provider-managed encryption observation', async () => {
    const store = new FakeConditionalObjectStore();
    store.providerManagedEncryption = true;
    const repository = createAflTradeDurableObjectArtifactRepository({
      objectStore: store,
      custodyProfile: profile(1024, { providerManagedEncryption: true }),
    });
    const bytes = Uint8Array.from([13, 14]);
    const reference = createAflTradeByteArtifactRef(
      bytes,
      'application/octet-stream',
      '2026-08-07T01:00:00.000Z'
    );

    await expect(repository.putIfAbsentWithObservation(reference, bytes)).resolves.toMatchObject({
      observation: { encryption: { mode: 'provider_managed', keyReferenceSha256: null } },
    });
  });

  it('rejects observed WORM retention that outlives the maximum deletion deadline', async () => {
    const store = new FakeConditionalObjectStore();
    store.writeOnceRetention = {
      mode: 'compliance',
      retainUntil: '2026-09-08T01:00:00.000Z',
      legalHold: 'off',
    };
    const repository = createAflTradeDurableObjectArtifactRepository({
      objectStore: store,
      custodyProfile: profile(1024, {
        maximumDays: 30,
        worm: { mode: 'compliance', minimumDays: 7 },
      }),
    });
    const bytes = Uint8Array.from([15, 16]);
    const reference = createAflTradeByteArtifactRef(
      bytes,
      'application/octet-stream',
      '2026-08-07T01:00:00.000Z'
    );

    await expect(repository.putIfAbsent(reference, bytes)).rejects.toMatchObject({
      code: 'STORAGE_POLICY_MISMATCH',
    });
  });
});
