import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthenticatedUserIdFromServerContext: vi.fn(),
  canUseBasketball: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserIdFromServerContext: mocks.getAuthenticatedUserIdFromServerContext,
}));
vi.mock('@/server/basketball/basketballAccess', () => ({
  canUseBasketball: mocks.canUseBasketball,
}));

import BasketballLayout from './layout';

describe('basketball layout access gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUserIdFromServerContext.mockResolvedValue('user-1');
  });

  it('renders the section for a caller on the allow-list', async () => {
    mocks.canUseBasketball.mockReturnValue(true);

    await expect(BasketballLayout({ children: 'section' })).resolves.toBe('section');
    expect(mocks.canUseBasketball).toHaveBeenCalledWith('user-1');
  });

  it('answers not found for anyone else', async () => {
    mocks.canUseBasketball.mockReturnValue(false);

    await expect(BasketballLayout({ children: 'section' })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
