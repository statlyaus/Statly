import { describe, expect, it, vi } from 'vitest';

import {
  authorizeSocketHandshake,
  createSocketAuthMiddleware,
  getSocketBearerToken,
} from './socketioAuth';

describe('getSocketBearerToken', () => {
  it('reads bearer tokens from headers first', () => {
    expect(
      getSocketBearerToken({
        authorization: 'Bearer header-token',
        handshakeAuth: { token: 'auth-token' },
      })
    ).toBe('header-token');
  });

  it('reads browser-safe Socket.IO auth payload tokens', () => {
    expect(getSocketBearerToken({ handshakeAuth: { token: 'auth-token' } })).toBe('auth-token');
    expect(getSocketBearerToken({ handshakeAuth: { authToken: 'legacy-token' } })).toBe(
      'legacy-token'
    );
  });

  it('ignores missing and malformed token sources', () => {
    expect(getSocketBearerToken({ authorization: 'Token nope' })).toBeNull();
    expect(getSocketBearerToken({ authorization: 'Bearer   ' })).toBeNull();
    expect(getSocketBearerToken({ handshakeAuth: { token: '' } })).toBeNull();
    expect(getSocketBearerToken({ handshakeAuth: 'not-an-object' })).toBeNull();
  });
});

describe('authorizeSocketHandshake', () => {
  it('allows local development handshakes without a token', async () => {
    const validateAuthToken = vi.fn();

    await expect(
      authorizeSocketHandshake({
        environment: 'development',
        validateAuthToken,
      })
    ).resolves.toEqual({ ok: true, outcome: 'dev-noauth' });
    expect(validateAuthToken).not.toHaveBeenCalled();
  });

  it('rejects production handshakes without a token', async () => {
    const validateAuthToken = vi.fn();

    await expect(
      authorizeSocketHandshake({
        environment: 'production',
        validateAuthToken,
      })
    ).resolves.toEqual({
      ok: false,
      error: 'Authentication required',
      outcome: 'noauth',
    });
  });

  it('accepts valid browser auth payload tokens in production', async () => {
    const validateAuthToken = vi.fn().mockResolvedValue('user-1');

    await expect(
      authorizeSocketHandshake({
        environment: 'production',
        handshakeAuth: { token: 'socket-token' },
        validateAuthToken,
      })
    ).resolves.toEqual({ ok: true, outcome: 'ok', userId: 'user-1' });
    expect(validateAuthToken).toHaveBeenCalledWith('socket-token');
  });

  it('rejects invalid production tokens', async () => {
    const validateAuthToken = vi.fn().mockResolvedValue(null);

    await expect(
      authorizeSocketHandshake({
        environment: 'production',
        authorization: 'Bearer bad-token',
        validateAuthToken,
      })
    ).resolves.toEqual({
      ok: false,
      error: 'Authentication required',
      outcome: 'invauth',
    });
  });
});

describe('createSocketAuthMiddleware', () => {
  function socket(handshake: { authorization?: string; auth?: unknown }) {
    return {
      handshake: {
        headers: {
          authorization: handshake.authorization,
        },
        auth: handshake.auth,
      },
      data: {},
    };
  }

  it('rejects invalid production tokens through the server middleware boundary', async () => {
    const next = vi.fn();
    const onAuthFailure = vi.fn();
    const onObserved = vi.fn();
    const middleware = createSocketAuthMiddleware({
      environment: 'production',
      validateAuthToken: vi.fn().mockResolvedValue(null),
      onAuthFailure,
      onObserved,
    });

    await middleware(socket({ authorization: 'Bearer bad-token' }), next);

    expect(next).toHaveBeenCalledWith(new Error('Authentication required'));
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(onObserved).toHaveBeenCalledWith('invauth', expect.any(Number));
  });

  it('accepts valid browser auth payload tokens and stores the authenticated user id', async () => {
    const next = vi.fn();
    const socketRef = socket({ auth: { token: 'socket-token' } });
    const middleware = createSocketAuthMiddleware({
      environment: 'production',
      validateAuthToken: vi.fn().mockResolvedValue('user-1'),
    });

    await middleware(socketRef, next);

    expect(socketRef.data).toEqual({ authenticatedUserId: 'user-1' });
    expect(next).toHaveBeenCalledWith();
  });
});
