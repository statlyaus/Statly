import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/AuthContext';
import AuthForm from '@/components/AuthForm';

vi.mock('@/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const firebaseError = (code: string) =>
  Object.assign(new Error(`Firebase: Error (${code}).`), { code });

function renderWith(overrides: Record<string, unknown>) {
  vi.mocked(useAuth).mockReturnValue({
    user: null,
    loading: false,
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    loginWithGoogle: vi.fn(),
    loginWithFacebook: vi.fn(),
    loginWithApple: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useAuth>);
  return render(<AuthForm initialMode="login" />);
}

async function submit(email = 'manager@example.com', password = 'wrong-password') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email Address'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign In' }));
  return user;
}

describe('AuthForm failed sign-in', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['auth/invalid-credential', 'Email or password is incorrect.'],
    ['auth/wrong-password', 'Email or password is incorrect.'],
    ['auth/user-not-found', 'Email or password is incorrect.'],
    ['auth/too-many-requests', 'Too many attempts. Try again later or reset your password.'],
    ['auth/network-request-failed', 'Network error. Check your connection and try again.'],
    ['auth/internal-error', 'Sign-in failed. Please try again.'],
  ])('shows one plain alert for %s, never the raw Firebase text', async (code, message) => {
    renderWith({ login: vi.fn().mockRejectedValue(firebaseError(code)) });
    await submit();

    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1));
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('alert')).not.toHaveTextContent('Firebase');
  });

  it('moves focus to the error so keyboard and screen-reader users land on it', async () => {
    renderWith({ login: vi.fn().mockRejectedValue(firebaseError('auth/invalid-credential')) });
    await submit();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  });

  it('does not mark accepted fields as successful after a failed sign-in', async () => {
    const { container } = renderWith({
      login: vi.fn().mockRejectedValue(firebaseError('auth/invalid-credential')),
    });
    await submit();
    await screen.findByRole('alert');

    expect(container.querySelector('form')?.innerHTML).not.toMatch(/result-win/);
  });

  it('flags invalid fields for assistive technology', async () => {
    renderWith({});
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(screen.getByLabelText('Email Address')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows nothing when the user closes the provider pop-up', async () => {
    renderWith({
      loginWithGoogle: vi.fn().mockRejectedValue(firebaseError('auth/popup-closed-by-user')),
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled()
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('explains a blocked provider pop-up', async () => {
    renderWith({
      loginWithGoogle: vi.fn().mockRejectedValue(firebaseError('auth/popup-blocked')),
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your browser blocked the sign-in window. Allow pop-ups and try again.'
    );
  });
});
