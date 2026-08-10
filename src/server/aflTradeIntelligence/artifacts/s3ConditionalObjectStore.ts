import { createHash } from 'node:crypto';

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type GetObjectCommandOutput,
  type HeadObjectCommandOutput,
  type PutObjectCommandOutput,
  type S3Client,
} from '@aws-sdk/client-s3';

import {
  AflTradeConditionalObjectStoreError,
  type AflTradeConditionalObjectCreateRequest,
  type AflTradeConditionalObjectHeadRequest,
  type AflTradeConditionalObjectIdentity,
  type AflTradeConditionalObjectReadRequest,
  type AflTradeConditionalObjectStore,
} from './conditionalObjectStore';

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const SHA256_BASE64_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const MAXIMUM_S3_KEY_BYTES = 1024;
const METADATA_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

export interface AflTradeS3ConditionalObjectStoreOptions {
  client: S3Client;
  bucket: string;
  keyPrefix: string;
  kmsKeyId: string;
}

interface AwsTransportError {
  name?: unknown;
  $metadata?: { httpStatusCode?: unknown };
}

function invalidRequest(message: string): never {
  throw new AflTradeConditionalObjectStoreError('INVALID_REQUEST', message);
}

function validateConfiguration(options: AflTradeS3ConditionalObjectStoreOptions) {
  if (options.bucket.trim() === '' || options.bucket !== options.bucket.trim()) {
    invalidRequest('S3 object custody requires one explicit bucket name.');
  }
  if (
    options.keyPrefix === '' ||
    options.keyPrefix.startsWith('/') ||
    options.keyPrefix.endsWith('/') ||
    options.keyPrefix.includes('..') ||
    options.keyPrefix.includes('\\')
  ) {
    invalidRequest('S3 object custody requires one closed, relative key prefix.');
  }
  if (options.kmsKeyId.trim() === '' || options.kmsKeyId !== options.kmsKeyId.trim()) {
    invalidRequest('S3 object custody requires one explicit KMS key identifier.');
  }
}

function validateObjectKey(objectKey: string): string {
  if (
    objectKey === '' ||
    objectKey !== objectKey.trim() ||
    objectKey.startsWith('/') ||
    objectKey.endsWith('/') ||
    objectKey.includes('..') ||
    objectKey.includes('\\') ||
    hasControlCharacters(objectKey)
  ) {
    invalidRequest('Object custody requires one closed, relative object key.');
  }
  return objectKey;
}

function buildStorageKey(prefix: string, objectKey: string): string {
  const key = `${prefix}/${validateObjectKey(objectKey)}`;
  if (Buffer.byteLength(key, 'utf8') > MAXIMUM_S3_KEY_BYTES) {
    invalidRequest('Object custody key exceeds the S3 byte limit.');
  }
  return key;
}

function validateSha256Hex(value: string): string {
  if (!SHA256_HEX_PATTERN.test(value)) {
    invalidRequest('Object custody requires one lowercase SHA-256 digest.');
  }
  return value;
}

function validateMetadata(metadata: Readonly<Record<string, string>>): Record<string, string> {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    invalidRequest('Object custody metadata must be one string record.');
  }
  const entries = Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0 || entries.length > 64) {
    invalidRequest('Object custody metadata must contain between one and 64 entries.');
  }
  const validated: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!METADATA_KEY_PATTERN.test(key)) {
      invalidRequest('Object custody metadata keys must use the closed lowercase key format.');
    }
    if (
      typeof value !== 'string' ||
      value === '' ||
      value !== value.trim() ||
      value.length > 2048 ||
      hasControlCharacters(value)
    ) {
      invalidRequest('Object custody metadata values must be bounded printable strings.');
    }
    validated[key] = value;
  }
  return validated;
}

function metadataFromResponse(metadata: Readonly<Record<string, string>> | undefined) {
  try {
    return validateMetadata(metadata ?? {});
  } catch (error) {
    if (error instanceof AflTradeConditionalObjectStoreError && error.code === 'INVALID_REQUEST') {
      throw new AflTradeConditionalObjectStoreError(
        'INTEGRITY_MISMATCH',
        'S3 object custody returned invalid immutable metadata.'
      );
    }
    throw error;
  }
}

function metadataExactlyMatches(
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
        key === expectedEntries[index]?.[0] && value === expectedEntries[index]?.[1]
    )
  );
}

function sha256HexToBase64(value: string): string {
  return Buffer.from(validateSha256Hex(value), 'hex').toString('base64');
}

function sha256Base64ToHex(value: string | undefined): string {
  if (value === undefined || !SHA256_BASE64_PATTERN.test(value)) {
    throw new AflTradeConditionalObjectStoreError(
      'INTEGRITY_MISMATCH',
      'S3 object custody did not return one full SHA-256 checksum.'
    );
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.byteLength !== 32 || bytes.toString('base64') !== value) {
    throw new AflTradeConditionalObjectStoreError(
      'INTEGRITY_MISMATCH',
      'S3 object custody returned an invalid SHA-256 checksum.'
    );
  }
  return bytes.toString('hex');
}

function requirePositiveInteger(value: number, subject: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    invalidRequest(`${subject} must be a positive safe integer.`);
  }
  return value;
}

function requireNonnegativeInteger(value: number, subject: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    invalidRequest(`${subject} must be a nonnegative safe integer.`);
  }
  return value;
}

function requireOpaqueValue(value: string, subject: string): string {
  if (value.trim() === '' || value !== value.trim() || hasControlCharacters(value)) {
    invalidRequest(`${subject} must be one non-empty opaque value.`);
  }
  return value;
}

function opaqueValueFromResponse(value: string, subject: string): string {
  try {
    return requireOpaqueValue(value, subject);
  } catch (error) {
    if (error instanceof AflTradeConditionalObjectStoreError && error.code === 'INVALID_REQUEST') {
      throw new AflTradeConditionalObjectStoreError(
        'INTEGRITY_MISMATCH',
        'S3 object custody returned invalid immutable identity metadata.'
      );
    }
    throw error;
  }
}

function nonnegativeIntegerFromResponse(value: number, subject: string): number {
  try {
    return requireNonnegativeInteger(value, subject);
  } catch (error) {
    if (error instanceof AflTradeConditionalObjectStoreError && error.code === 'INVALID_REQUEST') {
      throw new AflTradeConditionalObjectStoreError(
        'INTEGRITY_MISMATCH',
        'S3 object custody returned invalid immutable size metadata.'
      );
    }
    throw error;
  }
}

function statusCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as AwsTransportError;
  return typeof candidate.$metadata?.httpStatusCode === 'number'
    ? candidate.$metadata.httpStatusCode
    : null;
}

function errorName(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const name = (error as AwsTransportError).name;
  return typeof name === 'string' ? name : null;
}

function isNotFound(error: unknown): boolean {
  return statusCode(error) === 404 || ['NoSuchKey', 'NotFound'].includes(errorName(error) ?? '');
}

function mapTransportError(
  operation: 'create' | 'head' | 'read',
  error: unknown
): AflTradeConditionalObjectStoreError {
  if (error instanceof AflTradeConditionalObjectStoreError) return error;
  const status = statusCode(error);
  const name = errorName(error);
  if (operation === 'create' && (status === 412 || name === 'PreconditionFailed')) {
    return new AflTradeConditionalObjectStoreError(
      'ALREADY_EXISTS',
      'The immutable object key already exists.'
    );
  }
  if (status === 409 || name === 'ConditionalRequestConflict') {
    return new AflTradeConditionalObjectStoreError(
      'PRECONDITION_FAILED',
      'The conditional object operation conflicted with another writer.'
    );
  }
  if (status === 412 || name === 'PreconditionFailed') {
    return new AflTradeConditionalObjectStoreError(
      'PRECONDITION_FAILED',
      'The exact object version precondition did not match.'
    );
  }
  if (isNotFound(error)) {
    return new AflTradeConditionalObjectStoreError('NOT_FOUND', 'The exact object was not found.');
  }
  return new AflTradeConditionalObjectStoreError(
    'TRANSPORT_FAILURE',
    `The S3 conditional ${operation} operation failed.`
  );
}

function identityFromResponse(input: {
  objectKey: string;
  output: HeadObjectCommandOutput | GetObjectCommandOutput;
  kmsKeyId: string;
}): AflTradeConditionalObjectIdentity {
  const { output } = input;
  if (
    output.VersionId === undefined ||
    output.ETag === undefined ||
    output.ContentLength === undefined ||
    output.ContentType === undefined ||
    output.ServerSideEncryption !== 'aws:kms' ||
    output.SSEKMSKeyId !== input.kmsKeyId
  ) {
    throw new AflTradeConditionalObjectStoreError(
      'INTEGRITY_MISMATCH',
      'S3 object metadata does not satisfy immutable versioning and encryption requirements.'
    );
  }
  const metadata = metadataFromResponse(output.Metadata);
  const hasRetention =
    output.ObjectLockMode !== undefined ||
    output.ObjectLockRetainUntilDate !== undefined ||
    output.ObjectLockLegalHoldStatus !== undefined;
  if ((output.ObjectLockMode === undefined) !== (output.ObjectLockRetainUntilDate === undefined)) {
    throw new AflTradeConditionalObjectStoreError(
      'INTEGRITY_MISMATCH',
      'S3 returned an incomplete write-once retention observation.'
    );
  }
  if (
    (output.ObjectLockMode !== undefined &&
      output.ObjectLockMode !== 'GOVERNANCE' &&
      output.ObjectLockMode !== 'COMPLIANCE') ||
    (output.ObjectLockLegalHoldStatus !== undefined &&
      output.ObjectLockLegalHoldStatus !== 'ON' &&
      output.ObjectLockLegalHoldStatus !== 'OFF') ||
    (output.ObjectLockRetainUntilDate !== undefined &&
      (!(output.ObjectLockRetainUntilDate instanceof Date) ||
        !Number.isFinite(output.ObjectLockRetainUntilDate.getTime())))
  ) {
    throw new AflTradeConditionalObjectStoreError(
      'INTEGRITY_MISMATCH',
      'S3 returned an invalid write-once retention observation.'
    );
  }
  const writeOnceRetention = hasRetention
    ? {
        mode:
          output.ObjectLockMode === undefined
            ? null
            : output.ObjectLockMode === 'GOVERNANCE'
              ? ('governance' as const)
              : ('compliance' as const),
        retainUntil: output.ObjectLockRetainUntilDate?.toISOString() ?? null,
        legalHold:
          output.ObjectLockLegalHoldStatus === undefined
            ? null
            : output.ObjectLockLegalHoldStatus === 'ON'
              ? ('on' as const)
              : ('off' as const),
      }
    : null;
  return {
    objectKey: input.objectKey,
    versionId: opaqueValueFromResponse(output.VersionId, 'S3 version identifier'),
    eTag: opaqueValueFromResponse(output.ETag, 'S3 entity tag'),
    byteLength: nonnegativeIntegerFromResponse(output.ContentLength, 'S3 object length'),
    mediaType: opaqueValueFromResponse(output.ContentType, 'S3 content type'),
    checksumSha256: sha256Base64ToHex(output.ChecksumSHA256),
    metadata,
    encryption: {
      mode: 'provider_kms',
      keyReferenceSha256: createHash('sha256').update(input.kmsKeyId).digest('hex'),
    },
    writeOnceRetention,
  };
}

function identitiesMatch(
  actual: AflTradeConditionalObjectIdentity,
  expected: Pick<
    AflTradeConditionalObjectIdentity,
    'objectKey' | 'versionId' | 'eTag' | 'byteLength' | 'mediaType' | 'checksumSha256' | 'metadata'
  >
): boolean {
  return (
    actual.objectKey === expected.objectKey &&
    actual.versionId === expected.versionId &&
    actual.eTag === expected.eTag &&
    actual.byteLength === expected.byteLength &&
    actual.mediaType === expected.mediaType &&
    actual.checksumSha256 === expected.checksumSha256 &&
    metadataExactlyMatches(actual.metadata, expected.metadata)
  );
}

function bytesFromChunk(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk);
  throw new AflTradeConditionalObjectStoreError(
    'INTEGRITY_MISMATCH',
    'S3 returned an unsupported object-body chunk.'
  );
}

async function cancelBody(body: unknown) {
  if (typeof body !== 'object' || body === null) return;
  const destroy = (body as { destroy?: unknown }).destroy;
  if (typeof destroy === 'function') {
    try {
      (destroy as () => void).call(body);
    } catch {
      // Best effort only; the transport request is already being aborted.
    }
    return;
  }
  const cancel = (body as { cancel?: unknown }).cancel;
  if (typeof cancel === 'function') {
    try {
      await (cancel as () => unknown).call(body);
    } catch {
      // Best effort only; the transport request is already being aborted.
    }
  }
}

async function collectBoundedBody(
  body: unknown,
  maximumBytes: number,
  abortController: AbortController
): Promise<Uint8Array> {
  if (body instanceof Uint8Array) {
    if (body.byteLength > maximumBytes) {
      abortController.abort();
      throw new AflTradeConditionalObjectStoreError(
        'OBJECT_TOO_LARGE',
        'S3 object body exceeded the configured byte bound.'
      );
    }
    return Uint8Array.from(body);
  }
  const iteratorFactory =
    typeof body === 'object' && body !== null
      ? (body as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator]
      : undefined;
  if (typeof iteratorFactory !== 'function') {
    throw new AflTradeConditionalObjectStoreError(
      'INTEGRITY_MISMATCH',
      'S3 object custody did not return a bounded-readable body.'
    );
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for await (const value of body as AsyncIterable<unknown>) {
      const chunk = bytesFromChunk(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > maximumBytes) {
        abortController.abort();
        await cancelBody(body);
        throw new AflTradeConditionalObjectStoreError(
          'OBJECT_TOO_LARGE',
          'S3 object body exceeded the configured byte bound.'
        );
      }
      chunks.push(Uint8Array.from(chunk));
    }
  } catch (error) {
    if (error instanceof AflTradeConditionalObjectStoreError) throw error;
    throw new AflTradeConditionalObjectStoreError(
      'TRANSPORT_FAILURE',
      'The S3 conditional read stream failed.'
    );
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createAflTradeS3ConditionalObjectStore(
  options: AflTradeS3ConditionalObjectStoreOptions
): AflTradeConditionalObjectStore {
  validateConfiguration(options);

  async function headExact(
    request: AflTradeConditionalObjectHeadRequest
  ): Promise<AflTradeConditionalObjectIdentity | null> {
    const objectKey = validateObjectKey(request.objectKey);
    const storageKey = buildStorageKey(options.keyPrefix, objectKey);
    if (request.versionId !== undefined) {
      requireOpaqueValue(request.versionId, 'S3 version identifier');
    }
    try {
      const output = await options.client.send(
        new HeadObjectCommand({
          Bucket: options.bucket,
          Key: storageKey,
          VersionId: request.versionId,
          ChecksumMode: 'ENABLED',
        })
      );
      const identity = identityFromResponse({ objectKey, output, kmsKeyId: options.kmsKeyId });
      if (request.versionId !== undefined && identity.versionId !== request.versionId) {
        throw new AflTradeConditionalObjectStoreError(
          'INTEGRITY_MISMATCH',
          'S3 head returned a different immutable object version than requested.'
        );
      }
      return identity;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw mapTransportError('head', error);
    }
  }

  return {
    async createIfAbsent(request: AflTradeConditionalObjectCreateRequest) {
      const objectKey = validateObjectKey(request.objectKey);
      const storageKey = buildStorageKey(options.keyPrefix, objectKey);
      if (!(request.bytes instanceof Uint8Array)) {
        invalidRequest('Conditional object creation requires Uint8Array bytes.');
      }
      const mediaType = requireOpaqueValue(request.mediaType, 'Object media type');
      const checksumSha256 = validateSha256Hex(request.checksumSha256);
      const metadata = validateMetadata(request.metadata);
      const actualChecksum = createHash('sha256').update(request.bytes).digest('hex');
      if (actualChecksum !== checksumSha256) {
        throw new AflTradeConditionalObjectStoreError(
          'INTEGRITY_MISMATCH',
          'Conditional object bytes do not match their declared SHA-256 checksum.'
        );
      }
      let output: PutObjectCommandOutput;
      try {
        output = await options.client.send(
          new PutObjectCommand({
            Bucket: options.bucket,
            Key: storageKey,
            Body: request.bytes,
            ContentLength: request.bytes.byteLength,
            ContentType: mediaType,
            ChecksumAlgorithm: 'SHA256',
            ChecksumSHA256: sha256HexToBase64(checksumSha256),
            IfNoneMatch: '*',
            ServerSideEncryption: 'aws:kms',
            SSEKMSKeyId: options.kmsKeyId,
            Metadata: metadata,
          })
        );
      } catch (error) {
        throw mapTransportError('create', error);
      }
      if (
        output.VersionId === undefined ||
        output.ETag === undefined ||
        output.ChecksumSHA256 === undefined ||
        output.ServerSideEncryption !== 'aws:kms' ||
        output.SSEKMSKeyId !== options.kmsKeyId ||
        sha256Base64ToHex(output.ChecksumSHA256) !== checksumSha256
      ) {
        throw new AflTradeConditionalObjectStoreError(
          'INTEGRITY_MISMATCH',
          'S3 conditional creation did not attest to the requested immutable object.'
        );
      }
      const versionId = opaqueValueFromResponse(output.VersionId, 'S3 version identifier');
      const eTag = opaqueValueFromResponse(output.ETag, 'S3 entity tag');
      const identity = await headExact({ objectKey, versionId });
      if (
        identity === null ||
        !identitiesMatch(identity, {
          objectKey,
          versionId,
          eTag,
          byteLength: request.bytes.byteLength,
          mediaType,
          checksumSha256,
          metadata,
        })
      ) {
        throw new AflTradeConditionalObjectStoreError(
          'INTEGRITY_MISMATCH',
          'S3 conditional creation read-back metadata did not match the created object.'
        );
      }
      return identity;
    },

    headExact,

    async readExactBounded(request: AflTradeConditionalObjectReadRequest) {
      const objectKey = validateObjectKey(request.objectKey);
      const storageKey = buildStorageKey(options.keyPrefix, objectKey);
      const versionId = requireOpaqueValue(request.versionId, 'S3 version identifier');
      const eTag = requireOpaqueValue(request.eTag, 'S3 entity tag');
      const expectedByteLength = requireNonnegativeInteger(
        request.expectedByteLength,
        'Expected object length'
      );
      const maximumBytes = requirePositiveInteger(request.maximumBytes, 'Maximum object bytes');
      if (expectedByteLength > maximumBytes) {
        throw new AflTradeConditionalObjectStoreError(
          'OBJECT_TOO_LARGE',
          'Expected object length exceeds the configured byte bound.'
        );
      }
      const expectedMediaType = requireOpaqueValue(
        request.expectedMediaType,
        'Expected object media type'
      );
      const expectedChecksumSha256 = validateSha256Hex(request.expectedChecksumSha256);
      const expectedMetadata = validateMetadata(request.expectedMetadata);
      const abortController = new AbortController();
      let output: GetObjectCommandOutput;
      try {
        output = await options.client.send(
          new GetObjectCommand({
            Bucket: options.bucket,
            Key: storageKey,
            VersionId: versionId,
            IfMatch: eTag,
            ChecksumMode: 'ENABLED',
          }),
          { abortSignal: abortController.signal }
        );
      } catch (error) {
        throw mapTransportError('read', error);
      }
      const identity = identityFromResponse({ objectKey, output, kmsKeyId: options.kmsKeyId });
      if (
        !identitiesMatch(identity, {
          objectKey,
          versionId,
          eTag,
          byteLength: expectedByteLength,
          mediaType: expectedMediaType,
          checksumSha256: expectedChecksumSha256,
          metadata: expectedMetadata,
        })
      ) {
        abortController.abort();
        await cancelBody(output.Body);
        throw new AflTradeConditionalObjectStoreError(
          'INTEGRITY_MISMATCH',
          'S3 conditional read metadata did not match the exact requested object.'
        );
      }
      const bytes = await collectBoundedBody(output.Body, maximumBytes, abortController);
      if (
        bytes.byteLength !== expectedByteLength ||
        createHash('sha256').update(bytes).digest('hex') !== expectedChecksumSha256
      ) {
        throw new AflTradeConditionalObjectStoreError(
          'INTEGRITY_MISMATCH',
          'S3 conditional read bytes did not match the exact requested object.'
        );
      }
      return { identity, bytes };
    },
  };
}
