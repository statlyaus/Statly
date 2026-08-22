import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { runLocalAflPrivateValuationWorker } from '../../Scripts/dev/run-local-afl-private-valuation-worker';

describe('local private valuation worker', () => {
  it('runs startup catch-up, finishes in-flight dispatch, then closes on shutdown', async () => {
    const controller = new AbortController();
    const end = vi.fn(async () => undefined);
    const enqueueStartupCatchUp = vi.fn(async () => ['request:weekly']);
    let release!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dispatchOne = vi.fn(async () => {
      await inFlight;
      return { state: 'idle' as const };
    });
    const runtime = {
      enqueueStartupCatchUp,
      enqueueAdHoc: vi.fn(),
      repairCurrent: vi.fn(),
      dispatchOne,
      dispatchRequest: vi.fn(),
    };

    const running = runLocalAflPrivateValuationWorker({
      env: {
        AFL_OUTCOMES_DATABASE_URL:
          'postgresql://local:local@127.0.0.1:55432/statly_outcomes_test',
        STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE: 'a'.repeat(64),
        AFL_TRADE_LOCAL_ARTIFACT_ROOT: '/tmp/statly-worker-test-artifacts',
      },
      signal: controller.signal,
      now: () => '2026-07-22T03:00:00.000Z',
      createPool: () => ({ end } as unknown as Pool),
      authenticateRuntime: vi.fn(async () => undefined),
      createRuntime: () => runtime,
    });

    await vi.waitFor(() => expect(dispatchOne).toHaveBeenCalledOnce());
    controller.abort();
    expect(end).not.toHaveBeenCalled();
    release();
    await running;

    expect(enqueueStartupCatchUp).toHaveBeenCalledWith('2026-07-22T03:00:00.000Z');
    expect(end).toHaveBeenCalledOnce();
  });

  it('reports a recurring catch-up transport failure without terminating the worker', async () => {
    const controller = new AbortController();
    const end = vi.fn(async () => undefined);
    const enqueueStartupCatchUp = vi
      .fn<() => Promise<readonly string[]>>()
      .mockResolvedValueOnce(['request:weekly'])
      .mockRejectedValueOnce(new Error('read ECONNRESET'))
      .mockImplementationOnce(async () => {
        controller.abort();
        return [];
      });
    const output: string[] = [];
    const runtime = {
      enqueueStartupCatchUp,
      enqueueAdHoc: vi.fn(),
      repairCurrent: vi.fn(),
      dispatchOne: vi.fn(async () => ({ state: 'idle' as const })),
      dispatchRequest: vi.fn(),
    };

    await expect(
      runLocalAflPrivateValuationWorker({
        env: {
          AFL_OUTCOMES_DATABASE_URL:
            'postgresql://local:local@127.0.0.1:55432/statly_outcomes_test',
          STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE: 'a'.repeat(64),
          AFL_TRADE_LOCAL_ARTIFACT_ROOT: '/tmp/statly-worker-test-artifacts',
        },
        signal: controller.signal,
        now: () => '2026-07-22T03:00:00.000Z',
        pollMilliseconds: 1,
        writeOutput: (line) => output.push(line),
        createPool: () => ({ end } as unknown as Pool),
        authenticateRuntime: vi.fn(async () => undefined),
        createRuntime: () => runtime,
      })
    ).resolves.toBeUndefined();

    expect(output).toEqual([
      JSON.stringify({ state: 'catch_up_failed', message: 'read ECONNRESET' }),
    ]);
    expect(enqueueStartupCatchUp).toHaveBeenCalledTimes(3);
    expect(end).toHaveBeenCalledOnce();
  });
});
