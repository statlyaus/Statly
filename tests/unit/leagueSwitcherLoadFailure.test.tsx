import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LeagueSwitcher from '@/components/navigation/LeagueSwitcher';

const signedInUser = vi.hoisted(() => ({ uid: 'user-1' }));

vi.mock('@/AuthContext', () => ({
  useAuth: () => ({ user: signedInUser }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/leagues/league-2',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const leaguesResponse = {
  ok: true,
  json: async () => ({
    data: {
      leagues: [
        { id: 'league-1', name: 'Alpha League' },
        { id: 'league-2', name: 'Bravo League' },
      ],
    },
  }),
} as Response;

async function openSwitcher(name: RegExp) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name }));
  return user;
}

describe('LeagueSwitcher', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('says the leagues could not load when the request fails, and retries on request', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal error' }),
      } as Response)
      .mockResolvedValueOnce(leaguesResponse);

    render(<LeagueSwitcher />);
    const user = await openSwitcher(/Select a league/);

    expect(await screen.findByText('Could not load your leagues.')).toBeInTheDocument();
    expect(screen.queryByText('No leagues found')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: /Alpha League/ })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('marks the current league without claiming listbox options', async () => {
    vi.mocked(fetch).mockResolvedValue(leaguesResponse);

    render(<LeagueSwitcher />);
    await openSwitcher(/Bravo League/);

    const panel = within(screen.getByRole('dialog', { name: 'Select league' }));
    expect(panel.getByRole('button', { name: 'Bravo League' })).toHaveAttribute(
      'aria-current',
      'true'
    );
    expect(panel.getByRole('button', { name: 'Alpha League' })).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('option')).toBeNull();
  });
});
