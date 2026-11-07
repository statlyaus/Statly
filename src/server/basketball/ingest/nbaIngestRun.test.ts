// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeIngestPrisma, fakeProvider } from './__fixtures__/fakes';
import { assertNbaProviderAllowed, recordNbaIngestRun } from './nbaIngestRun';
import { NbaIngestRejected } from './nbaStatsProvider';

const NOW = new Date('2026-11-08T10:00:00Z');
const unlicensed = fakeProvider({ id: 'espn', commercialUseLicensed: false });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('assertNbaProviderAllowed', () => {
  it('refuses an unlicensed provider in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NBA_STATS_ALLOW_UNLICENSED_PROVIDER', '');

    expect(() => assertNbaProviderAllowed(unlicensed)).toThrow(
      expect.objectContaining({ reason: 'unlicensed_provider' })
    );
  });

  it('allows it in production only when the owner set the flag to exactly "true"', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NBA_STATS_ALLOW_UNLICENSED_PROVIDER', 'yes');
    expect(() => assertNbaProviderAllowed(unlicensed)).toThrow(NbaIngestRejected);

    vi.stubEnv('NBA_STATS_ALLOW_UNLICENSED_PROVIDER', 'true');
    expect(() => assertNbaProviderAllowed(unlicensed)).not.toThrow();
  });

  it('allows an unlicensed provider outside production and a licensed one anywhere', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(() => assertNbaProviderAllowed(unlicensed)).not.toThrow();

    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertNbaProviderAllowed(fakeProvider())).not.toThrow();
  });
});

describe('recordNbaIngestRun', () => {
  it('records a started run and finishes it with the summary', async () => {
    const { prisma, runs } = fakeIngestPrisma();

    const result = await recordNbaIngestRun(
      'INJURIES',
      { prisma, provider: fakeProvider(), now: NOW },
      async () => ({ rows: 3 })
    );

    expect(result).toEqual({ runId: 'run-1', summary: { rows: 3 } });
    expect(runs).toEqual([
      expect.objectContaining({
        job: 'INJURIES',
        provider: 'fake',
        startedAt: NOW,
        outcome: 'SUCCEEDED',
        reason: null,
        summaryJson: { rows: 3 },
        finishedAt: expect.any(Date),
      }),
    ]);
  });

  it('finishes a rejected run with its reason and rethrows', async () => {
    const { prisma, runs } = fakeIngestPrisma();

    await expect(
      recordNbaIngestRun('SCHEDULE', { prisma, provider: fakeProvider(), now: NOW }, async () => {
        throw new NbaIngestRejected('out_of_bounds', '12 games');
      })
    ).rejects.toMatchObject({ reason: 'out_of_bounds' });

    expect(runs).toEqual([
      expect.objectContaining({
        outcome: 'REJECTED',
        reason: 'out_of_bounds',
        summaryJson: { message: '12 games' },
      }),
    ]);
  });

  it('refuses an unlicensed provider in production before doing any work', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NBA_STATS_ALLOW_UNLICENSED_PROVIDER', '');
    const { prisma, runs } = fakeIngestPrisma();
    const work = vi.fn();

    await expect(
      recordNbaIngestRun('PLAYERS', { prisma, provider: unlicensed, now: NOW }, work)
    ).rejects.toMatchObject({ reason: 'unlicensed_provider' });

    expect(work).not.toHaveBeenCalled();
    expect(runs).toEqual([
      expect.objectContaining({
        provider: 'espn',
        outcome: 'REJECTED',
        reason: 'unlicensed_provider',
      }),
    ]);
  });

  it('finishes a run that throws anything else as FAILED', async () => {
    const { prisma, runs } = fakeIngestPrisma();

    await expect(
      recordNbaIngestRun('BOX_SCORES', { prisma, provider: fakeProvider(), now: NOW }, async () => {
        throw new Error('database down');
      })
    ).rejects.toThrow('database down');

    expect(runs[0]).toMatchObject({ outcome: 'FAILED', reason: 'database down' });
  });
});
