import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const mocks = vi.hoisted(() => ({
  getPublisherClient: vi.fn(),
  queueAdd: vi.fn(),
  queueConstructor: vi.fn(),
}));

vi.mock('@/server/realtime/scalableConnection', () => ({
  getPublisherClient: mocks.getPublisherClient,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('bullmq', () => ({
  Queue: mocks.queueConstructor,
}));

const now = Date.now();

function metric(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: 'LCP',
    value: 1234,
    rating: 'good',
    id: `metric-${crypto.randomUUID()}`,
    navigationType: 'navigate',
    sessionId: `session-${crypto.randomUUID()}`,
    timestamp: now,
    url: 'https://statly.com.au/leagues',
    ...overrides,
  };
}

function postRequest(url: string, body: Record<string, unknown>, headers?: HeadersInit) {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/analytics/performance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_CLUSTER_NODES;
    delete process.env.REDIS_URL;
    delete process.env.METRICS_ALLOWED_ORIGINS;
    delete process.env.NEXT_PUBLIC_APP_ORIGIN;
    mocks.queueConstructor.mockImplementation(() => ({ add: mocks.queueAdd }));
  });

  it('accepts valid metrics without Redis and does not create Redis or BullMQ clients', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    const response = await POST(
      postRequest('https://statly.com.au/api/analytics/performance', metric(), {
        origin: 'https://statly.com.au',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, message: 'Performance metric recorded' });
    expect(mocks.getPublisherClient).not.toHaveBeenCalled();
    expect(mocks.queueConstructor).not.toHaveBeenCalled();
    expect(mocks.queueAdd).not.toHaveBeenCalled();
  });

  it('allows same-origin requests when the public host is supplied by forwarding headers', async () => {
    process.env.METRICS_ALLOWED_ORIGINS = 'https://configured.example';

    const response = await POST(
      postRequest('https://internal.netlify.app/api/analytics/performance', metric(), {
        origin: 'https://statly.com.au',
        'x-forwarded-host': 'statly.com.au',
        'x-forwarded-proto': 'https',
      })
    );

    expect(response.status).toBe(200);
  });

  it('rejects cross-origin requests when an allow-list is configured', async () => {
    process.env.METRICS_ALLOWED_ORIGINS = 'https://statly.com.au';

    const response = await POST(
      postRequest('https://statly.com.au/api/analytics/performance', metric(), {
        origin: 'https://attacker.example',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ success: false, error: 'Forbidden' });
    expect(mocks.getPublisherClient).not.toHaveBeenCalled();
  });
});
