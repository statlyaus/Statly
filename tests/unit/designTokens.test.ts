import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('design tokens', () => {
  it('uses cobalt for primary actions, the brand bar and focus, per the style guide', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
    const light = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));

    expect(light).toMatch(/--brand-cobalt: #1a2cff;/);
    expect(light).toMatch(/--primary: var\(--brand-cobalt\);/);
    expect(light).toMatch(/--brand-bar: var\(--brand-cobalt\);/);
    expect(light).toMatch(/--ring: var\(--brand-bar\);/);
  });
});
