// Lightweight client-safe re-export of league presets without importing heavy scheduling modules
// This file should be imported by client components to avoid pulling generator algorithms.

import type { LeagueSettings as LegacyLeagueSettings } from '@/lib/scheduling';

export const LEAGUE_PRESETS: {
  readonly [key: string]: { readonly name: string; readonly settings: LegacyLeagueSettings };
} = {
  CLASSIC_8_TEAM: {
    name: '8-Team Classic',
    settings: {
      numTeams: 8,
      seasonWeeks: 16,
      matchupsPerOpponent: 2,
      playoffs: {
        enabled: true,
        teams: 4,
        legLengthWeeks: 1,
        reseedEachRound: false,
        includeConsolation: false,
      },
    },
  },
  LARGE_12_TEAM: {
    name: '12-Team League',
    settings: {
      numTeams: 12,
      seasonWeeks: 20,
      matchupsPerOpponent: 1,
      playoffs: {
        enabled: true,
        teams: 6,
        legLengthWeeks: 1,
        reseedEachRound: true,
        includeConsolation: true,
      },
    },
  },
  CHAMPIONSHIP_SERIES: {
    name: 'Championship Series (Two-Week Finals)',
    settings: {
      numTeams: 10,
      seasonWeeks: 18,
      matchupsPerOpponent: 1,
      playoffs: {
        enabled: true,
        teams: 8,
        legLengthWeeks: 2,
        reseedEachRound: false,
        includeConsolation: false,
      },
    },
  },
} as const;
