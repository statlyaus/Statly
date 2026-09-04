import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  refreshCurrent: vi.fn(),
  runPrivate: vi.fn(),
  dispatchRun: undefined as
    | ((input: {
        request: { requestId: string; scopeKey: string; trigger: 'ad_hoc' };
        claim: { claimId: string; leaseToken: string };
      }) => Promise<unknown>)
    | undefined,
}));

vi.mock('@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient', () => ({
  createPgAflOutcomeSqlClient: () => ({ query: vi.fn(), transaction: vi.fn() }),
}));
vi.mock('@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository', () => ({
  createPostgresAflTradeGateDecisionLedgerRepository: () => ({}),
}));
vi.mock('@/server/aflTradeIntelligence/source/fitzRoyCaptureToStaging', () => ({
  stageAflTradeFitzRoySourceSnapshot: vi.fn(),
}));
vi.mock('@/server/aflTradeIntelligence/source/fitzRoyProviderIngestion', () => ({
  captureAuthorizedAflTradeFitzRoyProviderSeason: vi.fn(),
}));
vi.mock('@/server/aflTradeIntelligence/source/postgresProviderObservationRepository', () => ({
  PostgresAflTradeProviderObservationRepository: class {},
}));
vi.mock('@/server/aflTradeIntelligence/source/postgresSourceCaptureRepository', () => ({
  PostgresAflTradeSourceCaptureRepository: class {},
}));
vi.mock('@/server/aflTradeIntelligence/development/localFileConditionalObjectStore', () => ({
  createLocalAflTradeNonProductionArtifactRepository: () => ({}),
  createLocalAflTradePrivateDerivedArtifactRepository: () => ({}),
}));
vi.mock('@/server/aflTradeIntelligence/development/localEgressSigningAuthority', () => ({
  createLocalAflTradeEgressSigningAuthority: () => ({
    signingKey: {},
    verifier: {},
  }),
}));
vi.mock('@/server/aflTradeIntelligence/development/localDockerFitzRoyDecodeExecutor', () => ({
  createLocalAflTradeDockerFitzRoyDecodeExecutor: () => ({}),
}));
vi.mock('@/server/aflTradeIntelligence/development/localDockerFitzRoyCaptureExecutor', () => ({
  createLocalAflTradeDockerFitzRoyCaptureExecutor: () => ({}),
}));
vi.mock('@/server/aflTradeIntelligence/development/localCurrentValuationReconciliationAuthority', () => ({
  createLocalAflTradeCurrentValuationReconciliationAuthority: () => ({}),
}));
vi.mock('@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesStaging', () => ({
  LOCAL_AFL_TRADE_FITZROY_RUNTIME: {
    dependencyLockSha256: 'a'.repeat(64),
    imageDigest: `sha256:${'b'.repeat(64)}`,
  },
}));
vi.mock('@/server/aflTradeIntelligence/valuation/currentValuationEvidenceOrchestration', () => ({
  createAflTradeCurrentValuationEvidenceCoordinator: () => ({
    refreshCurrent: runtime.refreshCurrent,
  }),
}));
vi.mock('@/server/aflTradeIntelligence/valuation/currentValuationRefresh', () => ({
  createAflTradeCurrentValuationRefresh: () => ({}),
}));
vi.mock(
  '@/server/aflTradeIntelligence/valuation/postgresCurrentValuationEvidenceOrchestration',
  () => ({
    PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository: class {},
    createPostgresAflTradeCurrentValuationEvidenceSourceRuntime: () => ({}),
    retainAflTradeCurrentValuationObservedCapture: vi.fn(),
  })
);
vi.mock(
  '@/server/aflTradeIntelligence/valuation/postgresPrivateReviewedEvidenceEvaluationAuthority',
  () => ({
    AflTradePrivateReviewedEvidenceEvaluationPersistenceError: class extends Error {},
    PostgresAflTradePrivateReviewedEvidenceEvaluationAuthority: class {},
  })
);
vi.mock(
  '@/server/aflTradeIntelligence/valuation/internal/createPostgresGovernedPrivateEvaluationWorkspace',
  () => ({ createPostgresGovernedPrivateEvaluationWorkspace: () => ({}) })
);
vi.mock('@/server/aflTradeIntelligence/valuation/postgresCurrentValuationCohortRunner', () => ({
  createPostgresAflTradePrivateEvaluationCohortRunner: () => ({
    runPrivate: runtime.runPrivate,
    repairCurrent: vi.fn(),
  }),
}));
vi.mock(
  '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationBatchRepository',
  () => ({ PostgresGovernedPrivateEvaluationBatchRepository: class {} })
);
vi.mock('@/server/aflTradeIntelligence/valuation/postgresPrivateValuationScheduling', () => ({
  PostgresAflTradePrivateValuationScheduleRepository: class {},
  createPostgresAflTradePrivateValuationDispatcher: (input: {
    runner: { run: typeof runtime.dispatchRun };
  }) => {
    runtime.dispatchRun = input.runner.run;
    return {};
  },
}));

import { createLocalAflTradePrivateValuationRuntime } from '@/server/aflTradeIntelligence/development/localPrivateValuationRuntime';

const request = {
  requestId: `private-valuation-dispatch:${'a'.repeat(64)}`,
  scopeKey: 'afl-men:2026-trades',
  trigger: 'ad_hoc' as const,
  scheduledFor: '2026-09-05T01:00:00.000Z',
  authorityKey: 'fixture-authority',
};
const claim = {
  claimId: `private-valuation-dispatch-claim:${'b'.repeat(64)}`,
  leaseToken: 'fixture-lease-token',
};

describe('local private valuation runtime dispatch continuation', () => {
  beforeEach(() => {
    runtime.refreshCurrent.mockReset();
    runtime.runPrivate.mockReset();
    runtime.dispatchRun = undefined;
    createLocalAflTradePrivateValuationRuntime({
      pool: {} as never,
      artifactRoot: '/tmp/statly-local-private-valuation-runtime-test',
    });
  });

  it('continues a factual no-change replay into the claim-fenced private cohort', async () => {
    runtime.refreshCurrent.mockResolvedValue({
      state: 'complete',
      currentValuationRefresh: { state: 'no_change' },
    });
    runtime.runPrivate.mockResolvedValue({ state: 'already_current' });

    await expect(runtime.dispatchRun!({ request, claim })).resolves.toEqual({
      state: 'already_current',
    });
    expect(runtime.runPrivate).toHaveBeenCalledWith({ request, claim });
  });

  it('keeps unavailable evidence terminal without invoking the private cohort', async () => {
    runtime.refreshCurrent.mockResolvedValue({ state: 'unavailable' });

    await expect(runtime.dispatchRun!({ request, claim })).resolves.toEqual({
      state: 'exhausted',
    });
    expect(runtime.runPrivate).not.toHaveBeenCalled();
  });
});
