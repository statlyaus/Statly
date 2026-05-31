import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('user league list route architecture', () => {
  it('requires the authenticated user to match the requested user id', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/leagues/user/[userId]/route.ts'),
      'utf8'
    );

    expect(source).toContain("import { getAuthenticatedUserId } from '@/lib/serverAuth'");
    expect(source).toContain('const authenticatedUserId = await getAuthenticatedUserId(request);');
    expect(source).toContain('authenticatedUserId !== userId');
    expect(source).toContain("error: 'Forbidden'");
    expect(source.indexOf('authenticatedUserId !== userId')).toBeLessThan(
      source.indexOf('listActiveUserLeagueMemberships(userId)')
    );
  });
});
