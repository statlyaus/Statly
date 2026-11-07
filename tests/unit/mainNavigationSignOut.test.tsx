import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
}));

vi.mock('@/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'user-1', email: 'manager@example.com', displayName: null },
    logout: mocks.logout,
    loading: false,
  }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/leagues/league-1/roster',
}));

vi.mock('@/components/PlayerSearch', () => ({ default: () => null }));
vi.mock('@/components/navigation/LeagueSwitcher', () => ({ default: () => null }));

import MainNavigation from '@/components/navigation/MainNavigation';

async function signOutFromAccountMenu() {
  const user = userEvent.setup();
  render(<MainNavigation />);
  await user.click(screen.getAllByRole('button', { name: /manager@example\.com/ })[0]);
  await user.click(screen.getByText('Sign out'));
}

describe('MainNavigation sign out', () => {
  const assign = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('location', { ...window.location, assign });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('leaves the protected page with a full load of the sign-in page', async () => {
    mocks.logout.mockResolvedValue(undefined);

    await signOutFromAccountMenu();

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'));
  });

  it('stays on the page and reports the failure when sign out fails', async () => {
    mocks.logout.mockRejectedValue(new Error('Network unavailable'));

    await signOutFromAccountMenu();

    expect(await screen.findByText('Sign out failed')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });
});
