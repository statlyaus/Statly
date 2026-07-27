import { describe, expect, it } from 'vitest';

import {
  draftHubHeaderKickerClass,
  draftHubSectionPillClass,
} from '@/components/draft/draftHubChrome';

describe('public Draft hub typography', () => {
  it.each([
    ['header kicker', draftHubHeaderKickerClass],
    ['section pill', draftHubSectionPillClass],
  ])('keeps the shared %s at the 12px type floor', (_label, className) => {
    expect(className).toContain('text-xs');
    expect(className).not.toMatch(/text-\[(?:9|10|11)px\]/);
  });
});
