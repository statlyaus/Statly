import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createLocalAflTradeCanonicalArtifactRepository } from '@/server/aflTradeIntelligence/development/localCanonicalArtifactRepository';
import { createLocalAflTradeNonProductionArtifactRepository } from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { verifyAflTradeArtifactReadback } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';

it.each(['raw_source', 'capture_metadata'] as const)(
  'preserves canonical creation time for repeated %s bytes in a new private store',
  async (artifactClass) => {
    const root = await mkdtemp(join(tmpdir(), 'statly-canonical-custody-'));
    try {
      const original = createLocalAflTradeNonProductionArtifactRepository({
        rootDirectory: root,
        repositoryId: 'original',
        artifactClass,
        maximumObjectBytes: 1024,
      });
      const fresh = createLocalAflTradeNonProductionArtifactRepository({
        rootDirectory: root,
        repositoryId: 'fresh',
        artifactClass,
        maximumObjectBytes: 1024,
      });
      const bytes = new TextEncoder().encode(
        'genuine retained bytes represented by a synthetic test'
      );
      const reference = createAflTradeByteArtifactRef(
        bytes,
        'application/octet-stream',
        '2026-08-01T00:00:00.000Z'
      );
      await original.putIfAbsent(reference, bytes);
      const readback = await verifyAflTradeArtifactReadback(
        original,
        reference,
        '2026-08-01T00:00:01.000Z',
        1024
      );
      const repository = createLocalAflTradeCanonicalArtifactRepository({
        repository: fresh,
        async lookup() {
          return {
            artifact: reference,
            artifactClass,
            environment: 'non_production',
            custodyProfileId: null,
            readback,
          };
        },
      });
      const later = createAflTradeByteArtifactRef(
        bytes,
        reference.mediaType,
        '2026-09-01T00:00:00.000Z'
      );
      expect((await repository.putIfAbsent(later, bytes)).reference).toEqual(reference);
      expect(Array.from((await repository.loadExact(reference, 1024))!.bytes)).toEqual(
        Array.from(bytes)
      );
      const reopened = createLocalAflTradeNonProductionArtifactRepository({
        rootDirectory: root,
        repositoryId: 'fresh',
        artifactClass,
        maximumObjectBytes: 1024,
      });
      expect((await reopened.loadExact(reference, 1024))?.reference).toEqual(reference);
      const newBytes = new TextEncoder().encode('different bytes');
      await expect(repository.putIfAbsent(later, newBytes)).rejects.toThrow();
      const wrongClass = createLocalAflTradeCanonicalArtifactRepository({
        repository: fresh,
        async lookup() {
          return {
            artifact: reference,
            artifactClass: 'derived_private',
            environment: 'non_production',
            custodyProfileId: null,
            readback,
          };
        },
      });
      await expect(wrongClass.putIfAbsent(later, bytes)).rejects.toThrow();
      const wrongReference = createLocalAflTradeCanonicalArtifactRepository({
        repository: fresh,
        async lookup() {
          return {
            artifact: later,
            artifactClass,
            environment: 'non_production',
            custodyProfileId: null,
            readback,
          };
        },
      });
      await expect(wrongReference.putIfAbsent(later, bytes)).rejects.toThrow();
      for (const change of [
        { environment: 'production' },
        { custodyProfileId: `artifact-custody-profile:${'a'.repeat(64)}` },
        { readback: { ...readback, receiptId: `artifact-readback:${'b'.repeat(64)}` } },
      ]) {
        const invalid = createLocalAflTradeCanonicalArtifactRepository({
          repository: fresh,
          async lookup() {
            return {
              artifact: reference,
              artifactClass,
              environment: 'non_production',
              custodyProfileId: null,
              readback,
              ...change,
            };
          },
        });
        await expect(invalid.putIfAbsent(later, bytes)).rejects.toThrow();
      }
      const absent = createLocalAflTradeCanonicalArtifactRepository({
        repository: fresh,
        async lookup() {
          return null;
        },
      });
      const newReference = createAflTradeByteArtifactRef(
        newBytes,
        'application/octet-stream',
        '2026-09-01T00:00:00.000Z'
      );
      expect((await absent.putIfAbsent(newReference, newBytes)).reference).toEqual(newReference);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);
