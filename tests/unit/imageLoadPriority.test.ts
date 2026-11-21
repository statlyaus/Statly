import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

const lcpLogoPages = ['src/app/(auth)/login/page.tsx', 'src/app/(auth)/register/page.tsx'];

// The app bar, the public header and the footer draw the wordmark as text and an inline SVG
// (`StatlyWordmark`), so no logo image competes for loading there.
const wordmarkHeaders = [
  'src/components/navigation/MainNavigation.tsx',
  'src/app/(public)/layout.tsx',
];

describe('image load priority', () => {
  it('preloads the primary logo that is the LCP image on the auth pages', () => {
    for (const path of lcpLogoPages) {
      expect(read(path), path).toMatch(
        /src="\/brand\/statly-primary-logo\.png"[\s\S]*?\bpreload\b/
      );
    }
  });

  it('draws the header wordmark inline, with no logo image to load', () => {
    for (const path of wordmarkHeaders) {
      const source = read(path);
      expect(source, path).toContain('<StatlyWordmark');
      expect(source, path).not.toContain('/brand/statly-hero-logo-overlay.png');
    }
  });

  it('does not use the next/image priority prop deprecated in Next.js 16', () => {
    for (const path of [...lcpLogoPages, ...wordmarkHeaders]) {
      expect(read(path), path).not.toMatch(/^\s+priority(=\{true\})?$/m);
    }
  });
});
