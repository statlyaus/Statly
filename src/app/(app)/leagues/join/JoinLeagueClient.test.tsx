import type { ReactNode } from 'react';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import JoinLeagueClient, { normalizeInviteCode } from './JoinLeagueClient';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  useAuth: vi.fn(),
  fetchApi: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mocks.push,
  }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock('@/AuthContext', () => ({
  useAuth: mocks.useAuth,
}));

vi.mock('@/lib/api', () => ({
  fetchApi: mocks.fetchApi,
}));

vi.mock('@/components/navigation', () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe('JoinLeagueClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.searchParams = new URLSearchParams();
    mocks.useAuth.mockReturnValue({
      user: {
        uid: 'user-1',
        getIdToken: vi.fn().mockResolvedValue('id-token-1'),
      },
    });
    mocks.fetchApi.mockResolvedValue({ data: { league: { id: 'league-1' } } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders guided join copy, mode links, and invite steps', () => {
    render(<JoinLeagueClient />);

    expect(
      screen.getByRole('heading', { name: 'Join a league with your invite code' })
    ).toBeVisible();
    expect(
      screen.getByText(
        'Enter the commissioner invite code, name your team, and land in the league draft workspace.'
      )
    ).toBeVisible();
    expect(screen.getByText('Manager setup')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Confirm your invite details' })).toBeVisible();
    expect(screen.getAllByText('Invite code')).toHaveLength(2);
    expect(screen.getByText('Team identity')).toBeVisible();
    expect(screen.getByText('Membership check')).toBeVisible();

    expect(screen.getByRole('link', { name: /Join league/ })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('link', { name: 'Create league' })).toHaveAttribute(
      'href',
      '/leagues/new'
    );

    expect(screen.getByText('Enter invite code')).toBeVisible();
    expect(screen.getByText('Name your team')).toBeVisible();
    expect(screen.getByText('Review draft room')).toBeVisible();
    expect(screen.getByRole('form', { name: 'Join league form' })).toBeVisible();
  });

  it('normalizes the URL code and submits uppercase code, team name, content type, and bearer token', async () => {
    const user = userEvent.setup();
    mocks.searchParams = new URLSearchParams('code=ab12-cd34-extra');

    render(<JoinLeagueClient />);

    expect(screen.getByLabelText(/League Code/)).toHaveValue('AB12CD34');

    await user.type(screen.getByLabelText(/Team Name/), 'Gippsland Giants');
    await user.click(screen.getByRole('button', { name: 'Join league' }));

    await waitFor(() => {
      expect(mocks.fetchApi).toHaveBeenCalledWith('leagues/join', {
        method: 'POST',
        body: JSON.stringify({
          code: 'AB12CD34',
          teamName: 'Gippsland Giants',
        }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer id-token-1',
        },
      });
    });
  });

  it('normalizes pasted invite code input', async () => {
    const user = userEvent.setup();

    render(<JoinLeagueClient />);

    await user.type(screen.getByLabelText(/League Code/), 'ab12-cd34!!');

    expect(screen.getByLabelText(/League Code/)).toHaveValue('AB12CD34');
    expect(normalizeInviteCode(' ab12-cd34!!extra ')).toBe('AB12CD34');
  });

  it('shows the shell-based logged-out state with a login link that preserves the invite code', () => {
    mocks.useAuth.mockReturnValue({ user: null });
    mocks.searchParams = new URLSearchParams('code=ab12-cd34');

    render(<JoinLeagueClient />);

    expect(screen.getByRole('heading', { name: 'Sign in to join a league' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Log in before entering your code' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Log in to continue' })).toHaveAttribute(
      'href',
      '/login?next=%2Fleagues%2Fjoin%3Fcode%3DAB12CD34'
    );
  });

  it('shows the success state after joining and redirects to the draft room after 2000ms', async () => {
    vi.useFakeTimers();
    mocks.searchParams = new URLSearchParams('code=ab12cd34');

    render(<JoinLeagueClient />);

    fireEvent.click(screen.getByRole('button', { name: 'Join league' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getAllByText('Successfully joined league')).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(mocks.push).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(mocks.push).toHaveBeenCalledWith('/leagues/league-1?tab=draft');
  });

  it('shows an alert when a signed-in manager submits an empty invite code', async () => {
    render(<JoinLeagueClient />);

    fireEvent.submit(screen.getByRole('form', { name: 'Join league form' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Please enter a league code');
    expect(mocks.fetchApi).not.toHaveBeenCalled();
  });
});
