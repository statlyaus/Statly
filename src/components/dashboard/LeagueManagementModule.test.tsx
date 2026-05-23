import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';

import LeagueManagementModule from './LeagueManagementModule';

const fetchMock = vi.fn();
const user = { uid: 'user-1' } as User;

describe('LeagueManagementModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows create and join actions when the manager has no leagues', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ leagues: [] }),
    });

    render(<LeagueManagementModule user={user} />);

    expect(
      await screen.findByRole('heading', { name: 'Start your league workspace' })
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Create league' })).toHaveAttribute(
      'href',
      '/leagues/new'
    );
    expect(screen.getByRole('link', { name: 'Join league' })).toHaveAttribute(
      'href',
      '/leagues/join'
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/leagues/user/user-1');
  });

  it('keeps retry and onboarding actions available when league loading fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ leagues: [] }),
    });

    render(<LeagueManagementModule user={user} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load leagues');
    expect(screen.getByRole('link', { name: 'Create league' })).toHaveAttribute(
      'href',
      '/leagues/new'
    );
    expect(screen.getByRole('link', { name: 'Join league' })).toHaveAttribute(
      'href',
      '/leagues/join'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(
      await screen.findByRole('heading', { name: 'Start your league workspace' })
    ).toBeVisible();
  });
});
