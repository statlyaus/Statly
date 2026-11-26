import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  BASELINE_PATH,
  countAll,
  countBareButtons,
} from '../../Scripts/design/count-bare-buttons.mjs';

// Buttons on the shared recipes (style guide, "Components"; ticket 14c). Each slice moves an area
// onto buttonStyles or chipStyles and lowers the baseline with
// `node Scripts/design/count-bare-buttons.mjs --write-baseline`.
describe('shared buttons', () => {
  it('counts hand-painted buttons and skips recipe buttons and icon buttons', () => {
    expect(
      countBareButtons(`
        <button className="rounded-md bg-primary px-4">Save</button>
        <button className={\`\${x ? 'bg-card' : 'bg-muted'} border-2\`}>Pick</button>
        <button className={buttonStyles({ variant: 'primary' })}>Save</button>
        <button aria-label="Close" className="p-2 hover:bg-muted"><X /></button>
      `)
    ).toBe(2);
  });

  it('no file has more bare buttons than the committed baseline', () => {
    const baseline: Record<string, number> = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    const over = Object.entries(countAll())
      .map(([path, count]) => ({ path, count, allowed: baseline[path] ?? 0 }))
      .filter(({ count, allowed }) => count > allowed);

    expect(over).toEqual([]);
  });
});
