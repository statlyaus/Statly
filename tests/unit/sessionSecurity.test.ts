import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { adminAuth } = vi.hoisted(() => ({
  adminAuth: {
    verifyIdToken: vi.fn(),
    createSessionCookie: vi.fn(),
  },
}));

vi.mock('@/lib/firebaseAdmin', () => ({ adminAuth }));

import { DELETE, POST } from '@/app/api/auth/session/route';
import { isSameOriginRequest } from '@/lib/requestOrigin';

const originalAppOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN;
const originalAppUrl = process.env.APP_URL;

describe('session request security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_APP_ORIGIN;
    delete process.env.APP_URL;
    adminAuth.verifyIdToken.mockResolvedValue({ uid: 'user-1' });
    adminAuth.createSessionCookie.mockResolvedValue('session-cookie');
  });

  afterEach(() => {
    restoreEnvironmentVariable('NEXT_PUBLIC_APP_ORIGIN', originalAppOrigin);
    restoreEnvironmentVariable('APP_URL', originalAppUrl);
  });

  it('allows an exact request origin and rejects prefix lookalikes', () => {
    expect(
      isSameOriginRequest(
        new Request('https://statly.test/api/auth/session', {
          headers: { origin: 'https://statly.test' },
        })
      )
    ).toBe(true);

    expect(
      isSameOriginRequest(
        new Request('https://statly.test/api/auth/session', {
          headers: { origin: 'https://statly.test.evil.example' },
        })
      )
    ).toBe(false);
  });

  it('allows an explicitly configured public origin behind a proxy', () => {
    process.env.NEXT_PUBLIC_APP_ORIGIN = 'https://app.statly.com/path';

    expect(
      isSameOriginRequest(
        new Request('http://internal:3000/api/auth/session', {
          headers: { origin: 'https://app.statly.com' },
        })
      )
    ).toBe(true);
  });

  it('rejects cross-origin session creation before reading or verifying the token', async () => {
    const response = await POST(
      new Request('https://statly.test/api/auth/session', {
        method: 'POST',
        headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
        body: 'not-json',
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request origin' });
    expect(adminAuth.verifyIdToken).not.toHaveBeenCalled();
    expect(adminAuth.createSessionCookie).not.toHaveBeenCalled();
  });

  it('creates and clears sessions for same-origin requests', async () => {
    const createResponse = await POST(
      new Request('https://statly.test/api/auth/session', {
        method: 'POST',
        headers: { origin: 'https://statly.test', 'content-type': 'application/json' },
        body: JSON.stringify({ idToken: 'firebase-token' }),
      })
    );
    const deleteResponse = await DELETE(
      new Request('https://statly.test/api/auth/session', {
        method: 'DELETE',
        headers: { origin: 'https://statly.test' },
      })
    );

    expect(createResponse.status).toBe(200);
    expect(createResponse.headers.get('set-cookie')).toContain('statly_session=session-cookie');
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.headers.get('set-cookie')).toContain('statly_session=');
  });

  it('requires server-verified identity at both authenticated layout boundaries', () => {
    for (const path of ['src/app/(app)/layout.tsx', 'src/app/dashboard/page.tsx']) {
      const source = readFileSync(join(process.cwd(), path), 'utf8');
      const verificationIndex = source.indexOf('await getAuthenticatedUserIdFromServerContext()');
      const redirectIndex = source.indexOf("redirect('/login')");
      const renderIndex = source.indexOf('return (');

      expect(verificationIndex).toBeGreaterThan(-1);
      expect(redirectIndex).toBeGreaterThan(verificationIndex);
      expect(renderIndex).toBeGreaterThan(redirectIndex);
    }
  });
});

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
