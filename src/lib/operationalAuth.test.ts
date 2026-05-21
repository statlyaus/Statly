import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  authorizeAdminRequest,
  authorizeCronRequest,
  authorizeLocalOnlyRequest,
} from './operationalAuth';

function request(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers });
}

describe('operational authorization', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('STATLY_RUNTIME_ENV', 'preview');
    vi.stubEnv('ADMIN_API_TOKEN', '');
    vi.stubEnv('CRON_SECRET', '');
  });

  it('rejects admin requests without an admin token in shared environments', () => {
    const result = authorizeAdminRequest(request('http://localhost/api/admin/workers'));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it('accepts admin bearer tokens when they match ADMIN_API_TOKEN', () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'admin-secret');

    const result = authorizeAdminRequest(
      request('http://localhost/api/admin/workers', {
        authorization: 'Bearer admin-secret',
      })
    );

    expect(result.ok).toBe(true);
  });

  it('accepts x-admin-token when it matches ADMIN_API_TOKEN', () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'admin-secret');

    const result = authorizeAdminRequest(
      request('http://localhost/api/admin/queue', {
        'x-admin-token': 'admin-secret',
      })
    );

    expect(result.ok).toBe(true);
  });

  it('does not accept CRON_SECRET for admin requests', () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');

    const result = authorizeAdminRequest(
      request('http://localhost/api/admin/queue', {
        'x-admin-token': 'cron-secret',
      })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it('allows missing admin tokens only for explicit local runtime', () => {
    vi.stubEnv('STATLY_RUNTIME_ENV', 'local');

    expect(authorizeAdminRequest(request('http://localhost/api/admin/workers')).ok).toBe(true);
  });

  it('allows local-only requests only for explicit local runtime', () => {
    vi.stubEnv('STATLY_RUNTIME_ENV', 'local');
    expect(authorizeLocalOnlyRequest().ok).toBe(true);

    vi.stubEnv('STATLY_RUNTIME_ENV', 'preview');
    const result = authorizeLocalOnlyRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });

  it('requires CRON_SECRET for cron requests outside explicit local runtime', () => {
    const result = authorizeCronRequest(request('http://localhost/api/cron/live-stats'));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it('accepts cron bearer token when it matches CRON_SECRET', () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');

    const result = authorizeCronRequest(
      request('http://localhost/api/cron/live-stats', {
        authorization: 'Bearer cron-secret',
      })
    );

    expect(result.ok).toBe(true);
  });
});
