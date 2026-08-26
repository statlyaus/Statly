import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { loadGovernedScalarTransform } from '@/server/aflTradeIntelligence/modeling/admittedPlayerContributionCandidate';

const transform = {
  schemaVersion: 'afl-trade-player-scalar-transform/v1' as const,
  valueUnitId: 'afl-contribution-index',
  weights: { brownlow_votes: 2, coaches_votes: 1.5, games: 1, goals: 0.5 },
};

function executableArtifact(reference: ReturnType<typeof createAflTradeCanonicalJsonArtifactRef>) {
  return {
    artifactId: reference.artifactId,
    bytes: new TextEncoder().encode(canonicalizeAflTradeJson(transform)),
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

    expect(
      loadGovernedScalarTransform({
        protocol,
        executableArtifacts: [executableArtifact(reference)],
      })
    ).toEqual(transform);
  });

  it('rejects a transform whose governed unit differs from the protocol', async () => {
    const reference = createAflTradeCanonicalJsonArtifactRef(transform, '2026-08-26T00:00:00.000Z');
    const protocol = {
      content: {
        valueUnit: { valueUnitId: 'different-unit' },
        scalarValueTransformArtifact: reference,
      },
    } as never;

    expect(() =>
      loadGovernedScalarTransform({
        protocol,
        executableArtifacts: [executableArtifact(reference)],
      })
    ).toThrow('does not match the model value unit');
  });
});
