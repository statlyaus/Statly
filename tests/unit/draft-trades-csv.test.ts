import { describe, expect, it } from 'vitest';

import { escapeCsvCell } from '../../src/lib/draftTrades/csv';

describe('draft trade CSV escaping', () => {
  it('quotes CSV control characters and doubles embedded quotes', () => {
    expect(escapeCsvCell('Trade, one')).toBe('"Trade, one"');
    expect(escapeCsvCell('Trade "one"')).toBe('"Trade ""one"""');
    expect(escapeCsvCell('Trade\rOne')).toBe('"Trade\rOne"');
  });

  it('neutralizes spreadsheet formulas in string cells', () => {
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
    expect(escapeCsvCell('+1+1')).toBe("'+1+1");
    expect(escapeCsvCell('-1+1')).toBe("'-1+1");
    expect(escapeCsvCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
    expect(escapeCsvCell('   =HYPERLINK("https://example.test")')).toBe(
      '"\'   =HYPERLINK(""https://example.test"")"'
    );
  });

  it('preserves non-string scalar values', () => {
    expect(escapeCsvCell(-1)).toBe('-1');
    expect(escapeCsvCell(true)).toBe('true');
    expect(escapeCsvCell(null)).toBe('');
  });
});
