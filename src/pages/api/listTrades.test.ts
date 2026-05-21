import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NextApiRequest, NextApiResponse } from 'next';

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: vi.fn(),
  },
}));

export default function testRoutePlaceholder(_req: NextApiRequest, res: NextApiResponse) {
  res.status(404).end();
}

function response() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    headers: new Map<string, string>(),
    setHeader(name: string, value: string) {
      this.headers.set(name, value);
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

describe('/api/listTrades legacy route', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('STATLY_RUNTIME_ENV', 'preview');
  });

  it('returns 404 outside explicit local runtime', async () => {
    const { default: handler } = await import('./listTrades');
    const res = response();

    await handler({ method: 'GET', query: {} } as never, res as never);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});
