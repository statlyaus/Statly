import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

const lcpLogoPages = ['src/app/(auth)/login/page.tsx', 'src/app/(auth)/register/page.tsx'];

const headerLogos = ['src/app/(public)/layout.tsx', 'src/components/navigation/MainNavigation.tsx'];

describe('image load priority', () => {
  it('preloads the primary logo that is the LCP image on the auth pages', () => {
    for (const path of lcpLogoPages) {
      expect(read(path), path).toMatch(
        /src="\/brand\/statly-primary-logo\.png"[\s\S]*?\bpreload\b/
      );
    }
  });

  it('loads small header logos eagerly without competing for high priority', () => {
    for (const path of headerLogos) {
      const source = read(path);
      expect(source, path).toContain('loading="eager"');
      expect(source, path).not.toMatch(/^\s+(priority|preload)$/m);
    }
  });

  it('does not use the next/image priority prop deprecated in Next.js 16', () => {
    for (const path of [...lcpLogoPages, ...headerLogos]) {
      expect(read(path), path).not.toMatch(/^\s+priority(=\{true\})?$/m);
    }
  });
});
