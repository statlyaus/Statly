import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AuthProvider, useAuth } from './AuthContext';

const mocks = vi.hoisted(() => ({
  lazyAuthProxy: { currentUser: null as null | { getIdToken: () => Promise<string> } },
  resolvedAuth: { currentUser: null as null | { getIdToken: () => Promise<string> } },
  getClientAuth: vi.fn(),
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/authBypass', () => ({
  isAuthBypassEnabled: () => false,
  getBypassUserDetails: () => ({
    uid: 'statly-dev-tester',
    email: 'tester@statly.dev',
    displayName: 'Statly Dev Tester',
  }),
}));

vi.mock('@/lib/firebaseClient', () => ({
  auth: mocks.lazyAuthProxy,
  getClientAuth: mocks.getClientAuth,
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: mocks.onAuthStateChanged,
  signInWithEmailAndPassword: mocks.signInWithEmailAndPassword,
  signOut: mocks.signOut,
  createUserWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  GoogleAuthProvider: vi.fn(),
  FacebookAuthProvider: vi.fn(),
  OAuthProvider: vi.fn(),
}));

function AuthProbe() {
  const { loading, login, logout, user } = useAuth();

  return (
    <div>
      <div data-testid="loading">{loading ? 'loading' : 'ready'}</div>
      <div data-testid="user">{user?.email ?? 'none'}</div>
      <button
        type="button"
        onClick={async () => {
          try {
            await login('tester@statly.dev', 'StatlyTest!123');
          } catch (error) {
            document.body.setAttribute(
              'data-login-error',
              error instanceof Error ? error.message : String(error)
            );
          }
        }}
      >
        Login
      </button>
      <button type="button" onClick={() => void logout()}>
        Logout
      </button>
    </div>
  );
}

describe('AuthProvider server session contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.removeAttribute('data-login-error');
    mocks.lazyAuthProxy.currentUser = null;
    mocks.resolvedAuth.currentUser = null;
    mocks.getClientAuth.mockReturnValue(mocks.resolvedAuth);
    mocks.onAuthStateChanged.mockImplementation((_auth, callback) => {
      callback(null);
      return vi.fn();
    });
    vi.stubGlobal('fetch', vi.fn());
  });

  it('rejects login when the server session cookie cannot be created', async () => {
    const idTokenUser = { getIdToken: vi.fn().mockResolvedValue('id-token') };
    mocks.resolvedAuth.currentUser = idTokenUser;
    mocks.signInWithEmailAndPassword.mockResolvedValue({ user: idTokenUser });
    vi.mocked(fetch).mockResolvedValue(
      new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(document.body.getAttribute('data-login-error')).toEqual(
        expect.stringContaining('Failed to create server session')
      );
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/session',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('sets the client user after login creates the server session', async () => {
    const idTokenUser = {
      email: 'tester@statly.dev',
      getIdToken: vi.fn().mockResolvedValue('id-token'),
    };
    mocks.resolvedAuth.currentUser = idTokenUser;
    mocks.signInWithEmailAndPassword.mockResolvedValue({ user: idTokenUser });
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect(await screen.findByTestId('user')).toHaveTextContent('tester@statly.dev');
  });

  it('refreshes the server session when Firebase auth state is restored', async () => {
    const idTokenUser = {
      email: 'tester@statly.dev',
      getIdToken: vi.fn().mockResolvedValue('restored-id-token'),
    };
    mocks.resolvedAuth.currentUser = idTokenUser;
    mocks.onAuthStateChanged.mockImplementation((_auth, callback) => {
      callback(idTokenUser);
      return vi.fn();
    });
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    expect(await screen.findByTestId('user')).toHaveTextContent('tester@statly.dev');
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/auth/session',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ idToken: 'restored-id-token' }),
        })
      );
    });
  });

  it('keeps restored Firebase auth loading until the server session is refreshed', async () => {
    const idTokenUser = {
      email: 'tester@statly.dev',
      getIdToken: vi.fn().mockResolvedValue('restored-id-token'),
    };
    let resolveSessionRefresh: (response: Response) => void = () => {};
    mocks.resolvedAuth.currentUser = idTokenUser;
    mocks.onAuthStateChanged.mockImplementation((_auth, callback) => {
      callback(idTokenUser);
      return vi.fn();
    });
    vi.mocked(fetch).mockReturnValue(
      new Promise((resolve) => {
        resolveSessionRefresh = resolve;
      })
    );

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    expect(screen.getByTestId('loading')).toHaveTextContent('loading');
    expect(screen.getByTestId('user')).toHaveTextContent('none');

    resolveSessionRefresh(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    expect(await screen.findByTestId('loading')).toHaveTextContent('ready');
    expect(screen.getByTestId('user')).toHaveTextContent('tester@statly.dev');
  });

  it('clears the client user after logout clears the server session', async () => {
    const idTokenUser = {
      email: 'tester@statly.dev',
      getIdToken: vi.fn().mockResolvedValue('restored-id-token'),
    };
    mocks.resolvedAuth.currentUser = idTokenUser;
    mocks.onAuthStateChanged.mockImplementation((_auth, callback) => {
      callback(idTokenUser);
      return vi.fn();
    });
    mocks.signOut.mockResolvedValue(undefined);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    expect(await screen.findByTestId('user')).toHaveTextContent('tester@statly.dev');

    await userEvent.click(screen.getByRole('button', { name: 'Logout' }));

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('none');
    });
    expect(fetch).toHaveBeenCalledWith('/api/auth/session', { method: 'DELETE' });
    expect(mocks.signOut).toHaveBeenCalledWith(mocks.resolvedAuth);
  });

  it('uses the resolved Firebase Auth instance instead of the lazy export proxy', async () => {
    const idTokenUser = {
      email: 'tester@statly.dev',
      getIdToken: vi.fn().mockResolvedValue('id-token'),
    };
    mocks.resolvedAuth.currentUser = idTokenUser;
    mocks.signInWithEmailAndPassword.mockResolvedValue({ user: idTokenUser });
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Login' }));
    await userEvent.click(screen.getByRole('button', { name: 'Logout' }));

    expect(mocks.getClientAuth).toHaveBeenCalled();
    expect(mocks.onAuthStateChanged).toHaveBeenCalledWith(
      mocks.resolvedAuth,
      expect.any(Function),
      expect.any(Function)
    );
    expect(mocks.signInWithEmailAndPassword).toHaveBeenCalledWith(
      mocks.resolvedAuth,
      'tester@statly.dev',
      'StatlyTest!123'
    );
    expect(mocks.signOut).toHaveBeenCalledWith(mocks.resolvedAuth);
    expect(mocks.signInWithEmailAndPassword).not.toHaveBeenCalledWith(
      mocks.lazyAuthProxy,
      expect.anything(),
      expect.anything()
    );
  });
});
