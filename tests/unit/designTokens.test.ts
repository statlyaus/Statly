import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('design tokens', () => {
  it('uses the navy brand-bar for primary actions and focus, per the design principles', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
    const light = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));

    expect(light).toMatch(/--primary: var\(--statly-navy\);/);
    expect(light).toMatch(/--ring: var\(--brand-bar\);/);
  });
});
