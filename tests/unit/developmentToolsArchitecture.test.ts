import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const guardedRoutes = [
  {
    path: 'src/app/api/create-test-draft/route.ts',
    firstSensitiveOperation: 'request.json()',
  },
  {
    path: 'src/app/api/test-lobby/route.ts',
    firstSensitiveOperation: 'loadLobbySchemaDiagnostic()',
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

  it('ships no development or demo pages', () => {
    for (const route of ['(development)', 'test-draft']) {
      expect(existsSync(join(process.cwd(), `src/app/(app)/${route}`))).toBe(false);
    }
  });

  it('serves the style guide only with development tools on', () => {
    const source = read('src/app/dev/styleguide/page.tsx');
    const guard = /if \(!isDevelopmentToolsEnabled\(\)\)\s*notFound\(\);/u.exec(source);
    expect(guard).not.toBeNull();
    expect(source.indexOf('return (')).toBeGreaterThan(guard!.index);
  });

  it('shows every colour token on :root in the style guide', () => {
    const page = read('src/app/dev/styleguide/page.tsx');
    const root = /^:root \{([\s\S]*?)^\}/mu.exec(read('src/index.css'))![1]!;
    const tokens = [...root.matchAll(/^\s*(--[a-z0-9-]+):/gmu)]
      .map(([, name]) => name!)
      .filter((name) => !['--radius', '--app-shell-max-width'].includes(name));
    expect(tokens.length).toBeGreaterThan(40);
    expect(tokens.filter((name) => !page.includes(`name: '${name}'`))).toEqual([]);
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
