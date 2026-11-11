import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// docs/product/design-principles.md: no decorative gradients, no uppercase group labels, standard
// radius and elevation tokens, and semantic colour tokens instead of fixed palette utilities.
const files = [
  'src/components/navigation/MainNavigation.tsx',
  'src/app/(app)/drafts/page.tsx',
  'src/app/(app)/leagues/join/page.tsx',
];

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('navigation and page design rules', () => {
  it.each(files)('%s has no gradients or uppercase labels', (path) => {
    const source = read(path);

    expect(source).not.toMatch(/bg-gradient|linear-gradient|radial-gradient/);
    expect(source).not.toMatch(/\b(from|via|to)-(?:[a-z]+-\d{2,3}|\[)/);
    expect(source).not.toMatch(/\buppercase\b/);
  });

  it('MainNavigation uses the standard radius and shadow tokens', () => {
    const source = read('src/components/navigation/MainNavigation.tsx');

    expect(source).not.toMatch(/rounded-\[/);
    expect(source).not.toMatch(/shadow-\[/);
    expect(source).not.toMatch(/tracking-\[/);
  });
});
