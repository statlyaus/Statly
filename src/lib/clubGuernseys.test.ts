import { describe, expect, it } from 'vitest';

import { FALLBACK_GUERNSEY, guernseyFor } from './clubGuernseys';

describe('guernseyFor', () => {
  it('gives each club its colours and pattern', () => {
    expect(guernseyFor('Collingwood')).toMatchObject({ pattern: 'stripes', base: '#000000' });
    expect(guernseyFor('Richmond')).toMatchObject({ pattern: 'sash', trim: '#fed102' });
    expect(guernseyFor('Geelong').pattern).toBe('hoops');
  });

  it('understands club aliases', () => {
    expect(guernseyFor('Adelaide Crows')).toEqual(guernseyFor('Adelaide'));
    expect(guernseyFor('GWS Giants')).toEqual(guernseyFor('GWS'));
  });

  it('falls back to a neutral jumper', () => {
    expect(guernseyFor(null)).toBe(FALLBACK_GUERNSEY);
    expect(guernseyFor('  ')).toBe(FALLBACK_GUERNSEY);
    expect(guernseyFor('Tasmania Devils')).toBe(FALLBACK_GUERNSEY);
  });
});
