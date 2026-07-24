import { describe, expect, it } from 'vitest';

import { getTradeAcceptancePath } from './tradeAcceptancePath';

describe('getTradeAcceptancePath', () => {
  it.each([
    ['none', 'immediate'],
    ['admin', 'commissioner-review'],
    ['veto', 'veto-review'],
  ] as const)('maps %s review rules to the %s acceptance path', (mode, kind) => {
    expect(getTradeAcceptancePath(mode)).toEqual({ kind });
  });
});
