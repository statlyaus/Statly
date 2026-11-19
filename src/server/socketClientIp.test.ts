import { describe, expect, it } from 'vitest';

import { socketClientIp } from './socketClientIp';

const request = (headers: Record<string, string>, remoteAddress = '10.0.0.9') =>
  ({ headers, socket: { remoteAddress } }) as never;

describe('Socket.IO handshake client IP', () => {
  it('ignores the client-written left of X-Forwarded-For and takes the trusted proxy entry', () => {
    expect(
      socketClientIp(request({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }), {
        RATE_LIMIT_TRUSTED_PROXY_COUNT: '1',
      })
    ).toBe('203.0.113.7');
  });

  it('falls back to the socket address when no trusted header is present', () => {
    expect(socketClientIp(request({}), {})).toBe('10.0.0.9');
  });

  it('is "unknown" with neither', () => {
    expect(socketClientIp(request({}, ''), {})).toBe('unknown');
  });
});
