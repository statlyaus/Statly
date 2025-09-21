import { createServer, type Server } from 'http';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('server-only', () => ({}));

type AppModule = typeof import('./app');

let server: Server;
let url: string;
let appModule: AppModule['default'];

beforeAll(async () => {
  ({ default: appModule } = await import('./app'));
  server = createServer(appModule);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (typeof address === 'object' && address) {
    url = `http://127.0.0.1:${address.port}`;
  }
});

afterAll(() => {
  server.close();
});

describe('POST /api/draft/order', () => {
  it('returns generated snake draft order including bench', async () => {
    const res = await fetch(`${url}/api/draft/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teams: 3, rosterSize: 2, benchSize: 1 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order).toEqual([
      [1, 2, 3],
      [3, 2, 1],
      [1, 2, 3],
    ]);
  });

  it('validates input', async () => {
    const invalidBodies = [
      { teams: 0, rosterSize: 1 },
      { teams: 3, rosterSize: 0 },
      { teams: 3, rosterSize: 1, benchSize: -1 },
    ];
    for (const body of invalidBodies) {
      const res = await fetch(`${url}/api/draft/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });
});
