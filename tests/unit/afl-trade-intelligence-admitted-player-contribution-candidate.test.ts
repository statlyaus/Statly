import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { loadGovernedScalarTransform } from '@/server/aflTradeIntelligence/modeling/admittedPlayerContributionCandidate';

const transform = {
  schemaVersion: 'afl-trade-player-scalar-transform/v1' as const,
  valueUnitId: 'afl-contribution-index',
  weights: { brownlow_votes: 2, coaches_votes: 1.5, games: 1, goals: 0.5 },
};

function repository(reference: ReturnType<typeof createAflTradeCanonicalJsonArtifactRef>) {
  const bytes = new TextEncoder().encode(JSON.stringify(transform));
  return {
    assurance: 'local_non_production_filesystem' as const,
    artifactClass: 'derived_private' as const,
    custodyProfile: null,
    async putIfAbsent() {
      return { status: 'stored' as const, reference };
    },
    async loadExact() {
      return { reference, bytes };
    },
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
});
