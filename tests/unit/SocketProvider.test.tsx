import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SocketProvider } from '../../src/providers/SocketProvider';

const { authMock, getIdToken, io, isDevelopmentAuthEnabled, socketMock } = vi.hoisted(() => {
  const socket = {
    on: vi.fn(),
    off: vi.fn(),
    close: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
  };

  return {
    authMock: {
      currentUser: null as null | { getIdToken: () => Promise<string> },
    },
    getIdToken: vi.fn(),
    io: vi.fn(() => socket),
    isDevelopmentAuthEnabled: vi.fn(() => false),
    socketMock: socket,
  };
});

vi.mock('socket.io-client', () => ({ io }));
vi.mock('@/lib/firebase/clientAuth', () => ({ auth: authMock }));
vi.mock('@/lib/devAuth', () => ({ isDevelopmentAuthEnabled }));

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
          auth: { token: firebaseToken },
          transports: ['websocket', 'polling'],
        })
      )
    );
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
      expect(io).toHaveBeenCalledWith(
        'http://localhost:3002',
        expect.objectContaining({
          auth: { token: 'dev:dev-user' },
        })
      )
    );
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
      expect(io).toHaveBeenCalledWith(
        'http://localhost:3002',
        expect.objectContaining({
          auth: { token: 'restored-token' },
        })
      )
    );
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

    expect(providerSource).toContain('auth: { token');
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
});
