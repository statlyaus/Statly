import { beforeEach, describe, expect, it, vi } from 'vitest';

const composition = vi.hoisted(() => ({
  preparePrivate: vi.fn(),
  runPrivate: vi.fn(),
  repairCurrent: vi.fn(),
  createCohortCoordinator: vi.fn(),
  createCohortRunner: vi.fn(),
  createModelPairRunner: vi.fn(),
  createDispatcher: vi.fn(),
  createAdmittedPlayerExecutor: vi.fn(),
  createDispatchBoundPlayerExecutor: vi.fn(),
  admittedModelRunner: vi.fn(),
}));

vi.mock('@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient', () => ({
  createPgAflOutcomeSqlClient: vi.fn(() => ({})),
}));
vi.mock(
  '@/server/aflTradeIntelligence/valuation/internal/createPostgresGovernedPrivateEvaluationWorkspace',
  () => ({ createPostgresGovernedPrivateEvaluationWorkspace: vi.fn(() => ({})) })
);
vi.mock(
  '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationBatchRepository',
  () => ({ PostgresGovernedPrivateEvaluationBatchRepository: class {} })
);
vi.mock(
  '@/server/aflTradeIntelligence/valuation/postgresCurrentValuationCohortPreparation',
  () => ({
    createPostgresAflTradePrivateCurrentValuationCohortCoordinator:
      composition.createCohortCoordinator,
  })
);
vi.mock('@/server/aflTradeIntelligence/valuation/postgresCurrentValuationCohortRunner', () => ({
  createPostgresAflTradePrivateEvaluationCohortRunner: composition.createCohortRunner,
}));
vi.mock('@/server/aflTradeIntelligence/valuation/postgresPrivateValuationModelPair', () => ({
  createPostgresAflTradePrivateValuationModelPairDispatchRunner: composition.createModelPairRunner,
  createAflTradeDispatchBoundAdmittedPlayerExecutor: composition.createDispatchBoundPlayerExecutor,
}));
vi.mock('@/server/aflTradeIntelligence/modeling/admittedPlayerContributionCandidate', () => ({
  createAflTradeAdmittedPlayerContributionExecutor: composition.createAdmittedPlayerExecutor,
}));
vi.mock('@/server/aflTradeIntelligence/modeling/admittedModelRunAuthority', () => ({
  AflTradeAdmittedModelRunner: composition.admittedModelRunner,
}));
vi.mock('@/server/aflTradeIntelligence/valuation/postgresPrivateValuationScheduling', () => ({
  PostgresAflTradePrivateValuationScheduleRepository: class {},
  createPostgresAflTradePrivateValuationDispatcher: composition.createDispatcher,
}));
vi.mock('@/server/aflTradeIntelligence/development/localFileConditionalObjectStore', () => ({
  createLocalAflTradePrivateDerivedArtifactRepository: vi.fn(() => ({})),
}));

import { createLocalAflTradePrivateValuationRuntime } from '@/server/aflTradeIntelligence/development/localPrivateValuationRuntime';

const runtimeSurface = {
  enqueueStartupCatchUp: expect.any(Function),
  enqueueAdHoc: expect.any(Function),
  repairCurrent: expect.any(Function),
  dispatchOne: expect.any(Function),
  dispatchRequest: expect.any(Function),
};
const request = { requestId: 'dispatch-new', scopeKey: 'AFL:2026:Round 1' };
const claim = { claimId: 'claim-new', leaseToken: 'lease-new' };

function upstream() {
  return {
    hpnPreparation: {} as never,
    targets: {} as never,
    playerExecutor: {} as never,
    pickExecutor: {} as never,
    qualificationRegistrar: {} as never,
    loadPrivateConstructionEvidence: vi.fn() as never,
    constructTrade: vi.fn() as never,
  };
}

describe('local private valuation runtime composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    composition.createCohortCoordinator.mockReturnValue({
      preparePrivate: composition.preparePrivate,
    });
    composition.createCohortRunner.mockReturnValue({
      runPrivate: composition.runPrivate,
      repairCurrent: composition.repairCurrent,
    });
    composition.createModelPairRunner.mockImplementation((input) => ({
      run: vi.fn(),
      repairCurrent: input.repairCurrent,
    }));
    composition.createAdmittedPlayerExecutor.mockReturnValue({ execute: vi.fn() });
    composition.admittedModelRunner.mockImplementation(() => ({ run: vi.fn() }));
    composition.createDispatchBoundPlayerExecutor.mockImplementation((input) => ({
      execute: vi.fn(),
      source: input,
    }));
    composition.createDispatcher.mockReturnValue(runtimeSurface);
  });

  it('keeps scheduling and repair composition available while execution adapters are blocked', async () => {
    const runtime = createLocalAflTradePrivateValuationRuntime({
      pool: {} as never,
      artifactRoot: '/tmp/not-read-without-a-runner',
    });

    expect(runtime).toEqual(runtimeSurface);
    const dispatchRunner = composition.createDispatcher.mock.calls[0]?.[0].runner;
    await expect(dispatchRunner.run()).rejects.toThrow(
      'Local private valuation execution is not configured: admitted player execution, governed pick execution, model qualification, model targets, HPN preparation, and prepared-cohort construction adapters are required.'
    );
    await dispatchRunner.repairCurrent('scope', 'reason', 'repair-operation');
    expect(composition.repairCurrent).toHaveBeenCalledWith('scope', 'reason', 'repair-operation');
  });

  it('continues a new dispatch through a substantively reused prepared head', async () => {
    const prepared = {
      state: 'already_current',
      privateAuthority: { dispatchRequestId: 'dispatch-old' },
    };
    const completed = { state: 'completed', batchId: 'batch-new' };
    composition.preparePrivate.mockResolvedValue(prepared);
    composition.runPrivate.mockResolvedValue(completed);

    const runtime = createLocalAflTradePrivateValuationRuntime({
      pool: {} as never,
      artifactRoot: '/tmp/statly-private-runtime-composition-fixture',
      upstream: upstream(),
    });

    expect(runtime).toEqual(runtimeSurface);
    const modelPairInput = composition.createModelPairRunner.mock.calls[0]?.[0];
    await expect(modelPairInput.continueQualified({ request, claim })).resolves.toBe(completed);
    expect(composition.preparePrivate).toHaveBeenCalledWith({
      requestId: request.requestId,
      claim,
    });
    expect(composition.runPrivate).toHaveBeenCalledWith({ request, claim });
  });

  it('constructs the admitted player through the authorized dispatch boundary and durable clock', async () => {
    const clock = { now: vi.fn(async () => '2026-08-26T11:00:00.000Z') };
    const admittedPlayer = {
      authority: {} as never,
      authorizationStore: {} as never,
      clock,
      completedRunStore: {} as never,
      failureRecorder: {} as never,
      authorityPreparation: { prepare: vi.fn() },
      prepareRun: vi.fn(),
      registerComponent: vi.fn(),
    };
    const { playerExecutor: _playerExecutor, ...withoutOverride } = upstream();

    createLocalAflTradePrivateValuationRuntime({
      pool: {} as never,
      artifactRoot: '/tmp/statly-private-runtime-admitted-player',
      upstream: { ...withoutOverride, admittedPlayer },
    });

    const executorInput = composition.createAdmittedPlayerExecutor.mock.calls[0]?.[0];
    await expect(executorInput.now()).resolves.toBe('2026-08-26T11:00:00.000Z');
    expect(clock.now).toHaveBeenCalledOnce();
    expect(composition.admittedModelRunner).toHaveBeenCalledWith(
      admittedPlayer.authority,
      expect.anything(),
      admittedPlayer.authorizationStore,
      admittedPlayer.clock,
      admittedPlayer.completedRunStore,
      admittedPlayer.failureRecorder
    );
    expect(composition.createDispatchBoundPlayerExecutor).toHaveBeenCalledWith({
      admittedRunner: expect.anything(),
      authorityPreparation: admittedPlayer.authorityPreparation,
      prepareRun: admittedPlayer.prepareRun,
      registerComponent: admittedPlayer.registerComponent,
    });
  });

  it('defers a missing admitted player blocker until the player dispatch is attempted', async () => {
    const { playerExecutor: _playerExecutor, ...withoutPlayer } = upstream();

    const runtime = createLocalAflTradePrivateValuationRuntime({
      pool: {} as never,
      artifactRoot: '/tmp/statly-private-runtime-missing-admitted-player',
      upstream: withoutPlayer,
    });

    expect(runtime).toEqual(runtimeSurface);
    const modelPairInput = composition.createModelPairRunner.mock.calls[0]?.[0];
    await expect(modelPairInput.playerExecutor.execute({} as never)).rejects.toThrow(
      'Local private valuation execution is not configured: an admitted player composition or dispatch-bound player adapter is required.'
    );
  });

  it('does not enter the cohort after prepared authority becomes stale', async () => {
    const stale = { state: 'stale_authority' };
    composition.preparePrivate.mockResolvedValue(stale);

    createLocalAflTradePrivateValuationRuntime({
      pool: {} as never,
      artifactRoot: '/tmp/statly-private-runtime-stale-fixture',
      upstream: upstream(),
    });

    const modelPairInput = composition.createModelPairRunner.mock.calls[0]?.[0];
    await expect(modelPairInput.continueQualified({ request, claim })).resolves.toBe(stale);
    expect(composition.runPrivate).not.toHaveBeenCalled();
  });
});
