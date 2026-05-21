import { describe, expect, it, vi } from 'vitest';

const readModelMocks = vi.hoisted(() => ({
  publishLeagueRosterSummaries: vi.fn().mockResolvedValue({}),
  publishPlayerRankings: vi.fn().mockResolvedValue({}),
  refreshPlayerReadModels: vi.fn().mockResolvedValue({}),
}));

vi.mock('../src/lib/loadEnv', () => ({}));

vi.mock('../src/server/readModels/playerReadModels', () => readModelMocks);

import { assertSafeFirebaseTarget, parseArgs } from '../Scripts/build-player-read-models';

describe('build-player-read-models safety guard', () => {
  it('does not execute read-model publication when imported by tests', () => {
    expect(readModelMocks.refreshPlayerReadModels).not.toHaveBeenCalled();
    expect(readModelMocks.publishPlayerRankings).not.toHaveBeenCalled();
    expect(readModelMocks.publishLeagueRosterSummaries).not.toHaveBeenCalled();
  });

  it('parses explicit live Firebase opt-in', () => {
    expect(parseArgs(['--allow-live-firebase'])).toMatchObject({
      allowLiveFirebase: true,
    });
  });

  it('rejects local runs without a Firestore emulator unless live Firebase is explicitly allowed', () => {
    const args = parseArgs(['--mode', 'rankings', '--season', '2026']);

    expect(() =>
      assertSafeFirebaseTarget(args, {
        STATLY_RUNTIME_ENV: 'local',
        FIRESTORE_EMULATOR_HOST: '',
      })
    ).toThrow(/Refusing to build player read models against live Firebase from local runtime/);
  });

  it('allows local runs when the Firestore emulator is configured', () => {
    const args = parseArgs(['--mode', 'rankings', '--season', '2026']);

    expect(() =>
      assertSafeFirebaseTarget(args, {
        STATLY_RUNTIME_ENV: 'local',
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8082',
      })
    ).not.toThrow();
  });

  it('allows local live Firebase runs only with the explicit override flag', () => {
    const args = parseArgs(['--mode', 'rankings', '--season', '2026', '--allow-live-firebase']);

    expect(() =>
      assertSafeFirebaseTarget(args, {
        STATLY_RUNTIME_ENV: 'local',
      })
    ).not.toThrow();
  });
});
