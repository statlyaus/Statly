import type { BasketballPlatform, BasketballScoringFormat } from '@/types/basketball';

/**
 * Defaults for a new league. Change these each NBA season: week one starts on the Monday of the
 * season's first week (Yahoo's default) and the regular season ends on the NBA's last
 * regular-season day. Everything else that names the season derives from them.
 */
export const NEW_LEAGUE_DEFAULTS = {
  platform: 'YAHOO' as BasketballPlatform,
  format: 'H2H_MOST_CATEGORIES' as BasketballScoringFormat,
  teamCount: 12,
  weekOneStartsOn: '2026-10-19',
  regularSeasonEndsOn: '2027-04-11',
};

/**
 * The NBA season (the year it ends) a league starting on `weekOneStartsOn` plays in, as the leagues
 * service names it: a week one from July on belongs to the season ending the next year.
 */
export function nbaSeasonOfWeekOne(weekOneStartsOn: string): number {
  const [year, month] = weekOneStartsOn.split('-').map(Number);
  return month >= 7 ? year + 1 : year;
}
