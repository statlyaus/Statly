import { expect, it } from 'vitest';
import {
  createLocalAflTradeFitzRoyFactualRehearsalFixture,
  LOCAL_FITZROY_REHEARSAL_INSTANTS,
  LOCAL_FITZROY_REHEARSAL_RUNTIME,
} from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsalFixture';
import {
  captureAuthorizedAflTradeFitzRoyProviderSeason,
  ingestAuthorizedAflTradeFitzRoyProviderSeason,
} from '@/server/aflTradeIntelligence/source/fitzRoyProviderIngestion';
import { PostgresAflTradeSourceCaptureRepository } from '@/server/aflTradeIntelligence/source/postgresSourceCaptureRepository';
import { PostgresAflTradeProviderObservationRepository } from '@/server/aflTradeIntelligence/source/postgresProviderObservationRepository';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import type { AflTradeArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { aflTradeSourceSnapshotManifestSchema } from '@/server/aflTradeIntelligence/artifacts/sourceSnapshotManifest';
import { aflTradeFitzRoyCaptureReceiptSchema } from '@/server/aflTradeIntelligence/source/fitzRoyCaptureReceipt';

it('captures exact source evidence without a field map or staging dependencies', async () => {
  const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture();
  const result = await captureAuthorizedAflTradeFitzRoyProviderSeason(
    { capture: fixture.command.capture, effectiveAt: fixture.command.effectiveAt },
    {
      capture: fixture.captureDependencies,
      clock: { now: () => LOCAL_FITZROY_REHEARSAL_INSTANTS.captureCompletedAt },
    }
  );
  expect(result.snapshot.content.fitzRoyCaptureReceipt).toEqual(result.receipt);
  const loaded = await fixture.rawArtifactRepository.loadExact(
    result.snapshot.content.sourceArtifact,
    1_024
  );
  expect(loaded).not.toBeNull();
});

it('retains the exact completed capture before database staging fails, without recapturing', async () => {
  const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture();
  const retained: AflTradeArtifactRef[] = [];
  const metadata = {
    ...fixture.metadataArtifactRepository,
    async putIfAbsent(reference: AflTradeArtifactRef, bytes: Uint8Array) {
      const result = await fixture.metadataArtifactRepository.putIfAbsent(reference, bytes);
      retained.push(result.reference);
      return result;
    },
  };
  const unavailable: AflOutcomeSqlClient = {
    async query() {
      throw new Error('Synthetic database unavailable after capture');
    },
    async transaction(work) {
      return work(unavailable);
    },
  };
  await expect(
    ingestAuthorizedAflTradeFitzRoyProviderSeason(fixture.command, {
      capture: { ...fixture.captureDependencies, metadataArtifactRepository: metadata },
      staging: {
        rawArtifactRepository: fixture.rawArtifactRepository,
        sourceCaptureRepository: new PostgresAflTradeSourceCaptureRepository(unavailable),
        providerObservationRepository: new PostgresAflTradeProviderObservationRepository(
          unavailable
        ),
        decoderExecutor: fixture.decoderExecutor,
        clock: { now: () => LOCAL_FITZROY_REHEARSAL_INSTANTS.normalizationStartedAt },
        dependencyLockSha256: LOCAL_FITZROY_REHEARSAL_RUNTIME.dependencyLockSha256,
        imageDigest: LOCAL_FITZROY_REHEARSAL_RUNTIME.imageDigest,
        timeoutMs: 30_000,
        maximumSourceBytes: 1_024,
        maximumRows: 10,
        maximumFields: 20,
        maximumCells: 200,
        maximumCellBytes: 1_024,
        maximumOutputBytes: 65_536,
        egressExecutionVerifier: fixture.captureDependencies.egressExecutionVerifier,
      },
      clock: { now: () => LOCAL_FITZROY_REHEARSAL_INSTANTS.captureCompletedAt },
    })
  ).rejects.toThrow('Synthetic database unavailable after capture');

  const documents = await Promise.all(
    retained.map(async (reference) => {
      const loaded = await fixture.metadataArtifactRepository.loadExact(reference, 65_536);
      expect(loaded).not.toBeNull();
      return JSON.parse(new TextDecoder().decode(loaded!.bytes));
    })
  );
  const envelope = documents.find((value) => value.receipt && value.snapshot);
  expect(envelope).toBeDefined();
  const snapshot = aflTradeSourceSnapshotManifestSchema.parse(envelope.snapshot);
  const receipt = aflTradeFitzRoyCaptureReceiptSchema.parse(envelope.receipt);
  expect(snapshot.content.fitzRoyCaptureReceipt).toEqual(receipt);
  expect(snapshot.content.gate0aReceipt).toEqual(receipt.content.authorizationReceipt);
  expect(receipt.content.capturedAt).toBe(LOCAL_FITZROY_REHEARSAL_INSTANTS.captureCompletedAt);
  expect(snapshot.content.createdAt).toBe(LOCAL_FITZROY_REHEARSAL_INSTANTS.captureCompletedAt);
  expect(receipt.content.egressExecutionReceipt).not.toBeNull();
});
