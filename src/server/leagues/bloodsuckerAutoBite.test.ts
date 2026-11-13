import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

const { pickAutoBitePair } = await import('./bloodsuckerAutoBite');

describe('pickAutoBitePair (BR-28)', () => {
  it("takes the victim's highest Statly Z and returns the Bloodsucker's lowest", () => {
    const scores = new Map([
      ['v-a', 1.5],
      ['v-b', 3.2],
      ['b-a', -0.4],
      ['b-b', 2.1],
    ]);

    const pick = pickAutoBitePair({
      victimPlayerIds: ['v-a', 'v-b'],
      bloodsuckerPlayerIds: ['b-b', 'b-a'],
      scoreByPlayerId: scores,
    });

    expect(pick).toMatchObject({ takenPlayerId: 'v-b', returnedPlayerId: 'b-a' });
  });

  it('breaks ties to the lower player id on both sides', () => {
    const scores = new Map([
      ['v-2', 5],
      ['v-1', 5],
      ['b-9', 0],
      ['b-3', 0],
    ]);

    const pick = pickAutoBitePair({
      victimPlayerIds: ['v-2', 'v-1'],
      bloodsuckerPlayerIds: ['b-9', 'b-3'],
      scoreByPlayerId: scores,
    });

    expect(pick).toMatchObject({ takenPlayerId: 'v-1', returnedPlayerId: 'b-3' });
  });

  it('ranks a player without stats below every scored player', () => {
    const scores = new Map([
      ['v-scored', -2],
      ['b-scored', -5],
    ]);

    const pick = pickAutoBitePair({
      victimPlayerIds: ['v-none', 'v-scored'],
      bloodsuckerPlayerIds: ['b-scored', 'b-none'],
      scoreByPlayerId: scores,
    });

    expect(pick).toMatchObject({ takenPlayerId: 'v-scored', returnedPlayerId: 'b-none' });
  });

  it('records the ranked candidates so the pick can be replayed from the snapshot', () => {
    const scores = new Map([
      ['v-a', 1],
      ['b-a', 2],
    ]);

    const pick = pickAutoBitePair({
      victimPlayerIds: ['v-a', 'v-b'],
      bloodsuckerPlayerIds: ['b-a'],
      scoreByPlayerId: scores,
    });

    expect(pick?.victim).toEqual([
      { playerId: 'v-a', z: 1 },
      { playerId: 'v-b', z: null },
    ]);
    expect(pick?.bloodsucker).toEqual([{ playerId: 'b-a', z: 2 }]);
    // Replaying the rule on the snapshot alone gives the same pair.
    const replay = pickAutoBitePair({
      victimPlayerIds: pick!.victim.map((row) => row.playerId),
      bloodsuckerPlayerIds: pick!.bloodsucker.map((row) => row.playerId),
      scoreByPlayerId: new Map(
        [...pick!.victim, ...pick!.bloodsucker].flatMap((row) =>
          row.z === null ? [] : [[row.playerId, row.z] as const]
        )
      ),
    });
    expect(replay).toMatchObject({ takenPlayerId: 'v-a', returnedPlayerId: 'b-a' });
  });

  it('has no pair when either roster is empty', () => {
    expect(
      pickAutoBitePair({
        victimPlayerIds: [],
        bloodsuckerPlayerIds: ['b-a'],
        scoreByPlayerId: new Map(),
      })
    ).toBeNull();
  });
});
