import { createHash } from 'node:crypto';

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

import { AflTradeConditionalObjectStoreError } from '@/server/aflTradeIntelligence/artifacts/conditionalObjectStore';
import { createAflTradeS3ConditionalObjectStore } from '@/server/aflTradeIntelligence/artifacts/s3ConditionalObjectStore';

const bucket = 'statly-afl-evidence-test';
const keyPrefix = 'afl-trade-intelligence/v1';
const kmsKeyId = 'arn:aws:kms:ap-southeast-2:123456789012:key/test-key';
const objectKey = 'sha256/fixture-object';
const mediaType = 'application/octet-stream';
const bytes = Uint8Array.from([1, 2, 3, 4]);
const checksumSha256 = createHash('sha256').update(bytes).digest('hex');
const checksumBase64 = Buffer.from(checksumSha256, 'hex').toString('base64');
const metadata = {
  'artifact-created-at': '2026-08-07T10:00:00.000Z',
  'artifact-profile': 'afl-trade-source/v1',
};

function s3Error(name: string, httpStatusCode: number, message = 'sensitive provider detail') {
  return Object.assign(new Error(message), { name, $metadata: { httpStatusCode } });
}

function createStore(send: ReturnType<typeof vi.fn>) {
  return createAflTradeS3ConditionalObjectStore({
    client: { send } as unknown as S3Client,
    bucket,
    keyPrefix,
    kmsKeyId,
  });
}

function exactOutput(body?: unknown) {
  return {
    VersionId: 'version-1',
    ETag: '"etag-1"',
    ContentLength: bytes.byteLength,
    ContentType: mediaType,
    ChecksumSHA256: checksumBase64,
    ServerSideEncryption: 'aws:kms',
    SSEKMSKeyId: kmsKeyId,
    Metadata: metadata,
    ObjectLockMode: 'COMPLIANCE',
    ObjectLockRetainUntilDate: new Date('2033-08-07T10:00:00.000Z'),
    ObjectLockLegalHoldStatus: 'OFF',
    Body: body,
  };
}

describe('S3 conditional immutable-object transport', () => {
  it('creates once with checksum and SSE, then verifies the exact version by HEAD', async () => {
    const commands: unknown[] = [];
    const send = vi.fn(async (command: unknown) => {
      commands.push(command);
      if (command instanceof PutObjectCommand) {
        return {
          VersionId: 'version-1',
          ETag: '"etag-1"',
          ChecksumSHA256: checksumBase64,
          ServerSideEncryption: 'aws:kms',
          SSEKMSKeyId: kmsKeyId,
        };
      }
      if (command instanceof HeadObjectCommand) return exactOutput();
      throw new Error('Unexpected command.');
    });
    const identity = await createStore(send).createIfAbsent({
      objectKey,
      bytes,
      mediaType,
      checksumSha256,
      metadata,
    });

    expect(commands).toHaveLength(2);
    expect((commands[0] as PutObjectCommand).input).toEqual({
      Bucket: bucket,
      Key: `${keyPrefix}/${objectKey}`,
      Body: bytes,
      ContentLength: bytes.byteLength,
      ContentType: mediaType,
      ChecksumAlgorithm: 'SHA256',
      ChecksumSHA256: checksumBase64,
      IfNoneMatch: '*',
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: kmsKeyId,
      Metadata: metadata,
    });
    expect((commands[1] as HeadObjectCommand).input).toEqual({
      Bucket: bucket,
      Key: `${keyPrefix}/${objectKey}`,
      VersionId: 'version-1',
      ChecksumMode: 'ENABLED',
    });
    expect(identity).toEqual({
      objectKey,
      versionId: 'version-1',
      eTag: '"etag-1"',
      byteLength: bytes.byteLength,
      mediaType,
      checksumSha256,
      metadata,
      encryption: {
        mode: 'provider_kms',
        keyReferenceSha256: createHash('sha256').update(kmsKeyId).digest('hex'),
      },
      writeOnceRetention: {
        mode: 'compliance',
        retainUntil: '2033-08-07T10:00:00.000Z',
        legalHold: 'off',
      },
    });
    expect(JSON.stringify(identity)).not.toContain(kmsKeyId);
  });

  it('maps conditional-create conflicts to stable errors without provider detail', async () => {
    const send = vi.fn(async () => {
      throw s3Error('PreconditionFailed', 412, 'secret request id and bucket detail');
    });
    const promise = createStore(send).createIfAbsent({
      objectKey,
      bytes,
      mediaType,
      checksumSha256,
      metadata,
    });
    await expect(promise).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
      message: 'The immutable object key already exists.',
    });
    await expect(promise).rejects.not.toHaveProperty(
      'message',
      expect.stringContaining('secret request id')
    );
  });

  it('returns null only for an exact HEAD miss and sanitizes other failures', async () => {
    const missing = createStore(
      vi.fn(async () => {
        throw s3Error('NoSuchKey', 404);
      })
    );
    await expect(missing.headExact({ objectKey })).resolves.toBeNull();

    const unavailable = createStore(
      vi.fn(async () => {
        throw s3Error('AccessDenied', 403, 'credential and endpoint detail');
      })
    );
    await expect(unavailable.headExact({ objectKey })).rejects.toMatchObject({
      code: 'TRANSPORT_FAILURE',
      message: 'The S3 conditional head operation failed.',
    });
  });

  it('rejects a HEAD response that does not attest to the requested exact version', async () => {
    const send = vi.fn(async () => ({ ...exactOutput(), VersionId: 'version-2' }));

    await expect(
      createStore(send).headExact({ objectKey, versionId: 'version-1' })
    ).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' });
  });

  it('reports a legal-hold-only WORM observation without inventing retention fields', async () => {
    const output = {
      ...exactOutput(),
      ObjectLockMode: undefined,
      ObjectLockRetainUntilDate: undefined,
      ObjectLockLegalHoldStatus: 'ON',
    };
    const send = vi.fn(async () => output);

    await expect(createStore(send).headExact({ objectKey })).resolves.toMatchObject({
      writeOnceRetention: {
        mode: null,
        retainUntil: null,
        legalHold: 'on',
      },
    });
  });

  it('reads one exact version with If-Match and verifies streamed bytes', async () => {
    const commandInputs: unknown[] = [];
    const body = (async function* () {
      yield bytes.subarray(0, 2);
      yield bytes.subarray(2);
    })();
    const send = vi.fn(async (command: unknown, options?: unknown) => {
      commandInputs.push({ command, options });
      return exactOutput(body);
    });
    const result = await createStore(send).readExactBounded({
      objectKey,
      versionId: 'version-1',
      eTag: '"etag-1"',
      expectedByteLength: bytes.byteLength,
      expectedMediaType: mediaType,
      expectedChecksumSha256: checksumSha256,
      expectedMetadata: metadata,
      maximumBytes: 32,
    });

    const sent = commandInputs[0] as {
      command: GetObjectCommand;
      options: { abortSignal: AbortSignal };
    };
    expect(sent.command).toBeInstanceOf(GetObjectCommand);
    expect(sent.command.input).toEqual({
      Bucket: bucket,
      Key: `${keyPrefix}/${objectKey}`,
      VersionId: 'version-1',
      IfMatch: '"etag-1"',
      ChecksumMode: 'ENABLED',
    });
    expect(sent.options.abortSignal.aborted).toBe(false);
    expect(result.bytes).toEqual(bytes);
    expect(result.identity.versionId).toBe('version-1');
  });

  it('aborts and destroys a stream that exceeds the configured byte bound', async () => {
    const destroy = vi.fn();
    let abortSignal: AbortSignal | undefined;
    const body = {
      destroy,
      async *[Symbol.asyncIterator]() {
        yield Uint8Array.from([1, 2, 3]);
        yield Uint8Array.from([4, 5]);
      },
    };
    const send = vi.fn(async (_command: unknown, options?: { abortSignal?: AbortSignal }) => {
      abortSignal = options?.abortSignal;
      return exactOutput(body);
    });
    await expect(
      createStore(send).readExactBounded({
        objectKey,
        versionId: 'version-1',
        eTag: '"etag-1"',
        expectedByteLength: bytes.byteLength,
        expectedMediaType: mediaType,
        expectedChecksumSha256: checksumSha256,
        expectedMetadata: metadata,
        maximumBytes: bytes.byteLength,
      })
    ).rejects.toMatchObject({ code: 'OBJECT_TOO_LARGE' });
    expect(abortSignal?.aborted).toBe(true);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('rejects metadata drift before consuming the object body', async () => {
    const next = vi.fn();
    const destroy = vi.fn();
    const body = {
      destroy,
      [Symbol.asyncIterator]() {
        return { next };
      },
    };
    const send = vi.fn(async () => ({
      ...exactOutput(body),
      Metadata: { ...metadata, 'artifact-profile': 'changed-profile' },
    }));
    await expect(
      createStore(send).readExactBounded({
        objectKey,
        versionId: 'version-1',
        eTag: '"etag-1"',
        expectedByteLength: bytes.byteLength,
        expectedMediaType: mediaType,
        expectedChecksumSha256: checksumSha256,
        expectedMetadata: metadata,
        maximumBytes: 32,
      })
    ).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' });
    expect(next).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('rejects declared checksum drift before issuing a request', async () => {
    const send = vi.fn();
    await expect(
      createStore(send).createIfAbsent({
        objectKey,
        bytes,
        mediaType,
        checksumSha256: 'f'.repeat(64),
        metadata,
      })
    ).rejects.toBeInstanceOf(AflTradeConditionalObjectStoreError);
    expect(send).not.toHaveBeenCalled();
  });
});
