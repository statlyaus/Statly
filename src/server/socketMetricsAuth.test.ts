import { describe, expect, it } from 'vitest';

import { socketMetricsAccess } from './socketMetricsAuth';

describe('Socket.IO /metrics access', () => {
  const env = { NODE_ENV: 'production', METRICS_BEARER_TOKEN: 'secret-token' };

  it('allows the configured bearer token', () => {
    expect(socketMetricsAccess('Bearer secret-token', env)).toBe('allowed');
  });

  it('refuses a missing or wrong token', () => {
    expect(socketMetricsAccess(undefined, env)).toBe('unauthorized');
    expect(socketMetricsAccess('Bearer nope', env)).toBe('unauthorized');
  });

  it('is unavailable in production when no token is configured', () => {
    expect(socketMetricsAccess('Bearer anything', { NODE_ENV: 'production' })).toBe('unconfigured');
  });

  it('stays open outside production when no token is configured', () => {
    expect(socketMetricsAccess(undefined, { NODE_ENV: 'development' })).toBe('allowed');
  });
});
