import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as { uid: string; email: string; displayName: null } | null,
}));

vi.mock('@/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user, logout: vi.fn(), loading: false }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/leagues/league-1/roster',
}));

vi.mock('@/components/PlayerSearch', () => ({ default: () => null }));
vi.mock('@/components/navigation/LeagueSwitcher', () => ({ default: () => null }));

import MainNavigation from '@/components/navigation/MainNavigation';

const signedInUser = { uid: 'user-1', email: 'manager@example.com', displayName: null };

describe('MainNavigation accessibility', () => {
  beforeEach(() => {
    mocks.user = signedInUser;
  });

  it('exposes the account menu as a disclosure, not an ARIA menu without arrow keys', async () => {
    const user = userEvent.setup();
    render(<MainNavigation />);

    const accountButton = screen.getByRole('button', { name: /manager@example\.com/ });
    expect(accountButton).not.toHaveAttribute('aria-haspopup');
    expect(accountButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(accountButton);

    expect(accountButton).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(accountButton.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Help' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  // Player search and the league switcher only sit in the bar from 2xl (1536px); below that the
  // menu toggle must stay available so laptop widths can still reach them.
  it('keeps the menu toggle for signed-in managers until the bar shows search and leagues', () => {
    render(<MainNavigation />);

    const toggle = screen.getByRole('button', { name: 'Open navigation' });
    expect(toggle.className).toContain('2xl:hidden');
    expect(toggle.className).not.toContain('lg:hidden');
  });

  it('hides the menu toggle from lg for visitors, whose bar already has every link', () => {
    mocks.user = null;
    render(<MainNavigation />);

    expect(screen.getByRole('button', { name: 'Open navigation' }).className).toContain(
      'lg:hidden'
    );
  });
});
