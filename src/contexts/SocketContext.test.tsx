import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  io: vi.fn(),
  currentUser: {
    getIdToken: vi.fn(),
  },
}));

vi.mock('socket.io-client', () => ({
  io: mocks.io,
}));

vi.mock('@/lib/firebaseClient', () => ({
  auth: {
    get currentUser() {
      return mocks.currentUser;
    },
  },
}));

vi.mock('@/lib/socketioConfig', () => ({
  socketIOConfig: {
    client: {
      transports: ['websocket'],
      timeout: 1000,
      reconnection: true,
      reconnectionAttempts: 2,
      reconnectionDelay: 100,
      reconnectionDelayMax: 1000,
    },
  },
}));

import { SocketProvider } from './SocketContext';

describe('SocketProvider', () => {
  function createSocketMock() {
    return {
      on: vi.fn(),
      removeAllListeners: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser.getIdToken.mockResolvedValue('firebase-id-token');
    mocks.io.mockReturnValue(createSocketMock());
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            socket: {
              url: 'http://localhost:4001',
              path: '/socket.io',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
  });

  it('passes a browser-safe Firebase token through the Socket.IO auth payload', async () => {
    render(
      <SocketProvider>
        <div>child</div>
      </SocketProvider>
    );

    await waitFor(() => {
      expect(mocks.io).toHaveBeenCalled();
    });

    const [, options] = mocks.io.mock.calls[0];
    expect(options.auth).toBeDefined();
    await expect(
      new Promise((resolve) => {
        options.auth(resolve);
      })
    ).resolves.toEqual({ token: 'firebase-id-token' });
    expect(mocks.currentUser.getIdToken).toHaveBeenCalled();
  });

  it('uses the configured browser reconnect policy when opening the socket', async () => {
    render(
      <SocketProvider>
        <div>child</div>
      </SocketProvider>
    );

    await waitFor(() => {
      expect(mocks.io).toHaveBeenCalled();
    });

    const [url, options] = mocks.io.mock.calls[0];
    expect(url).toBe('http://localhost:4001');
    expect(options).toMatchObject({
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 2,
      reconnectionDelay: 100,
      reconnectionDelayMax: 1000,
      withCredentials: false,
    });
  });

  it('removes socket listeners and disconnects on unmount', async () => {
    const socket = createSocketMock();
    mocks.io.mockReturnValue(socket);

    const { unmount } = render(
      <SocketProvider>
        <div>child</div>
      </SocketProvider>
    );

    await waitFor(() => {
      expect(mocks.io).toHaveBeenCalled();
    });

    unmount();

    expect(socket.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not create a socket if target discovery resolves after unmount', async () => {
    let resolveFetch: (response: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          })
      )
    );

    const { unmount } = render(
      <SocketProvider>
        <div>child</div>
      </SocketProvider>
    );

    unmount();
    resolveFetch(
      new Response(
        JSON.stringify({
          socket: {
            url: 'http://localhost:4001',
            path: '/socket.io',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await waitFor(() => {
      expect(mocks.io).not.toHaveBeenCalled();
    });
  });
});
