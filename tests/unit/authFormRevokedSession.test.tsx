import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/AuthContext';
import AuthForm from '@/components/AuthForm';

const replace = vi.fn();
vi.mock('@/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace }) }));

const firebaseError = (code: string) =>
  Object.assign(new Error(`Firebase: Error (${code}).`), { code });

const signedInUser = {
  uid: 'user-1',
  email: 'manager@example.com',
  displayName: 'Manager',
  photoURL: null,
  emailVerified: true,
  metadata: {},
};

function renderLogin(overrides: Record<string, unknown>, nextUrl = '/leagues/abc') {
  const auth = {
    user: signedInUser,
    loading: false,
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    loginWithGoogle: vi.fn(),
    loginWithFacebook: vi.fn(),
    loginWithApple: vi.fn(),
    refreshIdToken: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  vi.mocked(useAuth).mockReturnValue(auth as unknown as ReturnType<typeof useAuth>);
  render(<AuthForm initialMode="login" nextUrl={nextUrl} autoRedirectIfAuthenticated />);
  return auth;
}

describe('AuthForm on /login with a signed-in browser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('refreshes the ID token once, then goes to the destination', async () => {
    const auth = renderLogin({});

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/leagues/abc'));
    expect(auth.refreshIdToken).toHaveBeenCalledTimes(1);
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it.each(['auth/user-token-expired', 'auth/user-disabled', 'auth/user-not-found'])(
    'signs out and shows the sign-in form when the refresh fails with %s',
    async (code) => {
      const auth = renderLogin({ refreshIdToken: vi.fn().mockRejectedValue(firebaseError(code)) });

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Your session ended. Sign in again.'
      );
      expect(auth.logout).toHaveBeenCalledTimes(1);
      expect(replace).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Email Address')).toBeInTheDocument();
    }
  );

  it('keeps the user signed in and offers a retry when the refresh hits a network error', async () => {
    const refreshIdToken = vi
      .fn()
      .mockRejectedValueOnce(firebaseError('auth/network-request-failed'))
      .mockResolvedValueOnce(undefined);
    const auth = renderLogin({ refreshIdToken });

    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't check your session.");
    expect(auth.logout).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/leagues/abc'));
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('signs out instead of bouncing when the server sent it back to /login moments after the last redirect', async () => {
    window.sessionStorage.setItem(
      'statly:login-auto-redirect',
      JSON.stringify({ destination: '/leagues/abc', at: Date.now() })
    );
    const auth = renderLogin({});

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your session ended. Sign in again.'
    );
    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });
});
