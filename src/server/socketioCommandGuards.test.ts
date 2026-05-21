import { describe, expect, it, vi } from 'vitest';

import { rejectSocketMutationCommand, socketMutationContext } from './socketioCommandGuards';

describe('rejectSocketMutationCommand', () => {
  it('logs, counts, and emits a draft error for direct socket mutations', () => {
    const socket = {
      id: 'socket-1',
      emit: vi.fn(),
    };
    const logger = {
      warn: vi.fn(),
    };
    const incCounter = vi.fn();

    rejectSocketMutationCommand({
      socket,
      logger,
      incCounter,
      metricName: 'socketio_timer_rejections_total',
      logMessage: 'Rejected socket-driven draft timer start to avoid split-brain state',
      error: 'Direct socket timer starts are disabled. Use the Prisma-backed draft API.',
      context: {
        draftId: 'draft-1',
        duration: 120,
      },
    });

    expect(incCounter).toHaveBeenCalledWith('socketio_timer_rejections_total');
    expect(logger.warn).toHaveBeenCalledWith(
      'Rejected socket-driven draft timer start to avoid split-brain state',
      {
        socketId: 'socket-1',
        draftId: 'draft-1',
        duration: 120,
      }
    );
    expect(socket.emit).toHaveBeenCalledWith('draft:error', {
      error: 'Direct socket timer starts are disabled. Use the Prisma-backed draft API.',
    });
  });
});

describe('socketMutationContext', () => {
  it('extracts only the requested payload fields', () => {
    expect(
      socketMutationContext(
        {
          draftId: 'draft-1',
          duration: 120,
          ignored: 'value',
        },
        ['draftId', 'duration']
      )
    ).toEqual({
      draftId: 'draft-1',
      duration: 120,
    });
  });

  it('marks malformed payloads without throwing', () => {
    expect(socketMutationContext(undefined, ['draftId'])).toEqual({
      invalidPayload: true,
      payloadType: 'undefined',
    });
    expect(socketMutationContext(null, ['draftId'])).toEqual({
      invalidPayload: true,
      payloadType: 'null',
    });
    expect(socketMutationContext(['draft-1'], ['draftId'])).toEqual({
      invalidPayload: true,
      payloadType: 'object',
    });
  });
});
