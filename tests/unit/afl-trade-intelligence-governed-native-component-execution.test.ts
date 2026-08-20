import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { authenticateGovernedNativeComponentExecution } from '@/server/aflTradeIntelligence/valuation/internal/governedNativeComponentExecution';
import { createGovernedValuationComponentRunManifest } from '@/server/aflTradeIntelligence/valuation/internal/governedValuationComponentRunManifest';

import { createGovernedPickPavModelExecutionFixture } from '../testUtils/governedPickPavModelExecutionFixture';

async function fixture() {
  const value = createGovernedPickPavModelExecutionFixture();
  const artifacts = createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' });
  const nativeArtifact = createAflTradeCanonicalJsonArtifactRef(
    value.execution,
    value.execution.content.completedAt
  );
  await artifacts.putIfAbsent(
    nativeArtifact,
    new TextEncoder().encode(canonicalizeAflTradeJson(value.execution))
  );
  const component = createGovernedValuationComponentRunManifest({
    environment: 'non_production',
    role: 'draft_pick_and_future_pick_distribution',
    nativeExecution: {
      kind: 'governed_pick_pav_model_execution',
      executionId: value.execution.executionId,
      artifact: nativeArtifact,
    },
    protocolId: value.execution.content.protocolId,
    protocolArtifact: value.execution.content.protocolArtifact,
    datasetId: value.execution.content.datasetId,
    datasetArtifact: value.execution.content.datasetArtifact,
    datasetAdmissionId: value.execution.content.datasetAdmissionId,
    datasetAdmissionArtifact: value.execution.content.datasetAdmissionArtifact,
    datasetAdmissionGateLedgerRevision:
      value.execution.content.datasetAdmissionGateLedgerRevision,
    registeredAt: '2015-01-03T00:00:02.000Z',
  });
  return { ...value, artifacts, component };
}

describe('governed native component execution authentication', () => {
  it('authenticates the exact retained governed pick execution', async () => {
    const value = await fixture();
    await expect(
      authenticateGovernedNativeComponentExecution({
        manifest: value.component,
        artifactRepository: value.artifacts,
        maximumArtifactBytes: 1024 * 1024,
      })
    ).resolves.toBeUndefined();
  });

  it('rejects wrapper ancestry substitution and substituted native bytes', async () => {
    const value = await fixture();
    const wrongDataset = createGovernedValuationComponentRunManifest({
      ...value.component.content,
      datasetId: `dataset:${'0'.repeat(64)}`,
    });
    await expect(
      authenticateGovernedNativeComponentExecution({
        manifest: wrongDataset,
        artifactRepository: value.artifacts,
        maximumArtifactBytes: 1024 * 1024,
      })
    ).rejects.toThrow(/ancestry|dataset|native/i);

    await expect(
      authenticateGovernedNativeComponentExecution({
        manifest: value.component,
        artifactRepository: {
          ...value.artifacts,
          loadExact: async (reference) => ({
            reference,
            bytes: new TextEncoder().encode('substituted'),
          }),
        },
        maximumArtifactBytes: 1024 * 1024,
      })
    ).rejects.toThrow(/bytes|artifact|native/i);
  });
});
