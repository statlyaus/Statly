import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement } from 'react';

const mocks = vi.hoisted(() => ({
  getPlayerDetail: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/server/players/getPlayerDetail', () => ({ getPlayerDetail: mocks.getPlayerDetail }));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('@/components/PlayerDetail', () => ({ PlayerDetail: () => null }));

import PlayerPage from '@/app/(app)/players/[id]/page';
import { PlayerDetail } from '@/components/PlayerDetail';

describe('player page', () => {
  beforeEach(() => {
    mocks.getPlayerDetail.mockReset();
    mocks.notFound.mockClear();
  });

  it('loads the player on the server and renders the detail view', async () => {
    const player = { id: 'nick-daicos', name: 'Nick Daicos', team: 'Collingwood' };
    mocks.getPlayerDetail.mockResolvedValue(player);

    const element = await PlayerPage({ params: Promise.resolve({ id: 'nick-daicos' }) });

    expect(mocks.getPlayerDetail).toHaveBeenCalledWith('nick-daicos');
    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe(PlayerDetail);
    expect(element.props).toEqual({ player });
  });

  it('returns the 404 page when no player matches', async () => {
    mocks.getPlayerDetail.mockResolvedValue(null);

    await expect(PlayerPage({ params: Promise.resolve({ id: 'nobody' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND'
    );
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
