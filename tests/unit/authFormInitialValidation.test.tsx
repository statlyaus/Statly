import { render, screen, waitFor } from '@testing-library/react';
import type { User } from 'firebase/auth';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AuthForm from '@/components/AuthForm';
import { useAuth } from '@/AuthContext';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  showNotification: vi.fn(),
}));

vi.mock('@/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: mocks.replace,
  }),
}));

vi.mock('@/hooks/useNotification', () => ({
  useNotification: () => ({
    notification: null,
    showNotification: mocks.showNotification,
  }),
  NotificationToast: () => null,
}));

const mockAuthContext = {
  user: null,
  loading: false,
  login: vi.fn(),
  signup: vi.fn(),
  logout: vi.fn(),
  loginWithGoogle: vi.fn(),
  loginWithFacebook: vi.fn(),
  loginWithApple: vi.fn(),
};

describe('AuthForm initial validation state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue(mockAuthContext);
  });

  it('does not show required-field errors before the user interacts with the form', () => {
    render(<AuthForm initialMode="login" showModeSwitch={false} />);

    expect(screen.queryByText('Email is required')).not.toBeInTheDocument();
    expect(screen.queryByText('Password is required')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeEnabled();
  });

  it('does not redirect a second time when auth state updates after a successful login', async () => {
    const user = userEvent.setup();
    const mockLogin = vi.fn().mockResolvedValue(undefined);
    let authState = {
      ...mockAuthContext,
      login: mockLogin,
      user: null as User | null,
    };

    vi.mocked(useAuth).mockImplementation(() => authState as ReturnType<typeof useAuth>);
    const { rerender } = render(
      <AuthForm initialMode="login" nextUrl="/dashboard" autoRedirectIfAuthenticated />
    );

    await user.type(screen.getByLabelText('Email Address'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith('/dashboard');
    });

    authState = { ...authState, user: { uid: 'test-user-id' } as User };
    rerender(<AuthForm initialMode="login" nextUrl="/dashboard" autoRedirectIfAuthenticated />);

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('Welcome back!')).not.toBeInTheDocument();
  });

  it('keeps the user on the login form when the server auth handoff fails', async () => {
    const user = userEvent.setup();
    const error = new Error('Unable to establish a secure session (503).');
    vi.mocked(useAuth).mockReturnValue({
      ...mockAuthContext,
      login: vi.fn().mockRejectedValue(error),
    });

    render(<AuthForm initialMode="login" nextUrl="/dashboard" showModeSwitch={false} />);

    await user.type(screen.getByLabelText('Email Address'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByText(error.message)).toBeInTheDocument();
    expect(mocks.showNotification).toHaveBeenCalledWith('error', error.message);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('does not render the authenticated profile card while redirecting an existing session', async () => {
    vi.mocked(useAuth).mockReturnValue({
      ...mockAuthContext,
      user: { uid: 'test-user-id' } as User,
    } as ReturnType<typeof useAuth>);

    render(<AuthForm initialMode="login" nextUrl="/dashboard" autoRedirectIfAuthenticated />);

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith('/dashboard');
    });
    expect(screen.queryByText('Welcome back!')).not.toBeInTheDocument();
  });
});
