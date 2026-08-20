import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeLineageGraphId } from '@/server/aflTradeIntelligence/valuation/valuationCaseContracts';
import { createGovernedPrivateEvaluationMaterializationManifest } from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationMaterializationManifest';
import { PostgresGovernedPrivateEvaluationMaterializationManifestRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationMaterializationManifestRepository';
import { createGovernedPrivateEvaluationAuthenticatedCalculationFixture } from '../testUtils/governedPrivateEvaluationAuthenticatedCalculationFixture';

const CREATED_AT = '2026-08-19T10:30:00.000Z';

function input() {
  const fixture = createGovernedPrivateEvaluationAuthenticatedCalculationFixture();
  return {
    schemaVersion: 'private-evaluation-materialization-manifest/v1' as const,
    environment: 'non_production' as const,
    selector: fixture.trace.content.selector,
    calculationInputPackageId: fixture.calculationInputPackage.calculationInputPackageId,
    calculationInputArtifact: createAflTradeCanonicalJsonArtifactRef(
      fixture.calculationInputPackage,
      CREATED_AT
    ),
    inputTraceId: fixture.trace.inputTraceId,
    inputTraceArtifact: createAflTradeCanonicalJsonArtifactRef(fixture.trace, CREATED_AT),
    explanationPolicyId: fixture.explanationPolicy.policyId,
    explanationPolicyArtifact: createAflTradeCanonicalJsonArtifactRef(
      fixture.explanationPolicy,
      CREATED_AT
    ),
    lineageGraphId: createAflTradeLineageGraphId(fixture.lineageGraph),
    lineageGraphArtifact: createAflTradeCanonicalJsonArtifactRef(
      fixture.lineageGraph,
      CREATED_AT
    ),
    pickBenchmarks: fixture.pickBenchmarks.map((benchmark) => ({
      benchmarkId: benchmark.benchmarkId,
      artifact: createAflTradeCanonicalJsonArtifactRef(benchmark, CREATED_AT),
    })),
    playerObservations: [],
    createdAt: CREATED_AT,
    publicationEligible: false as const,
    limitation:
      'Private materialization inputs only; not model, grade, activation, production, or publication authority.' as const,
  };
}

describe('governed private-evaluation materialization manifest', () => {
  it('exposes registration and exact replay only through the private PostgreSQL repository', () => {
    const repository = new PostgresGovernedPrivateEvaluationMaterializationManifestRepository({
      query: async () => ({ rows: [], rowCount: 0 }),
      transaction: async (work) =>
        work({ query: async () => ({ rows: [], rowCount: 0 }) }),
    });

    expect(repository.register).toEqual(expect.any(Function));
    expect(repository.loadExact).toEqual(expect.any(Function));
  });

  it('pins every exact parent required to replay one trade calculation and story', () => {
    const manifest = createGovernedPrivateEvaluationMaterializationManifest(input());

    expect(manifest.manifestId).toMatch(
      /^private-evaluation-materialization-manifest:[a-f0-9]{64}$/
    );
    expect(manifest.content).toMatchObject({
      environment: 'non_production',
      selector: {
        valuationScopeKey: 'afl-men:authenticated-contract-fixture',
        tradeId: 'trade:authenticated-three-club',
      },
      pickBenchmarks: [
        expect.objectContaining({ benchmarkId: expect.stringMatching(/^pick-pav-benchmark:/) }),
      ],
      playerObservations: [],
      publicationEligible: false,
    });
  });

  it('rejects an artifact reused for two distinct retained parents', () => {
    const value = input();
    value.explanationPolicyArtifact = value.inputTraceArtifact;

    expect(() => createGovernedPrivateEvaluationMaterializationManifest(value)).toThrow(
      'Materialization manifest parents require distinct retained bytes.'
    );
  });
});
