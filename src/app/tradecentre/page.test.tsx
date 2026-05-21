import { render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthenticatedUserIdFromServerContext: vi.fn(),
  leagueMemberFindFirst: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserIdFromServerContext: mocks.getAuthenticatedUserIdFromServerContext,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueMember: {
      findFirst: mocks.leagueMemberFindFirst,
    },
  },
}));

vi.mock('@/components/navigation', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import TradeCentrePage from './page';

describe('TradeCentrePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    });
  });

  it('redirects authenticated users to their league trade workspace', async () => {
    mocks.getAuthenticatedUserIdFromServerContext.mockResolvedValue('user-1');
    mocks.leagueMemberFindFirst.mockResolvedValue({ leagueId: 'league-1' });

    await expect(TradeCentrePage()).rejects.toThrow('NEXT_REDIRECT:/leagues/league-1/trades');

    expect(mocks.leagueMemberFindFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { joinedAt: 'asc' },
      select: { leagueId: true },
    });
    expect(mocks.redirect).toHaveBeenCalledWith('/leagues/league-1/trades');
  });

  it('redirects unauthenticated users to login without querying league membership', async () => {
    mocks.getAuthenticatedUserIdFromServerContext.mockResolvedValue(null);

    await expect(TradeCentrePage()).rejects.toThrow('NEXT_REDIRECT:/login?next=/tradecentre');

    expect(mocks.redirect).toHaveBeenCalledWith('/login?next=/tradecentre');
    expect(mocks.leagueMemberFindFirst).not.toHaveBeenCalled();
  });

  it('renders league setup actions when an authenticated user has no league', async () => {
    mocks.getAuthenticatedUserIdFromServerContext.mockResolvedValue('user-1');
    mocks.leagueMemberFindFirst.mockResolvedValue(null);

    render(await TradeCentrePage());

    expect(screen.getByRole('heading', { name: 'Join or create a league to trade' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Join league' })).toHaveAttribute(
      'href',
      '/leagues/join'
    );
    expect(screen.getByRole('link', { name: 'Create league' })).toHaveAttribute(
      'href',
      '/leagues/new'
    );
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
