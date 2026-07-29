import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('local development auth architecture', () => {
  it('keeps one local development identity shared across auth, fetch, and server auth', () => {
    const devAuth = read('src/lib/devAuth.ts');
    const authContext = read('src/AuthContext.tsx');
    const fetchApi = read('src/lib/api.ts');
    const authenticatedFetch = read('src/lib/authenticatedFetch.ts');
    const serverAuth = read('src/lib/serverAuth.ts');
    const nextApiAuth = read('src/lib/nextApiAuth.ts');
    const proxy = read('src/proxy.ts');
    const socketServer = read('src/server/socketioServer.ts');
    const pickCommand = read('src/server/draft/api/handlePickCommand.ts');
    const leaguePage = read('src/app/(app)/leagues/[id]/page.tsx');
    const teamPage = read('src/app/(app)/leagues/[id]/teams/[memberId]/page.tsx');

    expect(devAuth).toContain("DEVELOPMENT_AUTH_USER_ID = 'statly-dev-tester'");
    expect(devAuth).toContain("DEVELOPMENT_AUTH_EMAIL = 'admin@statly.dev'");
    expect(devAuth).toContain("DEVELOPMENT_AUTH_CREDENTIAL_ENV = 'STATLY_LOCAL_AUTH_PHRASE'");
    expect(devAuth).toContain("process.env.NEXT_PUBLIC_STATLY_ENABLE_DEV_AUTH === 'true'");
    expect(devAuth).toContain("process.env.STATLY_ENABLE_DEV_AUTH === 'true'");
    expect(devAuth).toContain('resolveLocalDevelopmentAuthPhrase');
    expect(devAuth).toContain('DEVELOPMENT_AUTH_CREDENTIAL_SUFFIX');
    expect(authContext).not.toContain('DEVELOPMENT_AUTH_CREDENTIAL_SUFFIX');
    expect(devAuth).not.toMatch(/AUTH_[A-Z_]*PASS[A-Z_]*\s*=/);
    expect(authContext).toContain('isDevelopmentLogin(email, pass)');
    expect(authContext).toContain('persistDevelopmentAuthUser()');
    expect(fetchApi).toContain('readStoredDevelopmentAuthUserId()');
    expect(authenticatedFetch).toContain('isDevelopmentAuthEnabled()');
    expect(serverAuth).toContain("token.startsWith('dev:')");
    expect(serverAuth).toContain('isServerDevelopmentAuthEnabled()');
    expect(serverAuth).toContain('request.cookies.get(DEVELOPMENT_AUTH_COOKIE)');
    expect(nextApiAuth).toContain('resolveAuthenticatedUserId');
    expect(proxy).toContain('isServerDevelopmentAuthEnabled()');
    expect(socketServer).toContain('isServerDevelopmentAuthEnabled()');
    expect(pickCommand).toContain('isServerDevelopmentAuthEnabled()');
    expect(leaguePage).toContain('getAuthenticatedUserIdFromServerContext()');
    expect(teamPage).toContain('getAuthenticatedUserIdFromServerContext()');
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

  it('uses an app-owned auth identity and keeps action errors at the form boundary', () => {
    const authContext = read('src/AuthContext.tsx');
    const authForm = read('src/components/AuthForm.tsx');

    expect(authContext).toContain('export interface AuthUser');
    expect(authContext).toContain('user: AuthUser | null');
    expect(authContext).toContain('login: (email: string, pass: string) => Promise<void>');
    expect(authContext).not.toContain('unknown as User');
    expect(authContext).not.toContain('UserCredential');
    expect(authContext).not.toContain('toFirebaseDevelopmentUser');
    expect(authForm).toContain('const [error, setError] = useState<string | null>(null)');
    expect(authForm).toContain("showNotification('error', message)");
  });

  it('documents explicit opt-in and enables it only in the isolated browser harness', () => {
    const firebaseDocs = read('docs/development/setup.md');
    const playwrightConfig = read('playwright.config.ts');

    expect(firebaseDocs).toContain('NEXT_PUBLIC_STATLY_ENABLE_DEV_AUTH=true');
    expect(firebaseDocs).toContain('STATLY_ENABLE_DEV_AUTH=true');
    expect(playwrightConfig).toContain("'NEXT_PUBLIC_STATLY_ENABLE_DEV_AUTH=true'");
    expect(playwrightConfig).toContain("'STATLY_ENABLE_DEV_AUTH=true'");
  });

  it('keeps quick-completion draft fixtures local while preserving a feasible full draft', () => {
    const source = read('src/app/api/create-test-draft/route.ts');

    expect(source).toContain('if (!isDevelopmentToolsEnabled())');
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
