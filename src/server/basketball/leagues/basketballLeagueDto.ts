import type { Prisma } from '@prisma/client';

import { dateOnlyToString, type EasternDate } from '@/lib/basketball/fantasyWeeks';
import type {
  BasketballCategoryId,
  BasketballPlatform,
  BasketballRosterSlotCounts,
  BasketballScoringFormat,
} from '@/types/basketball';

import type { PasteMatchStatus } from './basketballPlayerMatching';
import { rosterSlotsSchema } from './basketballLeagueValidation';

export interface BasketballLeagueSummary {
  id: string;
  name: string;
  platform: BasketballPlatform;
  format: BasketballScoringFormat;
  season: number;
  teamCount: number;
  myTeamName: string;
  createdAt: string;
}

export interface BasketballLeagueTeamDto {
  id: string;
  name: string;
  isMine: boolean;
  sortOrder: number;
}

export interface BasketballPlayerInjuryDto {
  status: 'OUT' | 'DAY_TO_DAY';
  detail: string | null;
  expectedReturnOn: EasternDate | null;
}

export interface BasketballRosterSpotDto {
  playerId: string;
  /** null: rostered by a team the user has not entered. */
  teamId: string | null;
  onInjuredList: boolean;
  acquiredOn: EasternDate;
  player: {
    fullName: string;
    teamCode: string | null;
    positions: string[];
    active: boolean;
    injury: BasketballPlayerInjuryDto | null;
  };
}

export interface BasketballMatchupDto {
  week: number;
  teamId: string;
  opponentTeamId: string;
}

export interface BasketballLeagueDetail {
  id: string;
  name: string;
  platform: BasketballPlatform;
  format: BasketballScoringFormat;
  season: number;
  categories: BasketballCategoryId[];
  puntCategories: BasketballCategoryId[];
  teamCount: number;
  rosterSlots: BasketballRosterSlotCounts;
  weekOneStartsOn: EasternDate;
  regularSeasonEndsOn: EasternDate;
  twoWeekMatchups: number[];
  auctionBudget: number | null;
  myTeamId: string;
  /** Mine first, then in the user's order. */
  teams: BasketballLeagueTeamDto[];
  /** Ordered by player name. */
  rosterSpots: BasketballRosterSpotDto[];
  /** Ordered by week. */
  matchups: BasketballMatchupDto[];
  createdAt: string;
  updatedAt: string;
}

/** A player an "elsewhere" add left alone, because he is on a team the user has entered. */
export interface BasketballRosterSkip {
  playerId: string;
  fullName: string;
  teamId: string;
  teamName: string;
  reason: 'ON_ENTERED_TEAM';
}

/** The league read back after an add, plus the players the add skipped. */
export interface BasketballRosterAddResult extends BasketballLeagueDetail {
  skipped: BasketballRosterSkip[];
}

/** An NBA player proposed for a pasted line, and where he already sits in this league. */
export interface NbaPlayerCandidate {
  id: string;
  fullName: string;
  teamCode: string | null;
  positions: string[];
  /** null: a free agent in this league. `teamId` null: rostered by a team not entered. */
  rostered: { teamId: string | null; teamName: string | null } | null;
}

export interface PastedRosterLine {
  /** 1-based line number in the pasted text. */
  line: number;
  text: string;
  /** The name read from the line after stripping slot, position, team and status clutter. */
  name: string;
  status: PasteMatchStatus;
  /** matched/suggested: one; ambiguous: 2–5; none: empty. */
  candidates: NbaPlayerCandidate[];
}

export interface NbaPlayerSearchResult {
  id: string;
  fullName: string;
  teamCode: string | null;
  positions: string[];
}

export const leagueDetailInclude = {
  teams: { orderBy: [{ isMine: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }] },
  rosterSpots: {
    orderBy: [{ player: { fullName: 'asc' } }, { playerId: 'asc' }],
    include: {
      player: {
        select: {
          fullName: true,
          positions: true,
          active: true,
          team: { select: { code: true } },
          injury: { select: { status: true, detail: true, expectedReturnOn: true } },
        },
      },
    },
  },
  matchups: { orderBy: [{ week: 'asc' }, { teamId: 'asc' }] },
} satisfies Prisma.BasketballLeagueInclude;

type LeagueDetailRow = Prisma.BasketballLeagueGetPayload<{ include: typeof leagueDetailInclude }>;

export function toBasketballLeagueDetail(row: LeagueDetailRow): BasketballLeagueDetail {
  const mine = row.teams.find((team) => team.isMine);
  if (!mine) throw new Error(`Basketball league ${row.id} has no team marked as the user's own`);

  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    format: row.format,
    season: row.season,
    categories: row.categories as BasketballCategoryId[],
    puntCategories: row.puntCategories as BasketballCategoryId[],
    teamCount: row.teamCount,
    rosterSlots: rosterSlotsSchema.parse(row.rosterSlotsJson),
    weekOneStartsOn: dateOnlyToString(row.weekOneStartsOn),
    regularSeasonEndsOn: dateOnlyToString(row.regularSeasonEndsOn),
    twoWeekMatchups: row.twoWeekMatchups,
    auctionBudget: row.auctionBudget,
    myTeamId: mine.id,
    teams: row.teams.map((team) => ({
      id: team.id,
      name: team.name,
      isMine: team.isMine,
      sortOrder: team.sortOrder,
    })),
    rosterSpots: row.rosterSpots.map((spot) => ({
      playerId: spot.playerId,
      teamId: spot.teamId,
      onInjuredList: spot.onInjuredList,
      acquiredOn: dateOnlyToString(spot.acquiredOn),
      player: {
        fullName: spot.player.fullName,
        teamCode: spot.player.team?.code ?? null,
        positions: spot.player.positions,
        active: spot.player.active,
        injury: spot.player.injury
          ? {
              status: spot.player.injury.status,
              detail: spot.player.injury.detail,
              expectedReturnOn: spot.player.injury.expectedReturnOn
                ? dateOnlyToString(spot.player.injury.expectedReturnOn)
                : null,
            }
          : null,
      },
    })),
    matchups: row.matchups.map((matchup) => ({
      week: matchup.week,
      teamId: matchup.teamId,
      opponentTeamId: matchup.opponentTeamId,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
