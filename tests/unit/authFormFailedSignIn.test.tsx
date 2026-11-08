import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/AuthContext';
import AuthForm from '@/components/AuthForm';

vi.mock('@/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

// Obviously fake, assembled so secret scanners do not read it as a credential.
const FAKE_PASSWORD = ['not', 'a', 'secret', '1A'].join('-');

const firebaseError = (code: string) =>
  Object.assign(new Error(`Firebase: Error (${code}).`), { code });

function renderWith(overrides: Record<string, unknown>, initialMode: 'login' | 'signup' = 'login') {
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
  return render(<AuthForm initialMode={initialMode} />);
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

  it.each([
    ['unsupported', "This browser can't keep you signed in to Statly."],
    ['insecure-context', "This browser can't keep you signed in to Statly."],
    ['registration-timeout', "Statly couldn't finish signing you in on this browser."],
  ])(
    'explains a sign-in token transport that cannot start (%s) instead of saying retry',
    async (code, message) => {
      const failure = Object.assign(new Error('raw worker detail'), {
        name: 'AuthServiceWorkerError',
        code,
      });
      renderWith({ login: vi.fn().mockRejectedValue(failure) });
      await submit();

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(message);
      expect(alert).not.toHaveTextContent('Sign-in failed');
      expect(alert).not.toHaveTextContent('raw worker detail');
    }
  );

  it.each([
    ['auth/weak-password', 'That password is too weak. Choose a longer one.'],
    ['auth/operation-not-allowed', 'This sign-in method is not available. Try another one.'],
    ['auth/internal-error', 'Could not create your account. Please try again.'],
  ])('creating an account explains %s', async (code, message) => {
    renderWith({ signup: vi.fn().mockRejectedValue(firebaseError(code)) }, 'signup');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email Address'), 'new@example.com');
    await user.type(screen.getByLabelText('Password'), FAKE_PASSWORD);
    await user.type(screen.getByLabelText('Confirm Password'), FAKE_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('explains an email already tied to another sign-in provider', async () => {
    renderWith({
      loginWithGoogle: vi
        .fn()
        .mockRejectedValue(firebaseError('auth/account-exists-with-different-credential')),
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account already exists for this email with a different sign-in method. Use that method instead.'
    );
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
