import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
}));

const navigationMocks = vi.hoisted(() => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

vi.mock('@/AuthContext', () => ({
  useAuth: authMocks.useAuth,
}));

vi.mock('next/navigation', () => ({
  useRouter: navigationMocks.useRouter,
  useSearchParams: navigationMocks.useSearchParams,
}));

vi.mock('@/components/navigation', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import JoinLeaguePage from '../../src/app/(app)/leagues/join/page';

describe('JoinLeaguePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.useAuth.mockReturnValue({ user: null });
    navigationMocks.useRouter.mockReturnValue({ push: vi.fn(), replace: vi.fn() });
  });

  it('preserves normalized invite code and team name through login', () => {
    navigationMocks.useSearchParams.mockReturnValue(
      new URLSearchParams({ code: 'ab12-cd34', team: 'Robbo Rockets' })
    );

    render(<JoinLeaguePage />);

    const loginHref = screen.getByRole('link', { name: 'Log in' }).getAttribute('href');
    expect(loginHref).toBeTruthy();

    const loginUrl = new URL(loginHref ?? '', 'https://statly.test');
    const next = loginUrl.searchParams.get('next');
    expect(next).toBeTruthy();

    const nextUrl = new URL(next ?? '', 'https://statly.test');
    expect(nextUrl.pathname).toBe('/leagues/join');
    expect(nextUrl.searchParams.get('code')).toBe('AB12CD34');
    expect(nextUrl.searchParams.get('team')).toBe('Robbo Rockets');
  });
});
