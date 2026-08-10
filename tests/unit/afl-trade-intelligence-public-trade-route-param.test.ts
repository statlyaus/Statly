import { describe, expect, it } from 'vitest';

import { parseAflTradePublicRouteParam } from '@/server/aflTradeIntelligence/runtime/publicTradeRouteParam';

describe('AFL trade public route parameter', () => {
  const tradeId = `external-transaction:${'a'.repeat(64)}`;

  it('accepts the raw canonical public id', () => {
    expect(parseAflTradePublicRouteParam(tradeId)).toBe(tradeId);
  });

  it('decodes the canonical public id exactly once', () => {
    expect(parseAflTradePublicRouteParam(encodeURIComponent(tradeId))).toBe(tradeId);
    expect(
      parseAflTradePublicRouteParam(encodeURIComponent(encodeURIComponent(tradeId)))
    ).toBeNull();
  });

  it.each(['external-transaction%3', '../bad', '%2E%2E%2Fbad', 'a'.repeat(161)])(
    'rejects invalid transport value %s',
    (value) => {
      expect(parseAflTradePublicRouteParam(value)).toBeNull();
    }
  );
});
