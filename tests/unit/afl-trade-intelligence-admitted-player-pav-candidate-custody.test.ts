import { describe, expect, it } from 'vitest';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createAflTradeModelRunIntent } from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import {
  retainAflTradeAdmittedPlayerPavCandidate,
  loadAflTradeAdmittedPlayerPavCandidate,
} from '@/server/aflTradeIntelligence/modeling/admittedPlayerContributionCandidate';
import { admittedPavModelRunFixture } from '../testUtils/admittedPavModelRunFixture';

async function parents() {
  const fixture = await admittedPavModelRunFixture();
  const configuration = {
    schemaVersion: 'afl-trade-admitted-player-pav-fit-config/v1',
    candidate: { kind: 'ridge', historySeasons: 1, penalty: 1 },
  };
  const input = {
    intent: createAflTradeModelRunIntent({
      ...fixture.intent.content,
      configurationArtifact: createAflTradeCanonicalJsonArtifactRef(
        configuration,
        fixture.startedAt
      ),
    }),
    protocol: fixture.protocol,
    datasetCandidate: fixture.base.dataset,
    observationSet: fixture.observationSet,
    pavObservationSet: fixture.evidence.pavObservationSet,
    hpnMethod: fixture.evidence.hpnMethod,
    configurationBytes: new TextEncoder().encode(canonicalizeAflTradeJson(configuration)),
  };
  return { fixture, input };
}

describe('native fitted candidate artifact custody', () => {
  it('rejects non-private storage before reading a candidate', async () => {
    const { input } = await parents();
    const storage = createAflTradeFixtureArtifactRepository({ artifactClass: 'public_projection' });
    await expect(
      loadAflTradeAdmittedPlayerPavCandidate({
        fitInput: input,
        artifact: input.intent.content.configurationArtifact,
        maximumArtifactBytes: 1_000_000,
        artifactRepository: {
          ...storage,
          loadExact: async () => {
            throw new Error('Wrong custody must not read.');
          },
        },
      })
    ).rejects.toThrow('derived-private');
  });
  it('rejects storage from another custody environment before writing', async () => {
    const { fixture, input } = await parents();
    const storage = createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' });
    await expect(
      retainAflTradeAdmittedPlayerPavCandidate({
        fitInput: input,
        createdAt: fixture.startedAt,
        maximumArtifactBytes: 1_000_000,
        artifactRepository: {
          ...storage,
          assurance: 'local_non_production_filesystem',
          putIfAbsent: async () => {
            throw new Error('Mismatched environment must not write.');
          },
        },
      })
    ).rejects.toThrow('custody environment');
  });
  it('rejects non-private storage before retaining numerical model evidence', async () => {
    const { fixture, input } = await parents();
    const storage = createAflTradeFixtureArtifactRepository({ artifactClass: 'public_projection' });
    await expect(
      retainAflTradeAdmittedPlayerPavCandidate({
        fitInput: input,
        createdAt: fixture.startedAt,
        maximumArtifactBytes: 1_000_000,
        artifactRepository: {
          ...storage,
          putIfAbsent: async () => {
            throw new Error('Private model evidence must not be written here.');
          },
        },
      })
    ).rejects.toThrow('derived-private');
  });
  it('rejects changed stored bytes during restoration', async () => {
    const { fixture, input } = await parents();
    const storage = createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' });
    const retained = await retainAflTradeAdmittedPlayerPavCandidate({
      fitInput: input,
      artifactRepository: storage,
      createdAt: fixture.startedAt,
      maximumArtifactBytes: 1_000_000,
    });
    await expect(
      loadAflTradeAdmittedPlayerPavCandidate({
        fitInput: input,
        artifact: retained.artifact,
        maximumArtifactBytes: 1_000_000,
        artifactRepository: {
          ...storage,
          loadExact: async () => ({
            reference: retained.artifact,
            bytes: new TextEncoder().encode('{}'),
          }),
        },
      })
    ).rejects.toThrow('exact retained artifact bytes');
  });
  it('refuses to return a fitted artifact when storage cannot read back its bytes', async () => {
    const { fixture, input } = await parents();
    const storage = createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' });
    await expect(
      retainAflTradeAdmittedPlayerPavCandidate({
        fitInput: input,
        artifactRepository: { ...storage, loadExact: async () => null },
        createdAt: fixture.startedAt,
        maximumArtifactBytes: 1_000_000,
      })
    ).rejects.toMatchObject({ code: 'READBACK_MISMATCH' });
  });
  it('restores the retained fit from exact bytes without creating another artifact', async () => {
    const { fixture, input } = await parents();
    const storage = createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' });
    const retained = await retainAflTradeAdmittedPlayerPavCandidate({
      fitInput: input,
      artifactRepository: storage,
      createdAt: fixture.startedAt,
      maximumArtifactBytes: 1_000_000,
    });
    const loaded = await loadAflTradeAdmittedPlayerPavCandidate({
      fitInput: input,
      artifact: retained.artifact,
      artifactRepository: {
        ...storage,
        putIfAbsent: async () => {
          throw new Error('Restore must be read-only.');
        },
      },
      maximumArtifactBytes: 1_000_000,
    });
    expect(loaded.candidate).toEqual(retained.candidate);
    const training = input.observationSet.content.observations.find(
      ({ pavObservation }) => pavObservation.partition === 'train'
    )!.pavObservation;
    expect(loaded.predict(training.observationId).annualPav).toEqual(
      training.targetValues.map(({ totalPav }) => totalPav)
    );
  });
});
