import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as { getIdToken: () => Promise<string> } | null },
  onAuthStateChanged: vi.fn(),
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
  signInWithEmailAndPassword: vi.fn(),
}));

vi.mock('@/lib/firebaseClient', () => ({
  auth: mocks.auth,
  authEmulatorReady: Promise.resolve(),
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

function AuthProbe() {
  const { user } = useAuth();
  return <div>{user?.uid ?? 'signed-out'}</div>;
}

describe('AuthProvider server session restoration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.currentUser = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('waits for the server session cookie before exposing a restored Firebase user', async () => {
    let authListener: ((user: unknown) => void) | undefined;
    let resolveSession!: (response: Response) => void;
    const sessionRequest = new Promise<Response>((resolve) => {
      resolveSession = resolve;
    });
    const fetchMock = vi.fn(() => sessionRequest);
    vi.stubGlobal('fetch', fetchMock);
    mocks.onAuthStateChanged.mockImplementation((_auth, listener) => {
      authListener = listener;
      return vi.fn();
    });
    const firebaseUser = {
      uid: 'firebase-user-1',
      email: 'user@example.com',
      displayName: 'Test User',
      photoURL: null,
      emailVerified: true,
      metadata: {},
      getIdToken: vi.fn().mockResolvedValue('fresh-id-token'),
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
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: 'fresh-id-token' }),
      })
    );

    resolveSession(new Response(null, { status: 200 }));

    expect(await screen.findByText('firebase-user-1')).toBeInTheDocument();
  });
});
