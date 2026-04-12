import { describe, expect, it } from 'vitest';

import {
  createPlayerIdentityResolver,
  resolveCanonicalPlayerIdFromRecord,
} from '@/lib/playerMatchStats';

describe('playerMatchStats identity bridge', () => {
  it('resolves provider-style player ids to canonical Prisma player ids', () => {
    const resolver = createPlayerIdentityResolver([
      {
        id: 'aaron_naughton',
        name: 'Aaron Naughton',
        club: 'Western Bulldogs',
        position: 'FWD',
      },
    ]);

    expect(
      resolveCanonicalPlayerIdFromRecord(
        {
          player_id: 'ply_aaron_naughton',
          player_uid: 'ply_aaron_naughton',
          player_name: 'Aaron Naughton',
          team: 'Western Bulldogs',
        },
        resolver
      )
    ).toBe('aaron_naughton');
  });

  it('falls back to name and team directory resolution when provider ids are absent', () => {
    const resolver = createPlayerIdentityResolver([
      {
        id: 'thomas_liberatore',
        name: 'Thomas Liberatore',
        club: 'Western Bulldogs',
        position: 'MID',
      },
    ]);

    expect(
      resolveCanonicalPlayerIdFromRecord(
        {
          player_name: 'Tom Liberatore',
          team: 'Western Bulldogs',
        },
        resolver
      )
    ).toBe('thomas_liberatore');
  });
});
