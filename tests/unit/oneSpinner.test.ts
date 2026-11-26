import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// One spinner (style guide, "Numbers, empty states, loading"; ticket 14c): only
// src/components/ui/Spinner.tsx turns, so every loading state looks the same and can name what is
// loading.
const SPINNER = join('src', 'components', 'ui', 'Spinner.tsx');

describe('one spinner', () => {
  it('only the shared Spinner spins', () => {
    const offenders = readdirSync(join(process.cwd(), 'src'), { recursive: true, encoding: 'utf8' })
      .filter((path) => /\.(tsx?|jsx?|css)$/.test(path) && !/\.(test|spec)\./.test(path))
      .map((path) => join('src', path))
      .filter((path) => path !== SPINNER)
      .filter((path) => /animate-spin|LoadingSpinner/.test(readFileSync(path, 'utf8')));

    expect(offenders).toEqual([]);
  });
});
