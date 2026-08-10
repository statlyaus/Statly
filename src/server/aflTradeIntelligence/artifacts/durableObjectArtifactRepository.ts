import {
  aflTradeArtifactRefSchema,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
  type AflTradeArtifactRef,
} from './artifactReference';
import {
  type AflTradeArtifactCustodyProfile,
  aflTradeArtifactCustodyProfileSchema,
} from './artifactCustodyProfile';
import {
  AflTradeConditionalObjectStoreError,
  type AflTradeConditionalObjectIdentity,
  type AflTradeConditionalObjectStore,
} from './conditionalObjectStore';
import {
  AflTradeArtifactCustodyError,
  type AflTradeImmutableArtifactRepository,
} from './immutableArtifactRepository';

const STORED_METADATA_SCHEMA_VERSION = 'afl-trade-object-metadata/v1';
const MAXIMUM_CONFLICT_ATTEMPTS = 3;

const METADATA_KEYS = {
  schemaVersion: 'statly-schema-version',
  artifactId: 'statly-artifact-id',
  contentSha256: 'statly-content-sha256',
  storageUri: 'statly-storage-uri',
  mediaType: 'statly-media-type',
  byteLength: 'statly-byte-length',
  createdAt: 'statly-created-at',
  profileId: 'statly-profile-id',
  repositoryId: 'statly-repository-id',
} as const;

export interface AflTradeDurableObjectCustodyObservation {
  assurance: 'durable_object_storage';
  artifactClass: AflTradeArtifactCustodyProfile['content']['artifactClass'];
  repositoryId: string;
  profileId: string;
  objectKey: string;
  objectVersionId: string;
  opaqueEntityTag: string;
  providerChecksumSha256: string;
  conditionalCreate: 'if_none_match_star_required';
  encryption: AflTradeConditionalObjectIdentity['encryption'];
  writeOnceRetention: AflTradeConditionalObjectIdentity['writeOnceRetention'];
  maximumRetentionObservation: 'attested_infrastructure_policy_not_object_observable';
  infrastructureEvidenceIds: readonly string[];
}

export interface AflTradeDurableObjectArtifactRepository extends AflTradeImmutableArtifactRepository {
  readonly assurance: 'durable_object_storage';
  readonly artifactClass: AflTradeArtifactCustodyProfile['content']['artifactClass'];
  readonly custodyProfile: AflTradeArtifactCustodyProfile;
  putIfAbsentWithObservation(
    reference: AflTradeArtifactRef,
    bytes: Uint8Array
  ): Promise<{
    status: 'stored' | 'already_present';
    reference: AflTradeArtifactRef;
    observation: AflTradeDurableObjectCustodyObservation;
  }>;
  loadExactWithObservation(
    reference: AflTradeArtifactRef,
    maximumBytes: number
  ): Promise<{
    reference: AflTradeArtifactRef;
    bytes: Uint8Array;
    observation: AflTradeDurableObjectCustodyObservation;
  } | null>;
}

export interface AflTradeDurableObjectArtifactRepositoryOptions {
  objectStore: AflTradeConditionalObjectStore;
  custodyProfile: AflTradeArtifactCustodyProfile;
}

function invalidReference(message: string): never {
  throw new AflTradeArtifactCustodyError('INVALID_REFERENCE', message);
}

function policyMismatch(message: string): never {
  throw new AflTradeArtifactCustodyError('STORAGE_POLICY_MISMATCH', message);
}

function storageUnavailable(message: string): never {
  throw new AflTradeArtifactCustodyError('STORAGE_UNAVAILABLE', message);
}

function requireMaximumBytes(maximumBytes: number, profileMaximum: number): number {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new AflTradeArtifactCustodyError(
      'ARTIFACT_TOO_LARGE',
      'Artifact reads require a positive safe-integer bound.'
    );
  }
  return Math.min(maximumBytes, profileMaximum);
}

function deriveObjectKey(profile: AflTradeArtifactCustodyProfile, sha256: string): string {
  return `${profile.profileId}/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}

function metadataFor(
  profile: AflTradeArtifactCustodyProfile,
  reference: AflTradeArtifactRef
): Readonly<Record<string, string>> {
  return {
    [METADATA_KEYS.schemaVersion]: STORED_METADATA_SCHEMA_VERSION,
    [METADATA_KEYS.artifactId]: reference.artifactId,
    [METADATA_KEYS.contentSha256]: reference.contentSha256,
    [METADATA_KEYS.storageUri]: reference.storageUri,
    [METADATA_KEYS.mediaType]: reference.mediaType,
    [METADATA_KEYS.byteLength]: String(reference.byteLength),
    [METADATA_KEYS.createdAt]: reference.createdAt,
    [METADATA_KEYS.profileId]: profile.profileId,
    [METADATA_KEYS.repositoryId]: profile.content.repositoryId,
  };
}

function metadataMatches(
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>
): boolean {
  const actualEntries = Object.entries(actual).sort(([left], [right]) => left.localeCompare(right));
  const expectedEntries = Object.entries(expected).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return (
    actualEntries.length === expectedEntries.length &&
    actualEntries.every(
      ([key, value], index) =>
        expectedEntries[index]?.[0] === key && expectedEntries[index]?.[1] === value
    )
  );
}

function referenceFromIdentity(
  profile: AflTradeArtifactCustodyProfile,
  identity: AflTradeConditionalObjectIdentity
): AflTradeArtifactRef {
  const metadata = identity.metadata;
  if (
    metadata[METADATA_KEYS.schemaVersion] !== STORED_METADATA_SCHEMA_VERSION ||
    metadata[METADATA_KEYS.profileId] !== profile.profileId ||
    metadata[METADATA_KEYS.repositoryId] !== profile.content.repositoryId
  ) {
    policyMismatch('Stored immutable metadata does not match the selected custody profile.');
  }
  const byteLength = Number(metadata[METADATA_KEYS.byteLength]);
  const parsed = aflTradeArtifactRefSchema.safeParse({
    artifactId: metadata[METADATA_KEYS.artifactId],
    contentSha256: metadata[METADATA_KEYS.contentSha256],
    storageUri: metadata[METADATA_KEYS.storageUri],
    mediaType: metadata[METADATA_KEYS.mediaType],
    byteLength,
    createdAt: metadata[METADATA_KEYS.createdAt],
  });
  if (
    !parsed.success ||
    parsed.data.byteLength !== identity.byteLength ||
    parsed.data.mediaType !== identity.mediaType ||
    parsed.data.contentSha256 !== identity.checksumSha256
  ) {
    throw new AflTradeArtifactCustodyError(
      'READBACK_MISMATCH',
      'Stored object identity does not match its immutable Statly reference metadata.'
    );
  }
  return parsed.data;
}

function requireIdentityPolicy(
  profile: AflTradeArtifactCustodyProfile,
  identity: AflTradeConditionalObjectIdentity
) {
  const encryption = profile.content.encryption.atRest;
  const encryptionMatches =
    (encryption.mode === 'provider_managed' &&
      identity.encryption.mode === 'provider_managed' &&
      identity.encryption.keyReferenceSha256 === null) ||
    (encryption.mode === 'customer_managed' &&
      identity.encryption.mode === 'provider_kms' &&
      identity.encryption.keyReferenceSha256 === encryption.keyReferenceSha256);
  if (!encryptionMatches) {
    policyMismatch('Provider-observed object encryption does not match the custody profile.');
  }
  const requiredWorm = profile.content.retention.worm;
  if (requiredWorm === null) {
    if (identity.writeOnceRetention !== null) {
      policyMismatch('The object has an unapproved write-once retention minimum.');
    }
    return;
  }
  const observedWorm = identity.writeOnceRetention;
  const acceptableMode =
    requiredWorm.mode === 'provider_enforced' || observedWorm?.mode === requiredWorm.mode;
  const minimumRetainUntil =
    Date.parse(identity.metadata[METADATA_KEYS.createdAt] ?? '') +
    requiredWorm.minimumDays * 24 * 60 * 60 * 1000;
  const maximumRetainUntil =
    profile.content.retention.deletion.kind === 'maximum_age'
      ? Date.parse(identity.metadata[METADATA_KEYS.createdAt] ?? '') +
        profile.content.retention.deletion.maximumDays * 24 * 60 * 60 * 1000
      : null;
  const observedRetainUntil =
    observedWorm?.retainUntil === null || observedWorm?.retainUntil === undefined
      ? Number.NaN
      : Date.parse(observedWorm.retainUntil);
  if (
    observedWorm === null ||
    !acceptableMode ||
    !Number.isFinite(minimumRetainUntil) ||
    !Number.isFinite(observedRetainUntil) ||
    observedRetainUntil < minimumRetainUntil ||
    (maximumRetainUntil !== null &&
      (!Number.isFinite(maximumRetainUntil) ||
        observedRetainUntil > maximumRetainUntil ||
        observedWorm.legalHold === 'on'))
  ) {
    policyMismatch('Provider-observed write-once retention does not satisfy the custody profile.');
  }
}

function observationFor(
  profile: AflTradeArtifactCustodyProfile,
  identity: AflTradeConditionalObjectIdentity
): AflTradeDurableObjectCustodyObservation {
  requireIdentityPolicy(profile, identity);
  return {
    assurance: 'durable_object_storage',
    artifactClass: profile.content.artifactClass,
    repositoryId: profile.content.repositoryId,
    profileId: profile.profileId,
    objectKey: identity.objectKey,
    objectVersionId: identity.versionId,
    opaqueEntityTag: identity.eTag,
    providerChecksumSha256: identity.checksumSha256,
    conditionalCreate: profile.content.conditionalCreate,
    encryption: identity.encryption,
    writeOnceRetention: identity.writeOnceRetention,
    maximumRetentionObservation: 'attested_infrastructure_policy_not_object_observable',
    infrastructureEvidenceIds: profile.content.infrastructureEvidenceIds,
  };
}

function mapStoreError(error: unknown): never {
  if (error instanceof AflTradeArtifactCustodyError) throw error;
  if (!(error instanceof AflTradeConditionalObjectStoreError)) {
    storageUnavailable('The immutable object store failed without a stable error category.');
  }
  switch (error.code) {
    case 'OBJECT_TOO_LARGE':
      throw new AflTradeArtifactCustodyError('ARTIFACT_TOO_LARGE', error.message);
    case 'INTEGRITY_MISMATCH':
      throw new AflTradeArtifactCustodyError('READBACK_MISMATCH', error.message);
    case 'INVALID_REQUEST':
      throw new AflTradeArtifactCustodyError('INVALID_REFERENCE', error.message);
    case 'NOT_FOUND':
      throw error;
    case 'ALREADY_EXISTS':
    case 'PRECONDITION_FAILED':
    case 'TRANSPORT_FAILURE':
      storageUnavailable('The immutable object store is unavailable for exact custody.');
  }
}

export function createAflTradeDurableObjectArtifactRepository(
  options: AflTradeDurableObjectArtifactRepositoryOptions
): AflTradeDurableObjectArtifactRepository {
  const profile = aflTradeArtifactCustodyProfileSchema.parse(options.custodyProfile);

  async function headStored(objectKey: string): Promise<AflTradeConditionalObjectIdentity | null> {
    try {
      return await options.objectStore.headExact({ objectKey });
    } catch (error) {
      mapStoreError(error);
    }
  }

  async function putIfAbsentWithObservation(reference: AflTradeArtifactRef, bytes: Uint8Array) {
    const parsedReference = aflTradeArtifactRefSchema.safeParse(reference);
    if (!parsedReference.success) invalidReference('Object custody requires one valid reference.');
    if (
      !doesAflTradeArtifactRefMatchBytes(
        parsedReference.data,
        bytes,
        parsedReference.data.mediaType
      )
    ) {
      throw new AflTradeArtifactCustodyError(
        'INVALID_BYTES',
        'Object custody bytes do not match their immutable reference.'
      );
    }
    if (bytes.byteLength > profile.content.maximumObjectBytes) {
      throw new AflTradeArtifactCustodyError(
        'ARTIFACT_TOO_LARGE',
        'Object custody bytes exceed the selected custody profile.'
      );
    }
    const objectKey = deriveObjectKey(profile, parsedReference.data.contentSha256);
    const metadata = metadataFor(profile, parsedReference.data);
    for (let attempt = 1; attempt <= MAXIMUM_CONFLICT_ATTEMPTS; attempt += 1) {
      try {
        const identity = await options.objectStore.createIfAbsent({
          objectKey,
          bytes,
          mediaType: parsedReference.data.mediaType,
          checksumSha256: parsedReference.data.contentSha256,
          metadata,
        });
        const storedReference = referenceFromIdentity(profile, identity);
        return {
          status: 'stored' as const,
          reference: storedReference,
          observation: observationFor(profile, identity),
        };
      } catch (error) {
        if (
          error instanceof AflTradeConditionalObjectStoreError &&
          (error.code === 'ALREADY_EXISTS' || error.code === 'PRECONDITION_FAILED')
        ) {
          const existing = await headStored(objectKey);
          if (existing !== null) {
            const storedReference = referenceFromIdentity(profile, existing);
            if (
              !metadataMatches(existing.metadata, metadataFor(profile, storedReference)) ||
              storedReference.mediaType !== parsedReference.data.mediaType ||
              storedReference.byteLength !== parsedReference.data.byteLength ||
              !doesAflTradeArtifactRefMatchBytes(storedReference, bytes, storedReference.mediaType)
            ) {
              throw new AflTradeArtifactCustodyError(
                'IMMUTABLE_CONFLICT',
                'Existing object metadata conflicts with the requested immutable artifact.'
              );
            }
            return {
              status: 'already_present' as const,
              reference: storedReference,
              observation: observationFor(profile, existing),
            };
          }
          if (attempt < MAXIMUM_CONFLICT_ATTEMPTS) continue;
        }
        mapStoreError(error);
      }
    }
    storageUnavailable('Conditional object creation did not converge within its retry bound.');
  }

  async function loadExactWithObservation(reference: AflTradeArtifactRef, maximumBytes: number) {
    const parsedReference = aflTradeArtifactRefSchema.safeParse(reference);
    if (!parsedReference.success)
      invalidReference('Exact object reads require one valid reference.');
    const readBound = requireMaximumBytes(maximumBytes, profile.content.maximumObjectBytes);
    if (parsedReference.data.byteLength > readBound) {
      throw new AflTradeArtifactCustodyError(
        'ARTIFACT_TOO_LARGE',
        'The declared artifact exceeds the permitted exact-read bound.'
      );
    }
    const objectKey = deriveObjectKey(profile, parsedReference.data.contentSha256);
    const head = await headStored(objectKey);
    if (head === null) return null;
    const storedReference = referenceFromIdentity(profile, head);
    if (!doAflTradeArtifactRefsExactlyMatch(storedReference, parsedReference.data)) {
      throw new AflTradeArtifactCustodyError(
        'READBACK_MISMATCH',
        'The requested reference differs from the first-writer immutable object metadata.'
      );
    }
    if (head.byteLength > readBound) {
      throw new AflTradeArtifactCustodyError(
        'ARTIFACT_TOO_LARGE',
        'The stored object exceeds the permitted exact-read bound.'
      );
    }
    let readResult;
    try {
      readResult = await options.objectStore.readExactBounded({
        objectKey,
        versionId: head.versionId,
        eTag: head.eTag,
        expectedByteLength: head.byteLength,
        expectedMediaType: head.mediaType,
        expectedChecksumSha256: head.checksumSha256,
        expectedMetadata: head.metadata,
        maximumBytes: readBound,
      });
    } catch (error) {
      if (error instanceof AflTradeConditionalObjectStoreError && error.code === 'NOT_FOUND') {
        throw new AflTradeArtifactCustodyError(
          'READBACK_MISMATCH',
          'The exact object version disappeared between metadata and bounded read.'
        );
      }
      mapStoreError(error);
    }
    const readReference = referenceFromIdentity(profile, readResult.identity);
    if (
      !doAflTradeArtifactRefsExactlyMatch(readReference, parsedReference.data) ||
      !metadataMatches(readResult.identity.metadata, head.metadata) ||
      !doesAflTradeArtifactRefMatchBytes(readReference, readResult.bytes, readReference.mediaType)
    ) {
      throw new AflTradeArtifactCustodyError(
        'READBACK_MISMATCH',
        'Bounded object bytes or metadata changed during exact read-back.'
      );
    }
    return {
      reference: readReference,
      bytes: Uint8Array.from(readResult.bytes),
      observation: observationFor(profile, readResult.identity),
    };
  }

  return {
    assurance: 'durable_object_storage',
    artifactClass: profile.content.artifactClass,
    custodyProfile: profile,
    async putIfAbsent(reference, bytes) {
      const result = await putIfAbsentWithObservation(reference, bytes);
      return { status: result.status, reference: result.reference };
    },
    async loadExact(reference, maximumBytes) {
      const result = await loadExactWithObservation(reference, maximumBytes);
      return result === null ? null : { reference: result.reference, bytes: result.bytes };
    },
    putIfAbsentWithObservation,
    loadExactWithObservation,
  };
}
