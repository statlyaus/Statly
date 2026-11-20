import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveCanonicalPlayerId: vi.fn(),
  getPoolPlayer: vi.fn(),
  collection: vi.fn(() => {
    throw new Error('player detail must not read Firestore');
  }),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: { collection: mocks.collection } }));
vi.mock('@/server/players/playerIdentityService', () => ({
  resolveCanonicalPlayerId: mocks.resolveCanonicalPlayerId,
}));
vi.mock('@/server/players/playerPoolReadModel', () => ({ getPoolPlayer: mocks.getPoolPlayer }));

import { getPlayerDetail } from '@/server/players/getPlayerDetail';

const walsh = { id: 'cuid-walsh', name: 'Sam Walsh', team: 'Carlton', stats: { goals: 3 } };

describe('getPlayerDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCanonicalPlayerId.mockResolvedValue(null);
    mocks.getPoolPlayer.mockResolvedValue(null);
  });

  it('reads the canonical Prisma player with their stored season totals', async () => {
    mocks.resolveCanonicalPlayerId.mockResolvedValue('cuid-walsh');
    mocks.getPoolPlayer.mockResolvedValue(walsh);

    await expect(getPlayerDetail('legacy-walsh')).resolves.toBe(walsh);
    expect(mocks.getPoolPlayer).toHaveBeenCalledWith('cuid-walsh');
    expect(mocks.collection).not.toHaveBeenCalled();
  });

  it('never guesses a player from a name in the link', async () => {
    await expect(getPlayerDetail('Sam_Walsh')).resolves.toBeNull();
    await expect(getPlayerDetail('sam-walsh-carlton')).resolves.toBeNull();
    expect(mocks.getPoolPlayer).not.toHaveBeenCalled();
    expect(mocks.collection).not.toHaveBeenCalled();
  });
});
