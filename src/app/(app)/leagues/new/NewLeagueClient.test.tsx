import type { ReactNode } from 'react';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NewLeagueClient from './NewLeagueClient';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  fetchApi: vi.fn(),
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

describe('NewLeagueClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAuth.mockReturnValue({ user: { uid: 'user-1' } });
    mocks.fetchApi.mockResolvedValue({
      data: { id: 'league-1', name: 'Friday Night Captains', code: 'AB12CD34' },
    });
  });

  it('renders guided setup copy, mode links, and create steps', () => {
    render(<NewLeagueClient />);

    expect(
      screen.getByRole('heading', { name: 'Create a league built for draft night' })
    ).toBeVisible();
    expect(
      screen.getByText(
        'Name the competition, choose the manager count, confirm scoring, then move straight into draft setup.'
      )
    ).toBeVisible();
    expect(screen.getByText('Commissioner setup')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Confirm the league basics' })).toBeVisible();
    expect(screen.getByText('Competition identity')).toBeVisible();
    expect(screen.getByText('Manager capacity')).toBeVisible();
    expect(screen.getByText('Commissioner next step')).toBeVisible();

    expect(screen.getByRole('link', { name: /Create league/ })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('link', { name: 'Join league' })).toHaveAttribute(
      'href',
      '/leagues/join'
    );

    expect(screen.getByText('Choose your league basics')).toBeVisible();
    expect(screen.getByText('Invite managers')).toBeVisible();
    expect(screen.getByText('Open draft setup')).toBeVisible();
    expect(screen.getByRole('form', { name: 'Create league form' })).toBeVisible();
  });

  it('submits selected values and renders the commissioner setup checklist', async () => {
    const user = userEvent.setup();

    render(<NewLeagueClient />);

    await user.type(screen.getByLabelText(/League Name/), 'Friday Night Captains');
    await user.selectOptions(screen.getByLabelText('Number of Teams'), '14');
    await user.selectOptions(screen.getByLabelText('Scoring Format'), 'nine-category');
    await user.click(screen.getByRole('button', { name: /Create league/ }));

    await waitFor(() => {
      expect(mocks.fetchApi).toHaveBeenCalledWith('leagues', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Friday Night Captains',
          teamCount: 14,
          scoringFormat: 'nine-category',
          commissionerId: 'user-1',
        }),
      });
    });
    expect(
      screen.getByRole('heading', { name: 'Friday Night Captains is ready for setup' })
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open draft setup' })).toHaveAttribute(
      'href',
      '/leagues/league-1?tab=draft'
    );
    expect(screen.getByText('Invite code')).toBeVisible();
    expect(screen.getByText('AB12CD34')).toBeVisible();

    expect(screen.getByRole('button', { name: 'Copy invite link' })).toBeVisible();
  });

  it('shows a logged-out submit alert and does not call the API', async () => {
    const user = userEvent.setup();
    mocks.useAuth.mockReturnValue({ user: null });

    render(<NewLeagueClient />);

    await user.type(screen.getByLabelText(/League Name/), 'Friday Night Captains');
    await user.click(screen.getByRole('button', { name: /Create league/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You must be logged in to create a league.'
    );
    expect(mocks.fetchApi).not.toHaveBeenCalled();
  });
});
