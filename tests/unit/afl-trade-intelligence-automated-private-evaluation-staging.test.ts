import { replayGovernedPrivateEvaluationMaterialization } from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationMaterializer';
import { createAutomatedGovernedPrivateEvaluationStagingService } from '@/server/aflTradeIntelligence/valuation/internal/automatedGovernedPrivateEvaluationStagingService';
import type { GovernedPrivateEvaluationGenerationMaterialization } from '@/server/aflTradeIntelligence/valuation/governedPrivateEvaluationGeneration';
import type { AutomatedGovernedPrivateEvaluationTransitionIntent } from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationLifecycle';
import { createGovernedPrivateEvaluationAuthenticatedCalculationFixture } from '../testUtils/governedPrivateEvaluationAuthenticatedCalculationFixture';

type AutomatedStagingDependencies = Parameters<
  typeof createAutomatedGovernedPrivateEvaluationStagingService
>[0];

describe('automated private evaluation staging', () => {
  it('constructs without manual scoring and resumes the same staged operation', async () => {
    const fixture = createGovernedPrivateEvaluationAuthenticatedCalculationFixture();
    let staged: {
      intent: AutomatedGovernedPrivateEvaluationTransitionIntent;
      materialization: GovernedPrivateEvaluationGenerationMaterialization;
    } | null = null;
    const stage = vi.fn<AutomatedStagingDependencies['stage']>(async (input) => {
      staged = input;
      return {
        transitionIntentId: input.intent.transitionIntentId,
        generationId: input.materialization.generation.generationId,
      };
    });
    const dependencies: AutomatedStagingDependencies = {
      trustedNow: async () => '2026-08-21T09:00:00.000Z',
      loadStaged: async () =>
        staged === null
          ? null
          : {
              selector: staged.intent.content.selector,
              principalId: staged.intent.content.constructionAuthority.principalId,
              generationId: staged.materialization.generation.generationId,
              intent: staged.intent,
              previousTransitionId: null,
            },
      captureAuthority: async ({ selector }) => ({
        state: 'ready',
        selector,
        inspectionId: `private-evaluation-inspection:${'a'.repeat(64)}`,
        authoritySnapshotId: `private-evaluation-authority-snapshot:${'b'.repeat(64)}`,
        validThrough: '2026-08-21T09:10:00.000Z',
        head: { status: 'absent', revision: 0, generationId: null },
        previousTransitionId: null,
        materializationManifestId: fixture.materializationManifest.manifestId,
      }),
      replayMaterialization: async () =>
        replayGovernedPrivateEvaluationMaterialization({
          ...fixture,
          playerObservations: [],
        }),
      stage,
      retainArtifact: async ({ reference }) => reference,
      commit: async ({ receipt }) => ({
        state: 'committed',
        head: receipt.content.toHead,
        transitionId: receipt.transitionId,
      }),
    };
    const legacyDependencies = {
      ...dependencies,
      principalId: 'system:weekly-valuation-coordinator',
    };
    expect(() =>
      createAutomatedGovernedPrivateEvaluationStagingService(legacyDependencies as never)
    ).toThrow('does not accept a caller-supplied principal');
    const service = createAutomatedGovernedPrivateEvaluationStagingService(dependencies);
    const request = {
      selector: fixture.materializationManifest.content.selector,
      operationId: `private-evaluation-operation:${'c'.repeat(64)}`,
    };

    const first = await service.stage(request);
    const replay = await service.stage(request);

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      state: 'activated',
      selector: request.selector,
      head: { status: 'active', revision: 1 },
    });
    expect(stage).toHaveBeenCalledTimes(1);
    const stagedInput = stage.mock.calls[0]![0];
    expect(stagedInput.intent.content).toMatchObject({
      schemaVersion: 'private-evaluation-transition-intent/v2',
      environment: 'non_production',
      constructionAuthority: { principalId: 'system:weekly-valuation-coordinator' },
    });
    expect(stagedInput.materialization.generation.content).toMatchObject({
      schemaVersion: 'local-private-trade-evaluation-generation/v2',
      environment: 'non_production',
      publicationProhibited: true,
    });
  });
});
