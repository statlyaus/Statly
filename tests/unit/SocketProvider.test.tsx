import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SocketProvider } from '../../src/providers/SocketProvider';

const { io } = vi.hoisted(() => ({
  io: vi.fn(() => ({ on: vi.fn(), off: vi.fn(), disconnect: vi.fn() })),
}));
vi.mock('socket.io-client', () => ({ io }));

describe('SocketProvider', () => {
  it('creates socket with auth', () => {
    render(
      <SocketProvider uid="abc">
        <div />
      </SocketProvider>
    );
    expect(io).toHaveBeenCalledWith('/', expect.objectContaining({ auth: { uid: 'abc' } }));
  });
});
