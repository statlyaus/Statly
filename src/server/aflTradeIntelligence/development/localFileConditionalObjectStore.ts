import { createHash, randomUUID } from 'node:crypto';
import { constants, lstatSync, mkdirSync, realpathSync, type Stats } from 'node:fs';
import { link, lstat, open, readdir, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import {
  aflTradeArtifactRefSchema,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  AflTradeConditionalObjectStoreError,
  type AflTradeConditionalObjectCreateRequest,
  type AflTradeConditionalObjectIdentity,
  type AflTradeConditionalObjectReadRequest,
  type AflTradeConditionalObjectStore,
} from '../artifacts/conditionalObjectStore';
import type { AflTradeArtifactCustodyClass } from '../artifacts/artifactCustodyProfile';
import {
  AflTradeArtifactCustodyError,
  type AflTradeImmutableArtifactRepository,
} from '../artifacts/immutableArtifactRepository';

const ENVELOPE_SCHEMA_VERSION = 'statly-local-conditional-object/v1';
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAXIMUM_OBJECT_KEY_BYTES = 1_024;
const MAXIMUM_ENVELOPE_BYTES = 192 * 1024 * 1024;
const UUID_V4_PATTERN_SOURCE =
  '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

interface StoredEnvelope {
  schemaVersion: typeof ENVELOPE_SCHEMA_VERSION;
  identity: AflTradeConditionalObjectIdentity;
  bytesBase64: string;
}

function fail(
  code: ConstructorParameters<typeof AflTradeConditionalObjectStoreError>[0],
  message: string
): never {
  throw new AflTradeConditionalObjectStoreError(code, message);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function exactRecord(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>
): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([key, value], index) =>
        rightEntries[index]?.[0] === key && rightEntries[index]?.[1] === value
    )
  );
}

function validateObjectKey(objectKey: string): string[] {
  const segments = objectKey.split('/');
  if (
    objectKey === '' ||
    Buffer.byteLength(objectKey, 'utf8') > MAXIMUM_OBJECT_KEY_BYTES ||
    objectKey.startsWith('/') ||
    objectKey.endsWith('/') ||
    objectKey.includes('\\') ||
    segments.some(
      (segment) =>
        segment === '' ||
        segment === '.' ||
        segment === '..' ||
        [...segment].some((character) => (character.codePointAt(0) ?? 0) <= 31)
    )
  ) {
    fail('INVALID_REQUEST', 'Local object custody requires one closed relative object key.');
  }
  return segments;
}

function validateMetadata(metadata: Readonly<Record<string, string>>): Record<string, string> {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    fail('INVALID_REQUEST', 'Local object metadata must be one string record.');
  }
  const entries = Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0 || entries.length > 64) {
    fail('INVALID_REQUEST', 'Local object metadata must contain between one and 64 entries.');
  }
  const validated: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (
      !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(key) ||
      typeof value !== 'string' ||
      value === '' ||
      value !== value.trim() ||
      value.length > 2_048
    ) {
      fail('INVALID_REQUEST', 'Local object metadata contains an invalid key or value.');
    }
    validated[key] = value;
  }
  return validated;
}

function identityFor(
  request: AflTradeConditionalObjectCreateRequest
): AflTradeConditionalObjectIdentity {
  if (
    request.mediaType.trim() === '' ||
    !SHA256_PATTERN.test(request.checksumSha256) ||
    sha256(request.bytes) !== request.checksumSha256
  ) {
    fail('INVALID_REQUEST', 'Local object bytes require exact media type and SHA-256 identity.');
  }
  const metadata = validateMetadata(request.metadata);
  return {
    objectKey: request.objectKey,
    versionId: `local-sha256-${request.checksumSha256}`,
    eTag: `sha256-${request.checksumSha256}`,
    byteLength: request.bytes.byteLength,
    mediaType: request.mediaType,
    checksumSha256: request.checksumSha256,
    metadata,
    encryption: { mode: 'local_filesystem_unencrypted', keyReferenceSha256: null },
    writeOnceRetention: null,
  };
}

function validateEnvelope(value: unknown, objectKey: string): StoredEnvelope {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INTEGRITY_MISMATCH', 'Local object custody returned an invalid envelope.');
  }
  const envelope = value as Partial<StoredEnvelope>;
  const identity = envelope.identity;
  if (
    envelope.schemaVersion !== ENVELOPE_SCHEMA_VERSION ||
    identity === undefined ||
    identity === null ||
    typeof identity !== 'object' ||
    Array.isArray(identity) ||
    identity.objectKey !== objectKey ||
    typeof envelope.bytesBase64 !== 'string'
  ) {
    fail('INTEGRITY_MISMATCH', 'Local object custody returned mismatched immutable identity.');
  }
  const bytes = Buffer.from(envelope.bytesBase64, 'base64');
  if (
    bytes.toString('base64') !== envelope.bytesBase64 ||
    bytes.byteLength !== identity.byteLength ||
    sha256(bytes) !== identity.checksumSha256 ||
    identity.versionId !== `local-sha256-${identity.checksumSha256}` ||
    identity.eTag !== `sha256-${identity.checksumSha256}` ||
    identity.encryption?.mode !== 'local_filesystem_unencrypted' ||
    identity.encryption.keyReferenceSha256 !== null ||
    identity.writeOnceRetention !== null
  ) {
    fail('INTEGRITY_MISMATCH', 'Local object custody failed exact envelope verification.');
  }
  validateMetadata(identity.metadata);
  return envelope as StoredEnvelope;
}

export function createLocalAflTradeFileConditionalObjectStore(options: {
  rootDirectory: string;
}): AflTradeConditionalObjectStore {
  if (!isAbsolute(options.rootDirectory)) {
    fail('INVALID_REQUEST', 'Local object custody requires one absolute root directory.');
  }
  const rootDirectory = resolve(options.rootDirectory);
  mkdirSync(rootDirectory, { recursive: true, mode: 0o700 });
  const initialRootDetails = lstatSync(rootDirectory);
  if (initialRootDetails.isSymbolicLink() || !initialRootDetails.isDirectory()) {
    fail('INVALID_REQUEST', 'Local object custody requires one real root directory.');
  }
  const canonicalRoot = realpathSync(rootDirectory);
  const anchoredRootDetails = lstatSync(canonicalRoot);
  if (
    anchoredRootDetails.dev !== initialRootDetails.dev ||
    anchoredRootDetails.ino !== initialRootDetails.ino
  ) {
    fail('INVALID_REQUEST', 'Local object custody could not anchor its root directory.');
  }

  async function assertAnchoredRoot(): Promise<void> {
    const currentRootDetails = await lstat(rootDirectory).catch(() => null);
    if (
      currentRootDetails === null ||
      currentRootDetails.isSymbolicLink() ||
      !currentRootDetails.isDirectory() ||
      currentRootDetails.dev !== anchoredRootDetails.dev ||
      currentRootDetails.ino !== anchoredRootDetails.ino ||
      (await realpath(rootDirectory)) !== canonicalRoot
    ) {
      fail('INVALID_REQUEST', 'Local object custody root identity changed after composition.');
    }
  }

  async function recoverOwnedLinksAndAssertAnchoredEnvelope(
    path: string,
    handle: Awaited<ReturnType<typeof open>>,
    objectKey?: string
  ): Promise<void> {
    await assertAnchoredRoot();
    let [pathDetails, handleDetails] = await Promise.all([lstat(path), handle.stat()]);
    if (
      pathDetails.isSymbolicLink() ||
      !pathDetails.isFile() ||
      pathDetails.dev !== handleDetails.dev ||
      pathDetails.ino !== handleDetails.ino
    ) {
      fail('INVALID_REQUEST', 'Local object custody envelope identity changed during open.');
    }
    if (pathDetails.nlink > 1 && objectKey !== undefined) {
      await recoverOwnedPendingLinks(objectKey, handleDetails);
      [pathDetails, handleDetails] = await Promise.all([lstat(path), handle.stat()]);
    }
    if (
      pathDetails.nlink !== 1 ||
      pathDetails.dev !== handleDetails.dev ||
      pathDetails.ino !== handleDetails.ino
    ) {
      fail('INVALID_REQUEST', 'Local object custody envelope has unexplained filesystem links.');
    }
  }

  async function recoverOwnedPendingLinks(
    objectKey: string,
    envelopeDetails: Stats
  ): Promise<void> {
    const encodedKey = sha256(new TextEncoder().encode(objectKey));
    const pendingNamePattern = new RegExp(
      `^\\.pending-${encodedKey}-${UUID_V4_PATTERN_SOURCE}\\.json$`,
      'u'
    );
    for (const entry of await readdir(canonicalRoot)) {
      if (!pendingNamePattern.test(entry)) continue;
      const candidatePath = resolve(canonicalRoot, entry);
      const candidate = await lstat(candidatePath).catch(() => null);
      if (
        candidate !== null &&
        !candidate.isSymbolicLink() &&
        candidate.isFile() &&
        candidate.dev === envelopeDetails.dev &&
        candidate.ino === envelopeDetails.ino
      ) {
        await unlink(candidatePath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    }
  }

  async function envelopePath(objectKey: string): Promise<string> {
    validateObjectKey(objectKey);
    const encodedKey = sha256(new TextEncoder().encode(objectKey));
    await assertAnchoredRoot();
    return resolve(canonicalRoot, `${encodedKey}.json`);
  }

  async function pendingEnvelopePath(objectKey: string): Promise<string> {
    validateObjectKey(objectKey);
    const encodedKey = sha256(new TextEncoder().encode(objectKey));
    await assertAnchoredRoot();
    return resolve(canonicalRoot, `.pending-${encodedKey}-${randomUUID()}.json`);
  }

  async function syncRootDirectory(): Promise<void> {
    const rootHandle = await open(canonicalRoot, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await assertAnchoredRoot();
      await rootHandle.sync();
    } finally {
      await rootHandle.close();
    }
  }

  async function loadEnvelope(objectKey: string): Promise<StoredEnvelope | null> {
    const path = await envelopePath(objectKey);
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      await recoverOwnedLinksAndAssertAnchoredEnvelope(path, handle, objectKey);
      const details = await handle.stat();
      if (!details.isFile() || details.size > MAXIMUM_ENVELOPE_BYTES) {
        fail('OBJECT_TOO_LARGE', 'Local object envelope exceeds its fixed read bound.');
      }
      return validateEnvelope(JSON.parse(await handle.readFile('utf8')), objectKey);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        fail('INVALID_REQUEST', 'Local object custody rejects linked envelope targets.');
      }
      if (error instanceof SyntaxError) {
        fail('INTEGRITY_MISMATCH', 'Local object custody returned malformed envelope JSON.');
      }
      if (error instanceof AflTradeConditionalObjectStoreError) throw error;
      fail('TRANSPORT_FAILURE', 'Local object custody could not read its immutable envelope.');
    } finally {
      await handle?.close();
    }
    return null;
  }

  return {
    async createIfAbsent(request) {
      const path = await envelopePath(request.objectKey);
      const pendingPath = await pendingEnvelopePath(request.objectKey);
      const identity = identityFor(request);
      const envelope: StoredEnvelope = {
        schemaVersion: ENVELOPE_SCHEMA_VERSION,
        identity,
        bytesBase64: Buffer.from(request.bytes).toString('base64'),
      };
      let handle: Awaited<ReturnType<typeof open>> | null = null;
      try {
        handle = await open(
          pendingPath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
          0o600
        );
        await recoverOwnedLinksAndAssertAnchoredEnvelope(pendingPath, handle);
        await handle.writeFile(JSON.stringify(envelope), 'utf8');
        await handle.sync();
        await recoverOwnedLinksAndAssertAnchoredEnvelope(pendingPath, handle);
        await handle.close();
        handle = null;

        await assertAnchoredRoot();
        await link(pendingPath, path);
        await unlink(pendingPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
        await syncRootDirectory();

        const readback = await loadEnvelope(request.objectKey);
        if (
          readback === null ||
          readback.identity.versionId !== identity.versionId ||
          readback.identity.eTag !== identity.eTag ||
          readback.identity.byteLength !== identity.byteLength ||
          readback.identity.mediaType !== identity.mediaType ||
          readback.identity.checksumSha256 !== identity.checksumSha256 ||
          !exactRecord(readback.identity.metadata, identity.metadata)
        ) {
          fail('INTEGRITY_MISMATCH', 'Local object custody failed exact publication read-back.');
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          await unlink(pendingPath).catch((cleanupError: NodeJS.ErrnoException) => {
            if (cleanupError.code !== 'ENOENT') throw cleanupError;
          });
          const existing = await loadEnvelope(request.objectKey);
          if (existing === null) {
            fail(
              'TRANSPORT_FAILURE',
              'The conflicting local object disappeared before validation.'
            );
          }
          fail('ALREADY_EXISTS', 'The immutable local object key already exists.');
        }
        if (error instanceof AflTradeConditionalObjectStoreError) throw error;
        fail('TRANSPORT_FAILURE', 'Local object custody could not create its immutable envelope.');
      } finally {
        await handle?.close();
        await unlink(pendingPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') return;
        });
      }
      return identity;
    },
    async headExact(request) {
      return (await loadEnvelope(request.objectKey))?.identity ?? null;
    },
    async readExactBounded(request: AflTradeConditionalObjectReadRequest) {
      if (!Number.isSafeInteger(request.maximumBytes) || request.maximumBytes <= 0) {
        fail('INVALID_REQUEST', 'Local object reads require one positive safe-integer bound.');
      }
      if (request.expectedByteLength > request.maximumBytes) {
        fail('OBJECT_TOO_LARGE', 'The requested local object exceeds the caller read bound.');
      }
      const envelope = await loadEnvelope(request.objectKey);
      if (envelope === null) fail('NOT_FOUND', 'The immutable local object does not exist.');
      const identity = envelope.identity;
      if (
        identity.versionId !== request.versionId ||
        identity.eTag !== request.eTag ||
        identity.byteLength !== request.expectedByteLength ||
        identity.mediaType !== request.expectedMediaType ||
        identity.checksumSha256 !== request.expectedChecksumSha256 ||
        !exactRecord(identity.metadata, request.expectedMetadata)
      ) {
        fail('INTEGRITY_MISMATCH', 'The local object does not match its requested exact identity.');
      }
      return {
        identity,
        bytes: new Uint8Array(Buffer.from(envelope.bytesBase64, 'base64')),
      };
    },
  };
}

const LOCAL_REFERENCE_METADATA = {
  artifactId: 'statly-artifact-id',
  contentSha256: 'statly-content-sha256',
  storageUri: 'statly-storage-uri',
  mediaType: 'statly-media-type',
  byteLength: 'statly-byte-length',
  createdAt: 'statly-created-at',
} as const;

function localReferenceMetadata(reference: AflTradeArtifactRef): Readonly<Record<string, string>> {
  return {
    [LOCAL_REFERENCE_METADATA.artifactId]: reference.artifactId,
    [LOCAL_REFERENCE_METADATA.contentSha256]: reference.contentSha256,
    [LOCAL_REFERENCE_METADATA.storageUri]: reference.storageUri,
    [LOCAL_REFERENCE_METADATA.mediaType]: reference.mediaType,
    [LOCAL_REFERENCE_METADATA.byteLength]: String(reference.byteLength),
    [LOCAL_REFERENCE_METADATA.createdAt]: reference.createdAt,
  };
}

function localReferenceFromIdentity(
  identity: AflTradeConditionalObjectIdentity
): AflTradeArtifactRef {
  const metadata = identity.metadata;
  const parsed = aflTradeArtifactRefSchema.safeParse({
    artifactId: metadata[LOCAL_REFERENCE_METADATA.artifactId],
    contentSha256: metadata[LOCAL_REFERENCE_METADATA.contentSha256],
    storageUri: metadata[LOCAL_REFERENCE_METADATA.storageUri],
    mediaType: metadata[LOCAL_REFERENCE_METADATA.mediaType],
    byteLength: Number(metadata[LOCAL_REFERENCE_METADATA.byteLength]),
    createdAt: metadata[LOCAL_REFERENCE_METADATA.createdAt],
  });
  if (
    !parsed.success ||
    parsed.data.contentSha256 !== identity.checksumSha256 ||
    parsed.data.byteLength !== identity.byteLength ||
    parsed.data.mediaType !== identity.mediaType
  ) {
    throw new AflTradeArtifactCustodyError(
      'READBACK_MISMATCH',
      'Local fixture bytes do not match their immutable reference metadata.'
    );
  }
  return parsed.data;
}

function createLocalAflTradeFilesystemArtifactRepository(options: {
  rootDirectory: string;
  repositoryId: string;
  artifactClass: AflTradeArtifactCustodyClass;
  maximumObjectBytes: number;
  assurance: Extract<
    AflTradeImmutableArtifactRepository['assurance'],
    'fixture_filesystem' | 'local_non_production_filesystem'
  >;
}): AflTradeImmutableArtifactRepository {
  const boundaryLabel =
    options.assurance === 'fixture_filesystem'
      ? 'Local fixture custody'
      : 'Local non-production capture custody';
  if (!Number.isSafeInteger(options.maximumObjectBytes) || options.maximumObjectBytes <= 0) {
    throw new TypeError(`${boundaryLabel} requires one positive safe-integer object bound.`);
  }
  const store = createLocalAflTradeFileConditionalObjectStore({
    rootDirectory: resolve(options.rootDirectory, options.repositoryId),
  });
  const objectKey = (sha256Value: string) =>
    `${options.assurance}/sha256/${sha256Value.slice(0, 2)}/${sha256Value.slice(2, 4)}/${sha256Value}`;

  async function loadExact(reference: AflTradeArtifactRef, maximumBytes: number) {
    const parsed = aflTradeArtifactRefSchema.safeParse(reference);
    if (!parsed.success) {
      throw new AflTradeArtifactCustodyError(
        'INVALID_REFERENCE',
        `${boundaryLabel} requires one valid immutable reference.`
      );
    }
    const readBound = Math.min(maximumBytes, options.maximumObjectBytes);
    if (
      !Number.isSafeInteger(maximumBytes) ||
      maximumBytes <= 0 ||
      parsed.data.byteLength > readBound
    ) {
      throw new AflTradeArtifactCustodyError(
        'ARTIFACT_TOO_LARGE',
        `The ${boundaryLabel.toLowerCase()} artifact exceeds its exact read bound.`
      );
    }
    const key = objectKey(parsed.data.contentSha256);
    const head = await store.headExact({ objectKey: key });
    if (head === null) return null;
    const storedReference = localReferenceFromIdentity(head);
    if (!doAflTradeArtifactRefsExactlyMatch(storedReference, parsed.data)) {
      throw new AflTradeArtifactCustodyError(
        'READBACK_MISMATCH',
        `The ${boundaryLabel.toLowerCase()} object differs from its requested immutable reference.`
      );
    }
    const loaded = await store.readExactBounded({
      objectKey: key,
      versionId: head.versionId,
      eTag: head.eTag,
      expectedByteLength: head.byteLength,
      expectedMediaType: head.mediaType,
      expectedChecksumSha256: head.checksumSha256,
      expectedMetadata: head.metadata,
      maximumBytes: readBound,
    });
    if (
      !doesAflTradeArtifactRefMatchBytes(storedReference, loaded.bytes, storedReference.mediaType)
    ) {
      throw new AflTradeArtifactCustodyError(
        'READBACK_MISMATCH',
        `The ${boundaryLabel.toLowerCase()} object bytes failed exact SHA-256 read-back.`
      );
    }
    return { reference: storedReference, bytes: Uint8Array.from(loaded.bytes) };
  }

  return {
    assurance: options.assurance,
    artifactClass: options.artifactClass,
    custodyProfile: null,
    async putIfAbsent(reference, bytes) {
      const parsed = aflTradeArtifactRefSchema.safeParse(reference);
      if (!parsed.success) {
        throw new AflTradeArtifactCustodyError(
          'INVALID_REFERENCE',
          `${boundaryLabel} requires one valid immutable reference.`
        );
      }
      if (
        bytes.byteLength > options.maximumObjectBytes ||
        !doesAflTradeArtifactRefMatchBytes(parsed.data, bytes, parsed.data.mediaType)
      ) {
        throw new AflTradeArtifactCustodyError(
          bytes.byteLength > options.maximumObjectBytes ? 'ARTIFACT_TOO_LARGE' : 'INVALID_BYTES',
          `${boundaryLabel} requires bounded bytes matching the immutable reference.`
        );
      }
      try {
        await store.createIfAbsent({
          objectKey: objectKey(parsed.data.contentSha256),
          bytes,
          mediaType: parsed.data.mediaType,
          checksumSha256: parsed.data.contentSha256,
          metadata: localReferenceMetadata(parsed.data),
        });
        return { status: 'stored', reference: parsed.data };
      } catch (error) {
        if (
          !(error instanceof AflTradeConditionalObjectStoreError) ||
          error.code !== 'ALREADY_EXISTS'
        ) {
          throw error;
        }
        const existing = await loadExact(parsed.data, options.maximumObjectBytes);
        if (existing === null) {
          throw new AflTradeArtifactCustodyError(
            'STORAGE_UNAVAILABLE',
            `The ${boundaryLabel.toLowerCase()} object disappeared after a conditional-create conflict.`
          );
        }
        return { status: 'already_present', reference: existing.reference };
      }
    },
    loadExact,
  };
}

/** Fixture-only filesystem composition shared by the local seeder and local public reader. */
export function createLocalAflTradeArtifactRepository(options: {
  rootDirectory: string;
  repositoryId: string;
  artifactClass: Extract<AflTradeArtifactCustodyClass, 'derived_private' | 'public_projection'>;
  maximumObjectBytes: number;
}): AflTradeImmutableArtifactRepository {
  return createLocalAflTradeFilesystemArtifactRepository({
    ...options,
    assurance: 'fixture_filesystem',
  });
}

/**
 * Immutable local custody for one explicitly approved non-production provider capture. It is not
 * durable-object assurance and cannot satisfy production or public-release storage requirements.
 */
export function createLocalAflTradeNonProductionArtifactRepository(options: {
  rootDirectory: string;
  repositoryId: string;
  artifactClass: Extract<AflTradeArtifactCustodyClass, 'raw_source' | 'capture_metadata'>;
  maximumObjectBytes: number;
}): AflTradeImmutableArtifactRepository {
  return createLocalAflTradeFilesystemArtifactRepository({
    ...options,
    assurance: 'local_non_production_filesystem',
  });
}
