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

  it('resolves full multi-part surnames against canonical abbreviated surname forms', () => {
    const resolver = createPlayerIdentityResolver([
      {
        id: 'nasiah_wmilera',
        name: 'Nasiah W-Milera',
        club: 'St Kilda',
        position: 'DEF',
      },
      {
        id: 'darcy_bjones',
        name: 'Darcy B-Jones',
        club: 'Port Adelaide',
        position: 'DEF',
      },
    ]);

    expect(
      resolveCanonicalPlayerIdFromRecord(
        {
          player_name: 'Nasiah Wanganeen-Milera',
          team: 'St Kilda',
        },
        resolver
      )
    ).toBe('nasiah_wmilera');

    expect(
      resolveCanonicalPlayerIdFromRecord(
        {
          player_name: 'Darcy Byrne-Jones',
          team: 'Port Adelaide',
        },
        resolver
      )
    ).toBe('darcy_bjones');
  });

  it('resolves controlled compact surname and first-name variants through the shared directory bridge', () => {
    const resolver = createPlayerIdentityResolver([
      {
        id: 'massimo_dambrosio',
        name: "Massimo D'Ambrosio",
        club: 'Hawthorn',
        position: 'MID',
      },
      {
        id: 'connor_osullivan',
        name: "Connor O'Sullivan",
        club: 'Geelong',
        position: 'DEF',
      },
      {
        id: 'timothy_english',
        name: 'Timothy English',
        club: 'Western Bulldogs',
        position: 'RUC',
      },
    ]);

    expect(
      resolveCanonicalPlayerIdFromRecord(
        {
          player_name: 'Massimo DAmbrosio',
          team: 'Hawthorn',
        },
        resolver
      )
    ).toBe('massimo_dambrosio');

    expect(
      resolveCanonicalPlayerIdFromRecord(
        {
          player_name: 'Connor OSullivan',
          team: 'Geelong',
        },
        resolver
      )
    ).toBe('connor_osullivan');

    expect(
      resolveCanonicalPlayerIdFromRecord(
        {
          player_name: 'Tim English',
          team: 'Western Bulldogs',
        },
        resolver
      )
    ).toBe('timothy_english');
  });
});
