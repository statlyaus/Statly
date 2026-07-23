import type { FantasyCategory, FantasyCategoryKey } from './fantasyCategories';
import type { CategoryDirection } from './leagues';

export const LEAGUE_PLAYER_STAT_BASIS = 'PER_GAME' as const;
export const LEAGUE_PLAYER_STAT_PERIOD = 'SEASON' as const;

export interface LeagueCategoryColumnDto {
  key: FantasyCategoryKey;
  label: string;
  shortLabel: string;
  format: FantasyCategory['format'];
  direction: CategoryDirection;
}

export interface LeaguePlayerStatContextDto {
  basis: typeof LEAGUE_PLAYER_STAT_BASIS;
  period: typeof LEAGUE_PLAYER_STAT_PERIOD;
  season: number;
  availableSeasons: number[];
  dataThrough: string | null;
}

export type LeaguePlayerStatValues = Partial<Record<FantasyCategoryKey, number | null>>;

export interface LeaguePlayerStatLineDto {
  gamesPlayed: number;
  values: LeaguePlayerStatValues;
}

export interface LeaguePlayerStatDatasetDto {
  context: LeaguePlayerStatContextDto;
  columns: LeagueCategoryColumnDto[];
  playersById: Record<string, LeaguePlayerStatLineDto>;
}
