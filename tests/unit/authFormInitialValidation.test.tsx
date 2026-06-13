import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AuthForm from '@/components/AuthForm';
import { useAuth } from '@/AuthContext';

vi.mock('@/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock('@/hooks/useNotification', () => ({
  useNotification: () => ({
    notification: null,
    showNotification: vi.fn(),
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
    vi.mocked(useAuth).mockReturnValue(mockAuthContext);
  });

  it('does not show required-field errors before the user interacts with the form', () => {
    render(<AuthForm initialMode="login" showModeSwitch={false} />);

    expect(screen.queryByText('Email is required')).not.toBeInTheDocument();
    expect(screen.queryByText('Password is required')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeEnabled();
  });
});
