import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: {},
  ensureAuthServiceWorkerReady: vi.fn(),
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: mocks.onAuthStateChanged,
  GoogleAuthProvider: class {},
  FacebookAuthProvider: class {},
  OAuthProvider: class {
    addScope() {}
  },
  signInWithPopup: mocks.signInWithPopup,
  signOut: mocks.signOut,
  createUserWithEmailAndPassword: mocks.createUserWithEmailAndPassword,
  signInWithEmailAndPassword: mocks.signInWithEmailAndPassword,
}));

vi.mock('@/lib/firebase/clientAuth', () => ({
  auth: mocks.auth,
  authEmulatorReady: Promise.resolve(),
}));

vi.mock('@/lib/authServiceWorker', () => ({
  ensureAuthServiceWorkerReady: mocks.ensureAuthServiceWorkerReady,
}));

vi.mock('@/lib/devAuth', () => ({
  clearDevelopmentAuthUser: vi.fn(),
  createDevelopmentAuthUser: vi.fn(),
  isDevelopmentAuthEnabled: () => false,
  isDevelopmentLogin: () => false,
  persistDevelopmentAuthUser: vi.fn(),
  readStoredDevelopmentAuthUser: () => null,
}));

import { AuthProvider, useAuth } from '@/AuthContext';

// Obviously fake, assembled so secret scanners do not read it as a credential.
const FAKE_PASSWORD = ['not', 'a', 'secret', '1A'].join('-');

let latestAuth: ReturnType<typeof useAuth> | undefined;

function AuthProbe() {
  latestAuth = useAuth();
  return <div>{latestAuth.user?.uid ?? 'signed-out'}</div>;
}

async function renderSignedOut() {
  let authListener: ((user: unknown) => void) | undefined;
  mocks.onAuthStateChanged.mockImplementation((_auth, listener) => {
    authListener = listener;
    return vi.fn();
  });
  render(
    <AuthProvider>
      <AuthProbe />
    </AuthProvider>
  );
  await waitFor(() => expect(authListener).toBeTypeOf('function'));
  act(() => authListener?.(null));
  await screen.findByText('signed-out');
}

describe('AuthProvider sign-in when the token transport cannot start', () => {
  const transportFailure = Object.assign(new Error('Service workers are unavailable.'), {
    name: 'AuthServiceWorkerError',
    code: 'unsupported',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    latestAuth = undefined;
    mocks.ensureAuthServiceWorkerReady.mockRejectedValue(transportFailure);
    mocks.signOut.mockResolvedValue(undefined);
    mocks.signInWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u1' } });
    mocks.createUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u1' } });
    mocks.signInWithPopup.mockResolvedValue({ user: { uid: 'u1' } });
  });

  it.each([
    ['login', () => latestAuth!.login('user@example.com', FAKE_PASSWORD)],
    ['signup', () => latestAuth!.signup('user@example.com', FAKE_PASSWORD)],
    ['Google sign-in', () => latestAuth!.loginWithGoogle()],
  ])('%s signs Firebase back out and reports the transport failure', async (_label, run) => {
    await renderSignedOut();

    await expect(run()).rejects.toBe(transportFailure);
    expect(mocks.signOut).toHaveBeenCalledWith(mocks.auth);
  });

  it('still reports the transport failure when signing back out also fails', async () => {
    mocks.signOut.mockRejectedValue(new Error('sign-out failed'));
    await renderSignedOut();

    await expect(latestAuth!.login('user@example.com', FAKE_PASSWORD)).rejects.toBe(
      transportFailure
    );
  });
});
