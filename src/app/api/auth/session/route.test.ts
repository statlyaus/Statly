import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyIdTokenMock = vi.fn();
const createSessionCookieMock = vi.fn();

vi.mock('@/lib/firebaseAdmin', () => ({
  adminAuth: {
    verifyIdToken: verifyIdTokenMock,
    createSessionCookie: createSessionCookieMock,
  },
}));

describe('/api/auth/session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyIdTokenMock.mockResolvedValue({ uid: 'user-1' });
    createSessionCookieMock.mockResolvedValue('session-cookie');
  });

  it('rejects missing idToken', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      new NextRequest('http://localhost/api/auth/session', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    );

    expect(response.status).toBe(400);
    expect(verifyIdTokenMock).not.toHaveBeenCalled();
  });

  it('creates a bounded httpOnly session cookie', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      new NextRequest('http://localhost/api/auth/session', {
        method: 'POST',
        body: JSON.stringify({ idToken: 'id-token', expiresInDays: 99 }),
      })
    );

    expect(response.status).toBe(200);
    expect(verifyIdTokenMock).toHaveBeenCalledWith('id-token', true);
    expect(createSessionCookieMock).toHaveBeenCalledWith('id-token', {
      expiresIn: 14 * 24 * 60 * 60 * 1000,
    });
    expect(response.headers.get('set-cookie')).toContain('statly_session=session-cookie');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('clears the session cookie on delete', async () => {
    const { DELETE } = await import('./route');

    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('statly_session=');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
