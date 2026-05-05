import { describe, expect, it, vi } from 'vitest';

import { resolvePlayerIdentity } from '../../shared/player-identity/playerIdentityResolver';

describe('resolvePlayerIdentity', () => {
  it('resolves full multi-part surnames against abbreviated canonical player names', async () => {
    const prisma = {
      player: {
        findMany: vi.fn().mockResolvedValue([
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
        ]),
      },
      playerSeasonRegistration: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      playerAlias: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    await expect(
      resolvePlayerIdentity(prisma as never, {
        playerName: 'Nasiah Wanganeen-Milera',
        team: 'St Kilda',
        season: 2026,
        source: 'test',
        sourceDocumentId: 'nasiah',
        rawPayload: {
          player_name: 'Nasiah Wanganeen-Milera',
          team: 'St Kilda',
        },
      })
    ).resolves.toMatchObject({
      outcome: 'resolved',
      playerId: 'nasiah_wmilera',
      matchedBy: 'player',
    });

    await expect(
      resolvePlayerIdentity(prisma as never, {
        playerName: 'Darcy Byrne-Jones',
        team: 'Port Adelaide',
        season: 2026,
        source: 'test',
        sourceDocumentId: 'darcy',
        rawPayload: {
          player_name: 'Darcy Byrne-Jones',
          team: 'Port Adelaide',
        },
      })
    ).resolves.toMatchObject({
      outcome: 'resolved',
      playerId: 'darcy_bjones',
      matchedBy: 'player',
    });
  });

  it('resolves controlled compact surname and first-name variants without weakening unresolved cases', async () => {
    const prisma = {
      player: {
        findMany: vi.fn().mockResolvedValue([
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
        ]),
      },
      playerSeasonRegistration: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      playerAlias: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    await expect(
      resolvePlayerIdentity(prisma as never, {
        playerName: 'Massimo DAmbrosio',
        team: 'Hawthorn',
        season: 2026,
        source: 'test',
        sourceDocumentId: 'massimo',
        rawPayload: {
          player_name: 'Massimo DAmbrosio',
          team: 'Hawthorn',
        },
      })
    ).resolves.toMatchObject({
      outcome: 'resolved',
      playerId: 'massimo_dambrosio',
      matchedBy: 'player',
    });

    await expect(
      resolvePlayerIdentity(prisma as never, {
        playerName: 'Connor OSullivan',
        team: 'Geelong',
        season: 2026,
        source: 'test',
        sourceDocumentId: 'connor',
        rawPayload: {
          player_name: 'Connor OSullivan',
          team: 'Geelong',
        },
      })
    ).resolves.toMatchObject({
      outcome: 'resolved',
      playerId: 'connor_osullivan',
      matchedBy: 'player',
    });

    await expect(
      resolvePlayerIdentity(prisma as never, {
        playerName: 'Tim English',
        team: 'Western Bulldogs',
        season: 2026,
        source: 'test',
        sourceDocumentId: 'tim',
        rawPayload: {
          player_name: 'Tim English',
          team: 'Western Bulldogs',
        },
      })
    ).resolves.toMatchObject({
      outcome: 'resolved',
      playerId: 'timothy_english',
      matchedBy: 'player',
    });

    await expect(
      resolvePlayerIdentity(prisma as never, {
        playerName: 'Jordan Croft',
        team: 'Western Bulldogs',
        season: 2026,
        source: 'test',
        sourceDocumentId: 'jordan',
        rawPayload: {
          player_name: 'Jordan Croft',
          team: 'Western Bulldogs',
        },
      })
    ).resolves.toMatchObject({
      outcome: 'unresolved',
    });
  });

  it('resolves by season registration when the current player club differs from the source row club', async () => {
    const prisma = {
      player: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'logan_mcdonald',
            name: 'Logan McDonald',
            club: 'Fremantle',
            position: 'FWD',
          },
        ]),
      },
      playerSeasonRegistration: {
        findMany: vi.fn().mockResolvedValue([
          {
            playerId: 'logan_mcdonald',
            season: 2026,
            club: 'Sydney',
            position: 'FWD',
            player: {
              id: 'logan_mcdonald',
              name: 'Logan McDonald',
              club: 'Fremantle',
              position: 'FWD',
            },
          },
        ]),
      },
      playerAlias: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    await expect(
      resolvePlayerIdentity(prisma as never, {
        playerName: 'Logan McDonald',
        team: 'Sydney',
        season: 2026,
        source: 'test',
        sourceDocumentId: 'logan',
        rawPayload: {
          player_name: 'Logan McDonald',
          team: 'Sydney',
        },
      })
    ).resolves.toMatchObject({
      outcome: 'resolved',
      playerId: 'logan_mcdonald',
      matchedBy: 'player',
    });
  });
});
