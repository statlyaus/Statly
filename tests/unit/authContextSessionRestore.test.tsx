import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as { getIdToken: () => Promise<string> } | null },
  ensureAuthServiceWorkerReady: vi.fn(),
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: mocks.onAuthStateChanged,
  GoogleAuthProvider: class {},
  FacebookAuthProvider: class {},
  OAuthProvider: class {
    addScope() {}
  },
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: mocks.signInWithEmailAndPassword,
}));

vi.mock('@/lib/firebaseClient', () => ({
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

vi.mock('@/components/LoadingSpinner', () => ({
  default: () => <div>Restoring session</div>,
}));

import { AuthProvider, useAuth } from '@/AuthContext';

let latestAuth: ReturnType<typeof useAuth> | undefined;

function AuthProbe() {
  const authContext = useAuth();
  latestAuth = authContext;
  const { user } = authContext;
  return <div>{user?.uid ?? 'signed-out'}</div>;
}

describe('AuthProvider authenticated navigation readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureAuthServiceWorkerReady.mockReset();
    mocks.auth.currentUser = null;
    latestAuth = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('waits for the token transport before exposing a restored Firebase user', async () => {
    let authListener: ((user: unknown) => void) | undefined;
    let resolveTransport!: () => void;
    const transportReady = new Promise<void>((resolve) => {
      resolveTransport = resolve;
    });
    mocks.ensureAuthServiceWorkerReady.mockReturnValue(transportReady);
    mocks.onAuthStateChanged.mockImplementation((_auth, listener) => {
      authListener = listener;
      return vi.fn();
    });
    const userId = 'firebase-user-1';
    const firebaseUser = {
      uid: userId,
      email: 'user@example.com',
      displayName: 'Test User',
      photoURL: null,
      emailVerified: true,
      metadata: {},
      getIdToken: vi.fn(),
    };
    mocks.auth.currentUser = firebaseUser;

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(authListener).toBeTypeOf('function'));
    act(() => authListener?.(firebaseUser));

    expect(screen.getByText('Restoring session')).toBeInTheDocument();
    expect(screen.queryByText('firebase-user-1')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.ensureAuthServiceWorkerReady).toHaveBeenCalledTimes(1));

    resolveTransport();

    expect(await screen.findByText('firebase-user-1')).toBeInTheDocument();
  });

  it('keeps a restored Firebase user signed out when token transport preparation fails', async () => {
    let authListener: ((user: unknown) => void) | undefined;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.ensureAuthServiceWorkerReady.mockRejectedValue(
      new Error('Authentication service worker unavailable')
    );
    mocks.onAuthStateChanged.mockImplementation((_auth, listener) => {
      authListener = listener;
      return vi.fn();
    });
    const firebaseUser = {
      uid: 'firebase-user-2',
      email: 'user@example.com',
      displayName: 'Test User',
      photoURL: null,
      emailVerified: true,
      metadata: {},
      getIdToken: vi.fn(),
    };

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(authListener).toBeTypeOf('function'));
    act(() => authListener?.(firebaseUser));

    expect(await screen.findByText('signed-out')).toBeInTheDocument();
  });

  it('does not resolve interactive login before the shared token transport is ready', async () => {
    let authListener: ((user: unknown) => void) | undefined;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let resolveTransport!: () => void;
    const transportReady = new Promise<void>((resolve) => {
      resolveTransport = resolve;
    });
    mocks.ensureAuthServiceWorkerReady.mockReturnValue(transportReady);
    mocks.onAuthStateChanged.mockImplementation((_auth, listener) => {
      authListener = listener;
      return vi.fn();
    });
    const firebaseUser = {
      uid: 'firebase-user-3',
      email: 'user@example.com',
      displayName: 'Test User',
      photoURL: null,
      emailVerified: true,
      metadata: {},
      getIdToken: vi.fn(),
    };
    mocks.auth.currentUser = firebaseUser;
    mocks.signInWithEmailAndPassword.mockResolvedValue({ user: firebaseUser });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(authListener).toBeTypeOf('function'));
    act(() => authListener?.(null));
    expect(await screen.findByText('signed-out')).toBeInTheDocument();

    act(() => authListener?.(firebaseUser));
    const loginRequest = latestAuth!.login('user@example.com', 'password');
    let loginResolved = false;
    void loginRequest.then(() => {
      loginResolved = true;
    });

    await waitFor(() => expect(mocks.ensureAuthServiceWorkerReady).toHaveBeenCalledTimes(2));
    expect(loginResolved).toBe(false);

    await act(async () => {
      resolveTransport();
      await loginRequest;
    });
    expect(loginResolved).toBe(true);
  });
});
