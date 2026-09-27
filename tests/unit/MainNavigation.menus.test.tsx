import type { ReactNode } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'user-1', email: 'manager@example.com', displayName: 'Manager' },
    logout: vi.fn(),
    loading: false,
  }),
}));

vi.mock('@/components/PlayerSearch', () => ({
  default: () => <input aria-label="Search players" />,
}));

vi.mock('@/components/navigation/LeagueSwitcher', () => ({
  default: () => <div>League switcher</div>,
}));

import MainNavigation from '@/components/navigation/MainNavigation';

describe('MainNavigation menus', () => {
  it('exposes the Tools disclosure state and closes it on Escape', () => {
    render(<MainNavigation />);

    const tools = screen.getByRole('button', { name: /tools/i });
    expect(tools).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(tools);
    expect(tools).toHaveAttribute('aria-expanded', 'true');
    const menu = document.getElementById(tools.getAttribute('aria-controls') ?? '') as HTMLElement;
    expect(menu).toHaveAttribute('aria-label', 'Tools');
    expect(within(menu).queryByText('Live Scoring')).not.toBeInTheDocument();
    expect(within(menu).queryByText('Commissioner')).not.toBeInTheDocument();
    expect(within(menu).queryByText('Help')).not.toBeInTheDocument();
    expect(within(menu).getByText('AFL Matches')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(tools).toHaveAttribute('aria-expanded', 'false');
    expect(tools).toHaveFocus();
  });

  it('keeps Commissioner and Help in the account menu', () => {
    render(<MainNavigation />);

    fireEvent.click(screen.getByRole('button', { name: /manager/i, expanded: false }));
    const accountMenu = document.getElementById('account-menu');
    expect(accountMenu).not.toBeNull();
    expect(within(accountMenu as HTMLElement).getByText('Commissioner')).toBeInTheDocument();
    expect(within(accountMenu as HTMLElement).getByText('Help')).toBeInTheDocument();
  });

  it('offers search and the league switcher at laptop widths, not only at 2xl', () => {
    render(<MainNavigation />);

    const laptopToggle = screen.getByRole('button', { name: 'Search players and switch league' });
    expect(laptopToggle.className).toContain('lg:inline-flex');
    expect(laptopToggle.className).toContain('2xl:hidden');

    fireEvent.click(laptopToggle);
    const panel = document.getElementById('mobile-main-navigation');
    expect(panel).not.toBeNull();
    expect(panel?.className).toContain('2xl:hidden');
    expect(panel?.className).not.toMatch(/(^|\s)lg:hidden/);
  });
});
