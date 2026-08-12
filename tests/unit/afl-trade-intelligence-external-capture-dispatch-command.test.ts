import { describe, expect, it, vi } from 'vitest';

import { runAflTradeExternalCaptureDispatchCommand } from '../../Scripts/dispatch-due-external-draft-trades';

const digest = (character: string) => character.repeat(64);

function environment() {
  const policy = {
    requests: 1,
    perSeconds: 3,
    burst: 1,
    cacheSeconds: 86_400,
    maximumLeaseMs: 60_000,
    egressPolicyEvidenceId: `artifact:${digest('1')}`,
  };
  return {
    AFL_TRADE_CAPTURE_ENVIRONMENT: 'non_production',
    AFL_OUTCOMES_DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/fixture',
    AFL_TRADE_CAPTURE_REDIS_URL: 'redis://127.0.0.1:6379',
    AFL_TRADE_OBJECT_REGION: 'ap-southeast-2',
    AFL_TRADE_OBJECT_BUCKET: 'fixture-bucket',
    AFL_TRADE_OBJECT_PREFIX: 'afl-trade',
    AFL_TRADE_OBJECT_KMS_KEY_ID: 'fixture-kms-key',
    AFL_TRADE_CAPTURE_REPOSITORY_ID: 'fixture-repository',
    AFL_TRADE_CAPTURE_INFRASTRUCTURE_EVIDENCE_IDS: `artifact:${digest('2')}`,
    AFL_TRADE_CAPTURE_ALLOWED_JURISDICTIONS: 'AU',
    AFL_TRADE_EXTERNAL_USER_AGENT: 'Statly AFL evidence capture contact: ops@example.test',
    AFL_TRADE_EXTERNAL_TIMEOUT_MS: '30000',
    AFL_TRADE_EXTERNAL_MAX_SOURCE_BYTES: '1048576',
    AFL_TRADE_EXTERNAL_RAW_RETENTION_DAYS: '365',
    AFL_TRADE_EXTERNAL_SOURCE_POLICIES_JSON: JSON.stringify({
      draftguru: policy,
      footywire: { ...policy, egressPolicyEvidenceId: `artifact:${digest('3')}` },
      official_afl: { ...policy, egressPolicyEvidenceId: `artifact:${digest('4')}` },
    }),
  };
}

describe('external capture dispatch command', () => {
  it('composes one bounded non-production tick and always closes runtime resources', async () => {
    const closeRuntime = vi.fn(async () => undefined);
    const closePool = vi.fn(async () => undefined);
    const writeOutput = vi.fn();
    const dispatchDue = vi.fn(async (input) => ({
      observedAt: input.observedAt,
      selectedCount: 0,
      saturated: false,
      results: [],
    }));

    await expect(
      runAflTradeExternalCaptureDispatchCommand({
        argv: ['--worker', 'capture-worker-1', '--limit', '25'],
        env: environment(),
        clock: { now: () => '2026-08-10T01:00:00.000Z' },
        createPool: () => ({ end: closePool }),
        createRuntime: () => ({ ingest: vi.fn(), close: closeRuntime }),
        createRepository: () => ({ listDue: vi.fn(), claim: vi.fn(), complete: vi.fn() }),
        createLeaseTokenSha256: () => digest('5'),
        dispatchDue,
        writeOutput,
      })
    ).resolves.toMatchObject({ observedAt: '2026-08-10T01:00:00.000Z', selectedCount: 0 });
    expect(dispatchDue).toHaveBeenCalledWith(
      {
        environment: 'non_production',
        observedAt: '2026-08-10T01:00:00.000Z',
        workerId: 'capture-worker-1',
        maximumOccurrences: 25,
      },
      expect.objectContaining({ createLeaseTokenSha256: expect.any(Function) })
    );
    expect(writeOutput).toHaveBeenCalledWith(
      JSON.stringify({
        observedAt: '2026-08-10T01:00:00.000Z',
        selectedCount: 0,
        saturated: false,
        results: [],
      })
    );
    expect(closeRuntime).toHaveBeenCalledOnce();
    expect(closePool).toHaveBeenCalledOnce();
  });
});
