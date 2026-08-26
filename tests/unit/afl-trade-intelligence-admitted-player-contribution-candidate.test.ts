import { describe, expect, it } from 'vitest';

import {
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchBytes,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeAdmittedPlayerContributionExecutor,
  loadGovernedScalarTransform,
} from '@/server/aflTradeIntelligence/modeling/admittedPlayerContributionCandidate';

const transform = {
  schemaVersion: 'afl-trade-player-scalar-transform/v1' as const,
  valueUnitId: 'afl-contribution-index',
  weights: { brownlow_votes: 2, coaches_votes: 1.5, games: 1, goals: 0.5 },
};

function repository(reference: ReturnType<typeof createAflTradeCanonicalJsonArtifactRef>) {
  const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(transform));
  const retained = new Map<string, Uint8Array>();
  return {
    assurance: 'local_non_production_filesystem' as const,
    artifactClass: 'derived_private' as const,
    custodyProfile: null,
    async putIfAbsent(targetReference: typeof reference, targetBytes: Uint8Array) {
      retained.set(targetReference.artifactId, targetBytes);
      return { status: 'stored' as const, reference: targetReference };
    },
    async loadExact() {
      return { reference, bytes };
    },
    retained,
  };
}

function admittedObservation(input: {
  ordinal: number;
  partition: 'train' | 'calibration' | 'validation' | 'final_test';
  season: number;
  games: string;
  goals: string;
}) {
  const date = `${input.season}-01-01T00:00:00.000Z`;
  const outcomeObservedAt = `${input.season}-12-03T00:00:00.000Z`;
  const metrics = (['brownlow_votes', 'coaches_votes', 'games', 'goals'] as const).map(
    (metricCode, index) => ({
      metricCode,
      spellMetricVersionId: `acquisition-spell-metric-version:${String(input.ordinal * 10 + index + 1).padStart(64, '0')}`,
      factSha256: String(input.ordinal * 10 + index + 1).padStart(64, '0'),
      headRevision: 1,
      numericValue:
        metricCode === 'games'
          ? input.games
          : metricCode === 'goals'
            ? input.goals
            : String(input.ordinal),
      coverageNumerator: 1,
      coverageDenominator: 1,
      effectiveThrough: `${input.season}-12-31`,
      recordedAt: `${input.season}-12-02T00:00:00.000Z`,
    })
  );
  const content = {
    datasetRowId: createAflTradeContentAddress('valuation-dataset-row', `row-${input.ordinal}`),
    rowOrdinal: input.ordinal,
    rowKey: `row-${input.ordinal}`,
    playerId: `afl-player:${input.ordinal}`,
    clubId: `afl-club:${input.ordinal}`,
    season: input.season,
    eventId: `event:${input.ordinal}`,
    eventVersionId: `event-version:${input.ordinal}`,
    acquisitionSpellId: `acquisition-spell:${input.ordinal}`,
    acquisitionSpellVersionId: `acquisition-spell-version:${String(input.ordinal).padStart(64, '0')}`,
    partition: input.partition,
    predictionCutoffAt: date,
    featureKnownThrough: date,
    targetFrom: `${input.season}-02-01T00:00:00.000Z`,
    targetThrough: `${input.season}-11-30T00:00:00.000Z`,
    outcome: {
      schemaVersion: 'afl-trade-source-native-player-outcome/v1' as const,
      grain: 'player_acquisition_spell_prediction' as const,
      outcomeObservedAt,
      metrics,
    },
  };
  return {
    observationId: createAflTradeContentAddress('player-observation', content),
    ...content,
  };
}

function admittedObservationSet() {
  const observations = [
    admittedObservation({ ordinal: 1, partition: 'train', season: 2010, games: '1', goals: '2' }),
    admittedObservation({ ordinal: 2, partition: 'train', season: 2010, games: '2', goals: '4' }),
    admittedObservation({
      ordinal: 3,
      partition: 'calibration',
      season: 2011,
      games: '2',
      goals: '4',
    }),
    admittedObservation({
      ordinal: 4,
      partition: 'validation',
      season: 2012,
      games: '2',
      goals: '4',
    }),
    admittedObservation({
      ordinal: 5,
      partition: 'final_test',
      season: 2013,
      games: '1',
      goals: '2',
    }),
  ];
  const content = {
    schemaVersion: 'afl-trade-player-observation-set/v2' as const,
    publicIdentityBoundary: 'source_native_no_fantasy_ownership' as const,
    authorityBoundary:
      'deterministic_admitted_dataset_projection_no_fit_grade_publication_or_fantasy_ownership' as const,
    publicationEligible: false as const,
    observationGrain: 'player_acquisition_spell_prediction' as const,
    outcomeVector: ['brownlow_votes', 'coaches_votes', 'games', 'goals'] as const,
    datasetId: createAflTradeContentAddress('dataset', 'admitted-test'),
    datasetRowSetSha256: 'a'.repeat(64),
    datasetAdmissionId: createAflTradeContentAddress('dataset-admission', 'admitted-test'),
    modelProtocolId: createAflTradeContentAddress('model-protocol', 'admitted-test'),
    observations,
  };
  return {
    observationSetId: createAflTradeContentAddress('player-observation-set', content),
    content,
  };
}

describe('admitted player contribution candidate', () => {
  it('loads only the scalar transform bound to the protocol value unit', async () => {
    const reference = createAflTradeCanonicalJsonArtifactRef(transform, '2026-08-26T00:00:00.000Z');
    const protocol = {
      content: {
        valueUnit: { valueUnitId: transform.valueUnitId },
        scalarValueTransformArtifact: reference,
      },
    } as never;

    await expect(
      loadGovernedScalarTransform({
        protocol,
        artifactRepository: repository(reference),
        maximumArtifactBytes: 1024,
      })
    ).resolves.toEqual(transform);
  });

  it('rejects a transform whose governed unit differs from the protocol', async () => {
    const reference = createAflTradeCanonicalJsonArtifactRef(transform, '2026-08-26T00:00:00.000Z');
    const protocol = {
      content: {
        valueUnit: { valueUnitId: 'different-unit' },
        scalarValueTransformArtifact: reference,
      },
    } as never;

    await expect(
      loadGovernedScalarTransform({
        protocol,
        artifactRepository: repository(reference),
        maximumArtifactBytes: 1024,
      })
    ).rejects.toThrow('does not match the model value unit');
  });

  it('executes schema-authenticated admitted evidence and retains the immutable validation artifacts', async () => {
    const transformReference = createAflTradeCanonicalJsonArtifactRef(
      transform,
      '2026-08-26T00:00:00.000Z'
    );
    const artifacts = repository(transformReference);
    const observationSet = admittedObservationSet();
    const executor = createAflTradeAdmittedPlayerContributionExecutor({
      artifactRepository: artifacts,
      maximumArtifactBytes: 1024 * 1024,
      now: () => '2026-08-26T00:00:01.000Z',
    });

    const result = await executor.execute({
      intent: { content: { modelId: 'admitted-player-model' } } as never,
      authorization: {} as never,
      protocol: {
        content: {
          valueUnit: { valueUnitId: transform.valueUnitId },
          scalarValueTransformArtifact: transformReference,
        },
      } as never,
      observationSet,
    });

    expect(result.outcome.status).toBe('succeeded');
    expect(artifacts.retained.size).toBeGreaterThan(2);
    expect(
      [...artifacts.retained.entries()].every(([artifactId, bytes]) =>
        doesAflTradeArtifactRefMatchBytes(
          {
            artifactId,
            contentSha256: artifactId.split(':')[1]!,
            storageUri: `artifact://sha256/${artifactId.split(':')[1]!}`,
            mediaType: 'application/json',
            byteLength: bytes.byteLength,
            createdAt: '2026-08-26T00:00:01.000Z',
          },
          bytes,
          'application/json'
        )
      )
    ).toBe(true);
  });
});
