import { describe, expect, it, vi } from 'vitest';

import {
  LOCAL_FITZROY_REHEARSAL_INSTANTS,
  LOCAL_FITZROY_REHEARSAL_RUNTIME,
  createLocalAflTradeFitzRoyFactualRehearsalFixture,
} from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsalFixture';
import { createLocalAflTradePrivateValuationHpnCapture } from '@/server/aflTradeIntelligence/development/localPrivateValuationHpnCapture';
import type { AflTradeFitzRoyProviderIngestionDependencies } from '@/server/aflTradeIntelligence/source/fitzRoyProviderIngestion';

function fixture() {
  const evidence = createLocalAflTradeFitzRoyFactualRehearsalFixture();
  const captureId = `source-capture:${'a'.repeat(64)}`;
  const normalizationRunId = `provider-normalization-run:${'b'.repeat(64)}`;
  const retainedSnapshots: unknown[] = [];
  const persistedBatches: unknown[] = [];
  const times = [
    LOCAL_FITZROY_REHEARSAL_INSTANTS.normalizationStartedAt,
    LOCAL_FITZROY_REHEARSAL_INSTANTS.normalizationCompletedAt,
  ];
  const captureTimes = [
    LOCAL_FITZROY_REHEARSAL_INSTANTS.effectiveAt,
    '2026-08-12T00:01:03.000Z',
  ];
  const dependencies: AflTradeFitzRoyProviderIngestionDependencies = {
    capture: evidence.captureDependencies,
    staging: {
      rawArtifactRepository: evidence.rawArtifactRepository,
      sourceCaptureRepository: {
        async persist(snapshot) {
          retainedSnapshots.push(snapshot);
          return {
            captureId,
            attemptId: `source-capture-attempt:${'c'.repeat(64)}`,
            sourceSnapshotId: snapshot.snapshotId,
            status: 'staged',
            idempotentReplay: false,
          };
        },
      },
      providerObservationRepository: {
        async persist(input) {
          persistedBatches.push(input);
          return {
            normalizationRunId,
            captureId,
            rowCount: 1,
            issueCount: 0,
            status: 'staged',
            idempotentReplay: false,
          };
        },
        recordFailure: vi.fn(),
      },
      decoderExecutor: evidence.decoderExecutor,
      clock: {
        now: () => times.shift() ?? LOCAL_FITZROY_REHEARSAL_INSTANTS.normalizationCompletedAt,
      },
      dependencyLockSha256: LOCAL_FITZROY_REHEARSAL_RUNTIME.dependencyLockSha256,
      imageDigest: LOCAL_FITZROY_REHEARSAL_RUNTIME.imageDigest,
      timeoutMs: 30_000,
      maximumSourceBytes: 1_024,
      maximumRows: 10,
      maximumFields: 20,
      maximumCells: 200,
      maximumCellBytes: 1_024,
      maximumOutputBytes: 65_536,
      egressExecutionVerifier: evidence.captureDependencies.egressExecutionVerifier,
    },
    clock: { now: () => captureTimes.shift() ?? '2026-08-12T00:01:03.000Z' },
  };
  const authority = { capture: evidence.command.capture, fieldMap: evidence.command.fieldMap };
  const sourceRole = 'hpn_corroborating_player_stats' as const;
  const sources = { [sourceRole]: { authority, dependencies } };
  const request = {
    requestId: `private-valuation-dispatch:${'d'.repeat(64)}`,
    claim: {
      claimId: `private-valuation-dispatch-claim:${'e'.repeat(64)}`,
      leaseToken: 'f'.repeat(64),
    },
    sourceRole,
    ...authority,
  };
  return { sources, request, retainedSnapshots, persistedBatches, normalizationRunId };
}

describe('local private valuation HPN capture', () => {
  it('returns the normalized capture retained through the authorized ingestion boundary', async () => {
    const value = fixture();
    const capture = createLocalAflTradePrivateValuationHpnCapture({
      scopeKey: 'afl-men:2026-trades',
      sources: value.sources,
    });

    await expect(capture(value.request)).resolves.toEqual({
      normalizationRunId: value.normalizationRunId,
    });
    expect(value.retainedSnapshots).toHaveLength(1);
    expect(value.retainedSnapshots[0]).toMatchObject({
      content: { capture: { upstreamProvider: 'footywire' } },
    });
    expect(value.persistedBatches).toHaveLength(1);
    expect(value.persistedBatches[0]).toMatchObject({
      fieldMapId: 'footywire-player-stats-local-rehearsal-v1',
    });
  });

  it('rejects a 2026 lane in the 2025 scope before external execution', async () => {
    const value = fixture();
    const executor = vi.spyOn(
      value.sources.hpn_corroborating_player_stats.dependencies.capture.executor,
      'execute'
    );
    const capture = createLocalAflTradePrivateValuationHpnCapture({
      scopeKey: 'afl-men:2025-trades',
      sources: value.sources,
    });

    await expect(capture(value.request)).rejects.toThrow('scope');
    expect(executor).not.toHaveBeenCalled();
    expect(value.retainedSnapshots).toEqual([]);
  });

  it('rejects player statistics configured as completed results before external execution', async () => {
    const value = fixture();
    const lane = value.sources.hpn_corroborating_player_stats;
    const executor = vi.spyOn(lane.dependencies.capture.executor, 'execute');
    const capture = createLocalAflTradePrivateValuationHpnCapture({
      scopeKey: 'afl-men:2026-trades',
      sources: { hpn_completed_results: lane },
    });

    await expect(
      capture({ ...value.request, sourceRole: 'hpn_completed_results' })
    ).rejects.toThrow('role');
    expect(executor).not.toHaveBeenCalled();
  });

  it.each(['field map', 'capture'] as const)(
    'rejects substituted %s authority before external execution',
    async (substitution) => {
      const value = fixture();
      const executor = vi.spyOn(
        value.sources.hpn_corroborating_player_stats.dependencies.capture.executor,
        'execute'
      );
      const capture = createLocalAflTradePrivateValuationHpnCapture({
        scopeKey: 'afl-men:2026-trades',
        sources: value.sources,
      });
      const request =
        substitution === 'field map'
          ? { ...value.request, fieldMap: { ...value.request.fieldMap, mapId: 'substituted' } }
          : {
              ...value.request,
              capture: {
                ...value.request.capture,
                gateRequest: { ...value.request.capture.gateRequest, audience: 'substituted' },
              },
            };

      await expect(capture(request)).rejects.toThrow('configured authority');
      expect(executor).not.toHaveBeenCalled();
    }
  );

  it('rejects an unconfigured source role before external execution', async () => {
    const value = fixture();
    const executor = vi.spyOn(
      value.sources.hpn_corroborating_player_stats.dependencies.capture.executor,
      'execute'
    );
    const capture = createLocalAflTradePrivateValuationHpnCapture({
      scopeKey: 'afl-men:2026-trades',
      sources: value.sources,
    });
    await expect(
      capture({ ...value.request, sourceRole: 'hpn_primary_player_stats' })
    ).rejects.toThrow('No exact HPN capture source lane');
    expect(executor).not.toHaveBeenCalled();
  });

  it('rejects a configured provider that differs from the capture capability before IO', async () => {
    const value = fixture();
    const lane = value.sources.hpn_corroborating_player_stats;
    lane.authority.capture.sourceRights.content.provider = 'afl_tables';
    const executor = vi.spyOn(lane.dependencies.capture.executor, 'execute');
    const capture = createLocalAflTradePrivateValuationHpnCapture({
      scopeKey: 'afl-men:2026-trades',
      sources: value.sources,
    });
    await expect(capture(value.request)).rejects.toThrow('provider');
    expect(executor).not.toHaveBeenCalled();
  });

  it('does not return normalization success when source retention fails', async () => {
    const value = fixture();
    const lane = value.sources.hpn_corroborating_player_stats;
    vi.spyOn(lane.dependencies.staging.sourceCaptureRepository, 'persist').mockRejectedValue(
      new Error('source retention unavailable')
    );
    const capture = createLocalAflTradePrivateValuationHpnCapture({
      scopeKey: 'afl-men:2026-trades',
      sources: value.sources,
    });
    await expect(capture(value.request)).rejects.toThrow('source retention unavailable');
    expect(value.persistedBatches).toEqual([]);
  });
});
