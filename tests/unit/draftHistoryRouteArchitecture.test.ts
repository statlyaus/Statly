import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('draft history route architecture', () => {
  it('uses the shared authenticated user boundary instead of Firebase-only session auth', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/drafts/history/route.ts'),
      'utf8'
    );

    expect(source).toContain("import type { NextRequest } from 'next/server'");
    expect(source).toContain("import { getAuthenticatedUserId } from '@/lib/serverAuth'");
    expect(source).toContain('export async function GET(request: NextRequest)');
    expect(source).toContain('const authenticatedUserId = await getAuthenticatedUserId(request);');
    expect(source).toContain('userId = authenticatedUserId;');
    expect(source).not.toContain("import { cookies } from 'next/headers'");
    expect(source).not.toContain("import { adminAuth } from '@/lib/firebaseAdmin'");
    expect(source).not.toContain("cookieStore.get('statly_session')");
    expect(source).not.toContain('verifySessionCookie');
  });
});
