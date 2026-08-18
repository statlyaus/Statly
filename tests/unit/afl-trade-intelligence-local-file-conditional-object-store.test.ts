import { createHash } from 'node:crypto';
import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AflTradeConditionalObjectStoreError,
  type AflTradeConditionalObjectCreateRequest,
} from '@/server/aflTradeIntelligence/artifacts/conditionalObjectStore';
import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { verifyAflTradeArtifactReadback } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import {
  createLocalAflTradeFileConditionalObjectStore,
  createLocalAflTradeNonProductionArtifactRepository,
  createLocalAflTradePrivateDerivedArtifactRepository,
} from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'statly-local-artifacts-'));
  roots.push(root);
  return root;
}

function request(): AflTradeConditionalObjectCreateRequest {
  const bytes = new TextEncoder().encode('{"fixture":"local-public-projection"}');
  return {
    objectKey: `artifact-custody-profile:${'a'.repeat(64)}/sha256/bb/cc/${'b'.repeat(64)}`,
    bytes,
    mediaType: 'application/json',
    checksumSha256: '9f4803001568a801e7576725213fa661e357a57f973e9def881e33b07f19421b',
    metadata: {
      'statly-artifact-id': `artifact:${'b'.repeat(64)}`,
      'statly-environment': 'test_fixture',
    },
  };
}

function encodedEnvelopePath(root: string, objectKey: string): string {
  const encodedKey = createHash('sha256').update(objectKey, 'utf8').digest('hex');
  return join(root, `${encodedKey}.json`);
}

function pendingEnvelopePath(root: string, objectKey: string, nonce = 'fixture'): string {
  const encodedKey = createHash('sha256').update(objectKey, 'utf8').digest('hex');
  return join(root, `.pending-${encodedKey}-${nonce}.json`);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('local AFL trade conditional object store', () => {
  it('persists one immutable object for exact bounded reads across store instances', async () => {
    const root = await temporaryRoot();
    const input = request();
    const writer = createLocalAflTradeFileConditionalObjectStore({ rootDirectory: root });

    const created = await writer.createIfAbsent(input);
    const reader = createLocalAflTradeFileConditionalObjectStore({ rootDirectory: root });
    const headed = await reader.headExact({ objectKey: input.objectKey });
    const loaded = await reader.readExactBounded({
      objectKey: input.objectKey,
      versionId: created.versionId,
      eTag: created.eTag,
      expectedByteLength: input.bytes.byteLength,
      expectedMediaType: input.mediaType,
      expectedChecksumSha256: input.checksumSha256,
      expectedMetadata: input.metadata,
      maximumBytes: input.bytes.byteLength,
    });

    expect(headed).toEqual(created);
    expect(loaded.identity).toEqual(created);
    expect([...loaded.bytes]).toEqual([...input.bytes]);
    expect(created).toMatchObject({
      objectKey: input.objectKey,
      checksumSha256: input.checksumSha256,
      encryption: { mode: 'local_filesystem_unencrypted', keyReferenceSha256: null },
      writeOnceRetention: null,
    });
  });

  it('keeps network-captured raw evidence in an explicit local non-production custody class', async () => {
    const root = await temporaryRoot();
    const repository = createLocalAflTradeNonProductionArtifactRepository({
      rootDirectory: root,
      repositoryId: 'local-raw-source',
      artifactClass: 'raw_source',
      maximumObjectBytes: 1_024,
    });
    const bytes = new TextEncoder().encode('local non-production provider bytes');
    const reference = createAflTradeByteArtifactRef(
      bytes,
      'application/octet-stream',
      '2026-08-14T08:00:00.000Z'
    );

    await expect(repository.putIfAbsent(reference, bytes)).resolves.toMatchObject({
      status: 'stored',
    });
    await expect(
      verifyAflTradeArtifactReadback(repository, reference, '2026-08-14T08:00:01.000Z', 1_024)
    ).resolves.toMatchObject({
      content: {
        repositoryAssurance: 'local_non_production_filesystem',
        artifactClass: 'raw_source',
        custodyProfileId: null,
        custodyProfile: null,
        custodyEnvironment: 'non_production',
        verification: 'exact_reference_and_sha256_bytes',
      },
    });
  });

  it('keeps private calculation-review documents in local non-production derived custody', async () => {
    const root = await temporaryRoot();
    const repository = createLocalAflTradePrivateDerivedArtifactRepository({
      rootDirectory: root,
      repositoryId: 'local-private-hpn-review',
      maximumObjectBytes: 1_024,
    });
    const bytes = new TextEncoder().encode('{"kind":"private-hpn-review"}');
    const reference = createAflTradeByteArtifactRef(
      bytes,
      'application/json',
      '2026-08-16T05:00:00.000Z'
    );

    await repository.putIfAbsent(reference, bytes);
    await expect(
      verifyAflTradeArtifactReadback(repository, reference, '2026-08-16T05:00:01.000Z', 1_024)
    ).resolves.toMatchObject({
      content: {
        repositoryAssurance: 'local_non_production_filesystem',
        artifactClass: 'derived_private',
        custodyEnvironment: 'non_production',
      },
    });
  });

  it('fails closed for replacement writes, traversal, and reads above the caller bound', async () => {
    const root = await temporaryRoot();
    const store = createLocalAflTradeFileConditionalObjectStore({ rootDirectory: root });
    const input = request();
    const created = await store.createIfAbsent(input);

    await expect(store.createIfAbsent(input)).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
    } satisfies Partial<AflTradeConditionalObjectStoreError>);
    await expect(store.headExact({ objectKey: '../outside' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    } satisfies Partial<AflTradeConditionalObjectStoreError>);
    await expect(
      store.readExactBounded({
        objectKey: input.objectKey,
        versionId: created.versionId,
        eTag: created.eTag,
        expectedByteLength: input.bytes.byteLength,
        expectedMediaType: input.mediaType,
        expectedChecksumSha256: input.checksumSha256,
        expectedMetadata: input.metadata,
        maximumBytes: input.bytes.byteLength - 1,
      })
    ).rejects.toMatchObject({
      code: 'OBJECT_TOO_LARGE',
    } satisfies Partial<AflTradeConditionalObjectStoreError>);
  });

  it('returns ALREADY_EXISTS only when the existing envelope passes exact validation', async () => {
    const root = await temporaryRoot();
    const input = request();
    await writeFile(encodedEnvelopePath(root, input.objectKey), '{"partial":', { mode: 0o600 });
    const store = createLocalAflTradeFileConditionalObjectStore({ rootDirectory: root });

    await expect(store.createIfAbsent(input)).rejects.toMatchObject({
      code: 'INTEGRITY_MISMATCH',
    } satisfies Partial<AflTradeConditionalObjectStoreError>);
  });

  it('publishes exactly one complete envelope under concurrent writers', async () => {
    const root = await temporaryRoot();
    const input = request();
    const stores = Array.from({ length: 12 }, () =>
      createLocalAflTradeFileConditionalObjectStore({ rootDirectory: root })
    );

    const results = await Promise.allSettled(stores.map((store) => store.createIfAbsent(input)));
    const fulfilled = results.filter(
      (
        result
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<(typeof stores)[number]['createIfAbsent']>>
      > => result.status === 'fulfilled'
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(11);
    expect(rejected.every(({ reason }) => reason?.code === 'ALREADY_EXISTS')).toBe(true);
    await expect(stores[0]!.headExact({ objectKey: input.objectKey })).resolves.toEqual(
      fulfilled[0]!.value
    );
  });

  it('ignores an unpublished staging orphan and permits a later complete publication', async () => {
    const root = await temporaryRoot();
    const input = request();
    await writeFile(pendingEnvelopePath(root, input.objectKey), '{"partial":', { mode: 0o600 });
    const store = createLocalAflTradeFileConditionalObjectStore({ rootDirectory: root });

    await expect(store.headExact({ objectKey: input.objectKey })).resolves.toBeNull();
    const created = await store.createIfAbsent(input);

    await expect(store.headExact({ objectKey: input.objectKey })).resolves.toEqual(created);
  });

  it('repairs an owned post-publication staging link without accepting unexplained hard links', async () => {
    const root = await temporaryRoot();
    const input = request();
    const store = createLocalAflTradeFileConditionalObjectStore({ rootDirectory: root });
    const created = await store.createIfAbsent(input);
    const finalPath = encodedEnvelopePath(root, input.objectKey);
    const pendingPath = pendingEnvelopePath(
      root,
      input.objectKey,
      '00000000-0000-4000-8000-000000000000'
    );
    await link(finalPath, pendingPath);

    await expect(store.headExact({ objectKey: input.objectKey })).resolves.toEqual(created);
    expect((await stat(finalPath)).nlink).toBe(1);
    await expect(stat(pendingPath)).rejects.toMatchObject({ code: 'ENOENT' });

    const invalidPendingPath = pendingEnvelopePath(root, input.objectKey, 'not-a-writer-uuid');
    await link(finalPath, invalidPendingPath);
    await expect(store.headExact({ objectKey: input.objectKey })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    } satisfies Partial<AflTradeConditionalObjectStoreError>);
    await unlink(invalidPendingPath);

    const unexplainedPath = join(root, 'unexplained-hard-link.json');
    await link(finalPath, unexplainedPath);
    await expect(store.headExact({ objectKey: input.objectKey })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    } satisfies Partial<AflTradeConditionalObjectStoreError>);
  });

  it('rejects a symlink at the flat encoded envelope target', async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const input = request();
    const outsideFile = join(outside, 'outside.json');
    await mkdir(outside, { recursive: true });
    await symlink(outsideFile, encodedEnvelopePath(root, input.objectKey));

    const store = createLocalAflTradeFileConditionalObjectStore({ rootDirectory: root });
    await expect(store.createIfAbsent(input)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    } satisfies Partial<AflTradeConditionalObjectStoreError>);
    await expect(store.headExact({ objectKey: input.objectKey })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    } satisfies Partial<AflTradeConditionalObjectStoreError>);
  });

  it('rejects replacement of its anchored root before any artifact bytes escape', async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const displacedRoot = `${root}-displaced`;
    roots.push(displacedRoot);
    const store = createLocalAflTradeFileConditionalObjectStore({ rootDirectory: root });

    await rename(root, displacedRoot);
    await symlink(outside, root);

    await expect(store.createIfAbsent(request())).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    } satisfies Partial<AflTradeConditionalObjectStoreError>);
    expect(await readdir(outside)).toEqual([]);
  });
});
