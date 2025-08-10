import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, Server } from 'http';
import app from './app';

let server: Server;
let url: string;

beforeAll(async () => {
  server = createServer(app);
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
  it('returns generated snake draft order', async () => {
    const res = await fetch(`${url}/api/draft/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teams: 3, rosterSize: 2 })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order).toEqual([
      [1, 2, 3],
      [3, 2, 1]
    ]);
  });

  it('validates input', async () => {
    const res = await fetch(`${url}/api/draft/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teams: 0, rosterSize: 1 })
    });
    expect(res.status).toBe(400);
  });
});
