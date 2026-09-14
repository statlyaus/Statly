import { expect, it } from 'vitest';
import { pickCustodyDateColumns, pickCustodyObservationYear } from '@/server/aflTradeIntelligence/source/pickCustodyDate';

it('uses the movement year while preserving day and year precision', () => {
  for (const observedAt of [{ precision: 'day', date: '2020-11-12' }, { precision: 'year', year: 2020 }]) {
    expect(pickCustodyObservationYear(observedAt)).toBe(2020);
    expect(pickCustodyDateColumns(observedAt)).toEqual({ observedAt: null, observedDate: observedAt });
  }
});
it('uses the UTC year for a timestamp and rejects invalid dates', () => {
  expect(pickCustodyObservationYear('2021-01-01T00:30:00+11:00')).toBe(2020);
  expect(() => pickCustodyObservationYear({ precision: 'day', date: '2020-13-12' })).toThrow();
});
