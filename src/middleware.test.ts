import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { config, middleware } from './middleware';

describe('middleware route protection', () => {
  afterEach(() => {
    delete process.env.BYPASS_AUTH;
    delete process.env.NEXT_PUBLIC_BYPASS_AUTH;
  });

  it('includes exact protected route roots in the matcher', () => {
    expect(config.matcher).toEqual(expect.arrayContaining(['/dashboard', '/app', '/league']));
  });

  it('redirects the dashboard root when no server session cookie exists', async () => {
    process.env.BYPASS_AUTH = 'false';
    process.env.NEXT_PUBLIC_BYPASS_AUTH = 'false';
    const request = new NextRequest('http://localhost:3000/dashboard');

    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3000/login?next=%2Fdashboard');
  });

  it('allows the dashboard root when a server session cookie exists', async () => {
    process.env.BYPASS_AUTH = 'false';
    process.env.NEXT_PUBLIC_BYPASS_AUTH = 'false';
    const request = new NextRequest('http://localhost:3000/dashboard', {
      headers: {
        cookie: 'statly_session=session-cookie',
      },
    });

    const response = await middleware(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('allows protected routes in explicit auth bypass mode', async () => {
    process.env.BYPASS_AUTH = 'true';
    process.env.NEXT_PUBLIC_BYPASS_AUTH = 'true';
    const request = new NextRequest('http://localhost:3000/dashboard');

    const response = await middleware(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });
});
