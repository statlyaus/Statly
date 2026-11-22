import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

// The app bar, the public header, the footer and the sign-in pages draw the wordmark as text and an
// inline SVG (`StatlyWordmark`), so no logo image competes for loading there.
const wordmarkPages = [
  'src/components/navigation/MainNavigation.tsx',
  'src/app/(public)/layout.tsx',
  'src/app/(auth)/login/page.tsx',
  'src/app/(auth)/register/page.tsx',
];

describe('image load priority', () => {
  it('draws the wordmark inline, with no logo image to load', () => {
    for (const path of wordmarkPages) {
      const source = read(path);
      expect(source, path).toContain('<StatlyWordmark');
      expect(source, path).not.toMatch(/\/brand\/statly-[a-z-]*logo/);
    }
  });

  it('does not use the next/image priority prop deprecated in Next.js 16', () => {
    for (const path of wordmarkPages) {
      expect(read(path), path).not.toMatch(/^\s+priority(=\{true\})?$/m);
    }
  });
});

describe('site icons', () => {
  it('points the tab and home-screen icons at the brand board Sherrin tile', () => {
    expect(read('src/app/layout.tsx')).toContain(
      "icons: { icon: '/favicon.svg', apple: '/brand/statly-sherrin-icon-180.png' }"
    );
    expect(existsSync(join(root, 'public/brand/statly-sherrin-icon-180.png'))).toBe(true);
    const favicon = read('public/favicon.svg');
    expect(favicon).toContain('fill="#1a2cff"');
    expect(favicon).toContain('M10 42 C 22 14, 92 6, 110 36 C 98 66, 30 72, 10 42 Z');
    expect(favicon).not.toContain('<image');
  });
});
