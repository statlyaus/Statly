import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

import { useAuth } from '@/AuthContext';

import MainSidebar from './MainSidebar';

vi.mock('@/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

const mockUser = {
  uid: 'user-1',
  email: 'coach@example.com',
  displayName: 'Test Coach',
  photoURL: null,
};

describe('MainSidebar accessibility', () => {
  const logout = vi.fn();

  beforeEach(() => {
    logout.mockResolvedValue(undefined);
    vi.mocked(useAuth).mockReturnValue({
      user: mockUser,
      loading: false,
      logout,
      login: vi.fn(),
      signup: vi.fn(),
      loginWithGoogle: vi.fn(),
      loginWithFacebook: vi.fn(),
      loginWithApple: vi.fn(),
      resetPassword: vi.fn(),
      updateUserProfile: vi.fn(),
    } as any);
  });

  it('exposes named controls for mobile menu, close, and sign out', async () => {
    render(<MainSidebar />);

    expect(
      screen
        .getAllByRole('link', { name: /dashboard/i })
        .every((link) => link.getAttribute('aria-current') === 'page')
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }));

    const mobileNavigation = screen.getByRole('dialog', { name: /mobile navigation/i });

    expect(
      within(mobileNavigation).getByRole('button', { name: /close navigation menu/i })
    ).toBeInTheDocument();

    fireEvent.click(within(mobileNavigation).getByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  });
});
