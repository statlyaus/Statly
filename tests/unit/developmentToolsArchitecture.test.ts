import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const guardedRoutes = [
  {
    path: 'src/app/api/add-test-data/route.ts',
    firstSensitiveOperation: 'const db = adminDb',
  },
  {
    path: 'src/app/api/create-test-draft/route.ts',
    firstSensitiveOperation: 'request.json()',
  },
  {
    path: 'src/app/api/test-lobby/route.ts',
    firstSensitiveOperation: 'loadLobbySchemaDiagnostic()',
  },
  {
    path: 'src/app/api/dev/test-user/route.ts',
    firstSensitiveOperation: "await import('@/lib/firebaseAdmin')",
  },
  {
    path: 'src/app/api/drafts/[id]/debug/route.ts',
    firstSensitiveOperation: 'await params',
  },
] as const;

describe('development tools architecture', () => {
  it.each(guardedRoutes)(
    'guards $path before route work begins',
    ({ path, firstSensitiveOperation }) => {
      const source = read(path);
      const guardIndex = source.indexOf('if (!isDevelopmentToolsEnabled())');
      const operationIndex = source.indexOf(firstSensitiveOperation);

      expect(source).toContain('return developmentToolsNotFoundResponse()');
      expect(guardIndex).toBeGreaterThan(-1);
      expect(operationIndex).toBeGreaterThan(guardIndex);
    }
  );

  it('hides the test-draft UI behind the same server gate', () => {
    const source = read('src/app/(app)/test-draft/layout.tsx');

    expect(source).toContain('if (!isDevelopmentToolsEnabled())');
    expect(source).toContain('notFound()');
  });

  it('opts in only the canonical local and Playwright harnesses', () => {
    const localStack = read('Scripts/dev/full-local-stack.sh');
    const playwrightConfig = read('playwright.config.ts');
    const docs = read('docs/development/setup.md');

    expect(localStack).toContain('export STATLY_ENABLE_DEV_TOOLS="true"');
    expect(playwrightConfig).toContain("'STATLY_ENABLE_DEV_TOOLS=true'");
    expect(docs).toContain('STATLY_ENABLE_DEV_TOOLS=true');
  });
});

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}
