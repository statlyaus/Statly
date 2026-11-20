import { describe, expect, it } from 'vitest';

import { cn } from './utils';

describe('cn with the brand shape and shadow tokens', () => {
  it('lets a caller override the floating cut', () => {
    expect(cn('rounded-cut-float', 'rounded-none')).toBe('rounded-none');
  });

  it('lets a caller override the hard shadows', () => {
    expect(cn('shadow-hard', 'shadow-none')).toBe('shadow-none');
    expect(cn('shadow-hard', 'shadow-hard-cobalt')).toBe('shadow-hard-cobalt');
  });
});
