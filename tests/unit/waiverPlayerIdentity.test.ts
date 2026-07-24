import { describe, expect, it } from 'vitest';

import {
  findWaiverPlayerAliasIds,
  groupWaiverPlayersByIdentity,
  normalizeAvailableWaiverPlayers,
} from '@/server/waivers/waiverPlayerIdentity';

const players = [
  {
    id: 'adam-treloar-western-bulldogs',
    name: 'Adam Treloar',
    club: 'Western Bulldogs',
    position: null,
  },
  {
    id: 'adam_treloar',
    name: 'Adam Treloar',
    club: 'Western Bulldogs',
    position: 'MID',
  },
  {
    id: 'jack-ginnivan-hawthorn',
    name: 'Jack Ginnivan',
    club: 'Hawthorn',
    position: null,
  },
  {
    id: 'jack_ginnivan',
    name: 'Jack Ginnivan',
    club: 'Hawthorn',
    position: 'FWD',
  },
] as const;

describe('waiver player identity', () => {
  it('collapses duplicate aliases to the canonical seeded player record', () => {
    const groups = groupWaiverPlayersByIdentity(players);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.representative.id)).toEqual([
      'adam_treloar',
      'jack_ginnivan',
    ]);
  });

  it('removes every alias when any logical player alias is unavailable', () => {
    const available = normalizeAvailableWaiverPlayers(players, new Set(['jack-ginnivan-hawthorn']));

    expect(available.map((player) => player.id)).toEqual(['adam_treloar']);
  });

  it('resolves all aliases from either requested player id', () => {
    expect(findWaiverPlayerAliasIds(players, 'jack_ginnivan')).toEqual([
      'jack_ginnivan',
      'jack-ginnivan-hawthorn',
    ]);
  });
});
