import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('local development auth architecture', () => {
  it('keeps one local development identity shared across auth, fetch, and server auth', () => {
    const devAuth = read('src/lib/devAuth.ts');
    const authContext = read('src/AuthContext.tsx');
    const fetchApi = read('src/lib/api.ts');
    const serverAuth = read('src/lib/serverAuth.ts');
    const leaguePage = read('src/app/(app)/leagues/[id]/page.tsx');

    expect(devAuth).toContain("DEVELOPMENT_AUTH_USER_ID = 'statly-dev-tester'");
    expect(devAuth).toContain("DEVELOPMENT_AUTH_EMAIL = 'admin@statly.dev'");
    expect(devAuth).toContain("DEVELOPMENT_AUTH_CREDENTIAL_ENV = 'STATLY_LOCAL_AUTH_PHRASE'");
    expect(devAuth).toContain('resolveLocalDevelopmentAuthPhrase');
    expect(devAuth).toContain('DEVELOPMENT_AUTH_CREDENTIAL_SUFFIX');
    expect(authContext).not.toContain('DEVELOPMENT_AUTH_CREDENTIAL_SUFFIX');
    expect(devAuth).not.toMatch(/AUTH_[A-Z_]*PASS[A-Z_]*\s*=/);
    expect(authContext).toContain('isDevelopmentLogin(email, pass)');
    expect(authContext).toContain('persistDevelopmentAuthUser()');
    expect(fetchApi).toContain('readStoredDevelopmentAuthUserId()');
    expect(serverAuth).toContain("token.startsWith('dev:')");
    expect(serverAuth).toContain('request.cookies.get(DEVELOPMENT_AUTH_COOKIE)');
    expect(leaguePage).toContain('cookieStore.get(DEVELOPMENT_AUTH_COOKIE)');
  });

  it('aligns the test draft creator human participant with the shared dev user', () => {
    const source = read('src/app/api/create-test-draft/route.ts');

    expect(source).toContain('DEVELOPMENT_AUTH_USER_ID');
    expect(source).toContain('DEVELOPMENT_AUTH_EMAIL');
    expect(source).toContain('DEVELOPMENT_AUTH_DISPLAY_NAME');
    expect(source).toContain('ownerId: DEVELOPMENT_AUTH_USER_ID');
    expect(source).toContain('const userId = i === 1 ? DEVELOPMENT_AUTH_USER_ID');
    expect(source).not.toMatch(/ownerId:\s*'test-user'/);
    expect(source).not.toMatch(/const userId = i === 1 \? 'test-user'/);
  });

  it('keeps quick-completion draft fixtures local while preserving a feasible full draft', () => {
    const source = read('src/app/api/create-test-draft/route.ts');

    expect(source).toContain("process.env.NODE_ENV !== 'production'");
    expect(source).toContain("body?.mode === 'quick-completion'");
    expect(source).toContain('const teamCount = quickCompletionMode ? 2 : 12');
    expect(source).toContain('const positionLimits = { ...LOCAL_TEST_DRAFT_POSITION_LIMITS }');
    expect(source).toContain('calculateDraftCapacity');
    expect(source).toContain('positionLimitsJson: JSON.stringify(positionLimits)');
    expect(source).not.toContain('const totalRounds = quickCompletionMode ? 1 : 22');
    expect(source).not.toContain('const rosterSize = quickCompletionMode ? 1 : 22');
    expect(source).toContain("mode: quickCompletionMode ? 'quick-completion' : 'standard'");
  });
});

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}
