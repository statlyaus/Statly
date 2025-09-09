import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { SocketProvider, useSocket } from '../../src/providers/SocketProvider';
import * as Sentry from '@sentry/react';

const { socket, io } = vi.hoisted(() => {
  const socket = {
    on: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
    close: vi.fn(),
    connect: vi.fn(),
    connected: true,
  };
  return { socket, io: vi.fn(() => socket) };
});
vi.mock('socket.io-client', () => ({ io }));
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

describe('SocketProvider', () => {
  it('creates socket with auth and provides it via context', async () => {
    let received: any = null;
    const Child = () => {
      received = useSocket();
      return null;
    };
    const { unmount } = render(
      <SocketProvider uid="abc">
        <Child />
      </SocketProvider>
    );
    expect(io).toHaveBeenCalledWith('/', expect.objectContaining({ auth: { uid: 'abc' } }));

    await waitFor(() => expect(received).toBe(socket));

    unmount();
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('reports socket errors via Sentry', () => {
    render(
      <SocketProvider uid="abc">
        <div />
      </SocketProvider>
    );

    const handler = socket.on.mock.calls.find((c) => c[0] === 'connect_error')?.[1];
    handler?.(new Error('boom'));
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error));
  });
});
