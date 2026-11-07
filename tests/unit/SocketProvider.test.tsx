import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SocketProvider } from '../../src/providers/SocketProvider';

type Handler = (...args: unknown[]) => void;
type SocketAuth = (cb: (data: { token: string | null }) => void) => void;

const {
  authMock,
  captureException,
  getIdToken,
  handlers,
  io,
  isDevelopmentAuthEnabled,
  socketMock,
} = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  const socket = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
    }),
    off: vi.fn(),
    close: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
    active: true,
  };

  return {
    authMock: {
      currentUser: null as null | { getIdToken: (forceRefresh?: boolean) => Promise<string> },
    },
    captureException: vi.fn(),
    getIdToken: vi.fn(),
    handlers,
    io: vi.fn(() => socket),
    isDevelopmentAuthEnabled: vi.fn(() => false),
    socketMock: socket,
  };
});

vi.mock('socket.io-client', () => ({ io }));
vi.mock('@/lib/firebase/clientAuth', () => ({ auth: authMock }));
vi.mock('@/lib/devAuth', () => ({ isDevelopmentAuthEnabled }));
vi.mock('@/lib/sentry-utils', () => ({ captureException }));

function handshakeAuth(): SocketAuth {
  const options = (io.mock.calls.at(-1) as unknown as [string, { auth: SocketAuth }])[1];
  return options.auth;
}

function handshakeToken(): Promise<string | null> {
  return new Promise((resolve) => {
    handshakeAuth()((data) => resolve(data.token));
  });
}

function emit(event: string, ...args: unknown[]): void {
  handlers.get(event)?.(...args);
}

async function renderConnectedProvider(): Promise<void> {
  authMock.currentUser = { getIdToken };
  render(
    <SocketProvider uid="abc">
      <div />
    </SocketProvider>
  );
  await waitFor(() => expect(io).toHaveBeenCalled());
}

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

describe('SocketProvider', () => {
  const originalSocketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
  const originalSocketDisabled = process.env.NEXT_PUBLIC_SOCKET_DISABLED;

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
    handlers.clear();
    socketMock.active = true;
    authMock.currentUser = null;
    isDevelopmentAuthEnabled.mockReturnValue(false);
    process.env.NEXT_PUBLIC_SOCKET_URL = originalSocketUrl;
    process.env.NEXT_PUBLIC_SOCKET_DISABLED = originalSocketDisabled;
  });

  it('creates socket with a Firebase auth token at the configured socket URL', async () => {
    process.env.NEXT_PUBLIC_SOCKET_URL = 'http://localhost:4001';
    const firebaseToken = ['firebase', 'token'].join('-');
    getIdToken.mockResolvedValue(firebaseToken);
    authMock.currentUser = { getIdToken };

    render(
      <SocketProvider uid="abc">
        <div />
      </SocketProvider>
    );

    await waitFor(() =>
      expect(io).toHaveBeenCalledWith(
        'http://localhost:4001',
        expect.objectContaining({
          auth: expect.any(Function),
          transports: ['websocket', 'polling'],
        })
      )
    );
    await expect(handshakeToken()).resolves.toBe(firebaseToken);
  });

  it('defaults to the dedicated local socket server URL', async () => {
    delete process.env.NEXT_PUBLIC_SOCKET_URL;
    isDevelopmentAuthEnabled.mockReturnValue(true);

    render(
      <SocketProvider uid="dev-user">
        <div />
      </SocketProvider>
    );

    await waitFor(() =>
      expect(io).toHaveBeenCalledWith('http://localhost:3002', expect.anything())
    );
    await expect(handshakeToken()).resolves.toBe('dev:dev-user');
  });

  it('waits for Firebase auth restoration before creating the socket', async () => {
    delete process.env.NEXT_PUBLIC_SOCKET_URL;
    getIdToken.mockResolvedValue('restored-token');
    authMock.currentUser = null;

    render(
      <SocketProvider uid="restored-user">
        <div />
      </SocketProvider>
    );

    expect(io).not.toHaveBeenCalled();

    window.setTimeout(() => {
      authMock.currentUser = { getIdToken };
    }, 10);

    await waitFor(() =>
      expect(io).toHaveBeenCalledWith('http://localhost:3002', expect.anything())
    );
    await expect(handshakeToken()).resolves.toBe('restored-token');
  });

  it('skips socket creation when the runtime disables realtime transport', () => {
    process.env.NEXT_PUBLIC_SOCKET_DISABLED = 'true';

    render(
      <SocketProvider uid="dev-user">
        <div>content</div>
      </SocketProvider>
    );

    expect(io).not.toHaveBeenCalled();
  });

  it('keeps the socket handshake contract aligned with server token auth', () => {
    const providerSource = read('src/providers/SocketProvider.tsx');

    expect(providerSource).toContain('cb({ token');
    expect(providerSource).not.toContain('auth: { uid');
    expect(providerSource).toContain("transports: ['websocket', 'polling']");
  });

  it('disconnects sockets created after async token resolution during cleanup', async () => {
    getIdToken.mockResolvedValue(['firebase', 'token'].join('-'));
    authMock.currentUser = { getIdToken };

    const rendered = render(
      <SocketProvider uid="abc">
        <div />
      </SocketProvider>
    );

    await waitFor(() => expect(io).toHaveBeenCalled());
    rendered.unmount();

    expect(socketMock.disconnect).toHaveBeenCalled();
  });

  it('sends a freshly fetched Firebase token on every reconnect, not the first one', async () => {
    getIdToken.mockResolvedValueOnce('token-at-start').mockResolvedValue('token-an-hour-later');
    await renderConnectedProvider();

    await expect(handshakeToken()).resolves.toBe('token-an-hour-later');
    await expect(handshakeToken()).resolves.toBe('token-an-hour-later');
    expect(getIdToken).toHaveBeenCalledTimes(3);
  });

  it('forces a token refresh and reconnects once when the server rejects authentication', async () => {
    getIdToken.mockResolvedValue('token');
    await renderConnectedProvider();

    socketMock.active = false;
    emit('connect_error', new Error('Authentication required'));

    expect(socketMock.connect).toHaveBeenCalledTimes(1);
    await expect(handshakeToken()).resolves.toBe('token');
    expect(getIdToken).toHaveBeenLastCalledWith(true);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('reports an authentication rejection that persists after a token refresh, once', async () => {
    getIdToken.mockResolvedValue('token');
    await renderConnectedProvider();

    socketMock.active = false;
    emit('connect_error', new Error('Authentication required'));
    emit('connect_error', new Error('Authentication required'));
    emit('connect_error', new Error('Authentication required'));

    expect(socketMock.connect).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('does not report routine disconnects or a passing connection error', async () => {
    getIdToken.mockResolvedValue('token');
    await renderConnectedProvider();

    emit('disconnect', 'io client disconnect');
    emit('disconnect', 'transport close');
    emit('connect_error', new Error('xhr poll error'));

    expect(captureException).not.toHaveBeenCalled();
  });

  it('reports a connection that keeps failing once, and again only after it recovered', async () => {
    getIdToken.mockResolvedValue('token');
    await renderConnectedProvider();

    for (let attempt = 0; attempt < 8; attempt += 1) {
      emit('connect_error', new Error('xhr poll error'));
    }
    expect(captureException).toHaveBeenCalledTimes(1);

    emit('connect');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      emit('connect_error', new Error('xhr poll error'));
    }
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
