// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DevFixtureRunResult } from './types';

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  reset: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $disconnect: vi.fn(),
  },
}));

vi.mock('../scenarios', () => ({
  getDevFixtureScenario: () => ({
    apply: mocks.apply,
    reset: mocks.reset,
    verify: mocks.verify,
  }),
}));

import { runDevFixturesForCli } from './runner';

function buildRunResult(overrides: Partial<DevFixtureRunResult>): DevFixtureRunResult {
  return {
    command: 'verify',
    scenarioId: 'full-leagues',
    ownerUserId: 'statly-dev-tester',
    ok: true,
    steps: [],
    leagues: [],
    issues: [],
    ...overrides,
  };
}

describe('runDevFixturesForCli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns non-zero exit code for failed verify results while preserving JSON output', async () => {
    mocks.verify.mockResolvedValue(
      buildRunResult({
        ok: false,
        issues: ['Fixture league: Expected 12 draft order slots, found 3.'],
      })
    );

    const result = await runDevFixturesForCli({
      command: 'verify',
      scenarioId: 'full-leagues',
      outputFormat: 'json',
      fixtureOwned: false,
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.output)).toMatchObject({
      ok: false,
      issues: ['Fixture league: Expected 12 draft order slots, found 3.'],
    });
  });

  it('preserves reset exit behavior when the scenario reports issues', async () => {
    mocks.reset.mockResolvedValue(
      buildRunResult({
        command: 'reset',
        ok: false,
        issues: ['reset issue'],
      })
    );

    const result = await runDevFixturesForCli({
      command: 'reset',
      scenarioId: 'full-leagues',
      outputFormat: 'json',
      fixtureOwned: true,
    });

    expect(result.exitCode).toBe(0);
    expect(mocks.reset).toHaveBeenCalledWith({ fixtureOwned: true });
  });
});
