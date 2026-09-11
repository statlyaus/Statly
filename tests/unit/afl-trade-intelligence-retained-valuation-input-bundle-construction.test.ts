import { describe, expect, it } from 'vitest';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createAflTradeRetainedValuationInputBundleConstructor } from '@/server/aflTradeIntelligence/valuation/retainedValuationInputBundleConstruction';
import { createAflTradeValuationInputBundleConstructionFixture } from '../testUtils/valuationInputBundleConstructionFixture';

async function retainedFixture() {
  const fixture = createAflTradeValuationInputBundleConstructionFixture();
  const artifactRepository = createAflTradeFixtureArtifactRepository({
    artifactClass: 'derived_private',
  });
  await artifactRepository.putIfAbsent(fixture.specificationArtifact, fixture.specificationBytes);
  for (const retained of Object.values(fixture.policies)) {
    await artifactRepository.putIfAbsent(
      retained.artifact,
      new TextEncoder().encode(canonicalizeAflTradeJson(retained.value))
    );
  }
  const componentRuns = {
    async loadExact(runId: string) {
      if (runId === fixture.playerRun.manifest.runId) return fixture.playerRun;
      if (runId === fixture.pickRun.manifest.runId) return fixture.pickRun;
      throw new TypeError('Component run is unavailable.');
    },
  };
  return { fixture, artifactRepository, componentRuns };
}

describe('retained AFL trade valuation-input bundle construction', () => {
  it('requires private derived-artifact custody', () => {
    expect(() =>
      createAflTradeRetainedValuationInputBundleConstructor({
        artifactRepository: createAflTradeFixtureArtifactRepository(),
        maximumArtifactBytes: 1024,
        componentRuns: { loadExact: async () => null as never },
        modelEvidence: {
          loadCurrent: async () => ({ evidence: null, constructedAt: '2026-08-15T02:05:00.000Z' }),
        },
      })
    ).toThrow('Retained bundle construction requires bounded private artifact custody.');
  });

  it('authenticates retained configuration and component ancestry before retaining the bundle', async () => {
    const retained = await retainedFixture();
    const construct = createAflTradeRetainedValuationInputBundleConstructor({
      artifactRepository: retained.artifactRepository,
      maximumArtifactBytes: 100_000,
      componentRuns: retained.componentRuns,
      modelEvidence: {
        loadCurrent: async () => ({
          evidence: retained.fixture.modelEvidence,
          constructedAt: '2026-08-15T02:05:00.000Z',
        }),
      },
    });

    const first = await construct({
      modelEvidenceOperationId: retained.fixture.modelEvidence.operationId,
      scopeKey: retained.fixture.modelEvidence.scopeKey,
      specificationArtifact: retained.fixture.specificationArtifact,
    });
    const replay = await construct({
      modelEvidenceOperationId: retained.fixture.modelEvidence.operationId,
      scopeKey: retained.fixture.modelEvidence.scopeKey,
      specificationArtifact: retained.fixture.specificationArtifact,
    });

    expect(replay).toEqual(first);
    expect(first.specificationId).toBe(retained.fixture.specification.specificationId);
    expect(first.valuationInputBundle.content.createdAt).toBe('2026-08-15T02:05:00.000Z');
    expect(first.valuationInputBundle.content.components.map(({ runId }) => runId)).toEqual([
      retained.fixture.playerRun.manifest.runId,
      retained.fixture.pickRun.manifest.runId,
    ]);
    expect(
      await retained.artifactRepository.loadExact(first.valuationInputBundleArtifact, 100_000)
    ).not.toBeNull();
  });

  it('rejects a retained specification from another valuation scope', async () => {
    const retained = await retainedFixture();
    const construct = createAflTradeRetainedValuationInputBundleConstructor({
      artifactRepository: retained.artifactRepository,
      maximumArtifactBytes: 100_000,
      componentRuns: retained.componentRuns,
      modelEvidence: {
        loadCurrent: async () => ({
          evidence: retained.fixture.modelEvidence,
          constructedAt: '2026-08-15T02:05:00.000Z',
        }),
      },
    });

    const privateFactualAuthority = {
      ...retained.fixture.modelEvidence.privateFactualAuthority,
      valuationScopeKey: 'afl-men:2026-trades',
    };
    const operationPreimage = {
      scopeKey: 'afl-men:2026-trades',
      factualOperationId: retained.fixture.modelEvidence.factualOperationId,
      privateFactualAuthority,
    };
    await expect(
      construct({
        modelEvidenceOperationId: createAflTradeContentAddress(
          'current-valuation-model-evidence-operation',
          operationPreimage
        ),
        scopeKey: 'afl-men:2026-trades',
        specificationArtifact: retained.fixture.specificationArtifact,
      })
    ).rejects.toThrow(
      'Retained bundle construction specification does not match current model authority.'
    );
  });

  it('rejects a specification reference without exact retained bytes', async () => {
    const retained = await retainedFixture();
    const emptyRepository = createAflTradeFixtureArtifactRepository({
      artifactClass: 'derived_private',
    });
    const construct = createAflTradeRetainedValuationInputBundleConstructor({
      artifactRepository: emptyRepository,
      maximumArtifactBytes: 100_000,
      componentRuns: retained.componentRuns,
      modelEvidence: {
        loadCurrent: async () => ({
          evidence: retained.fixture.modelEvidence,
          constructedAt: '2026-08-15T02:05:00.000Z',
        }),
      },
    });

    await expect(
      construct({
        modelEvidenceOperationId: retained.fixture.modelEvidence.operationId,
        scopeKey: retained.fixture.modelEvidence.scopeKey,
        specificationArtifact: retained.fixture.specificationArtifact,
      })
    ).rejects.toThrow('Bundle construction specification failed exact byte authentication.');
  });
});
