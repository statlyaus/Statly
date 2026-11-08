import { beforeEach, describe, expect, it, vi } from 'vitest';

const readFile = vi.hoisted(() => vi.fn());

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const promises = { ...actual.promises, readFile };
  return { ...actual, default: { ...actual, promises }, promises };
});

// Footywire's `Status` column is the side of the ground (Home or Away), not an injury.
const footywireRow = (status: string, round: string, date: string) => ({
  Date: date,
  Season: 2025,
  Round: round,
  Player: 'Nick Blakey',
  Team: 'Sydney',
  Opposition: 'Hawthorn',
  Status: status,
  G: 1,
  T: 2,
});

describe('player data from Footywire match rows', () => {
  beforeEach(() => {
    vi.resetModules();
    readFile.mockResolvedValue(
      JSON.stringify([
        footywireRow('Home', 'Round 0', '2025-03-07'),
        footywireRow('Away', 'Round 1', '2025-03-14'),
      ])
    );
  });

  it('does not report Home or Away status as an injury', async () => {
    const { getPlayers } = await import('@/lib/data');

    const [player] = await getPlayers();

    expect(player.name).toBe('Nick Blakey');
    expect(player.injury).toBeUndefined();
  });
});
