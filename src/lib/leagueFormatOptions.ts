// The league formats a commissioner can choose, shared by the create page, settings and the server.
// Bloodsucker is epic #1275; No Losers is epic #1290 (BR-01 to BR-04).

import type { LeagueFormat } from '@/types/leagues';

export const LEAGUE_FORMAT_OPTIONS: ReadonlyArray<{ value: LeagueFormat; label: string }> = [
  { value: 'STANDARD', label: 'Standard' },
  { value: 'BLOODSUCKER', label: 'Bloodsucker' },
  { value: 'NO_LOSERS', label: 'No Losers' },
];

export function parseLeagueFormat(
  value: unknown,
  fallback: LeagueFormat = 'STANDARD'
): LeagueFormat {
  return LEAGUE_FORMAT_OPTIONS.some((option) => option.value === value)
    ? (value as LeagueFormat)
    : fallback;
}

/** BR-04 and BR-11: shown wherever the format is chosen, before it is saved. */
export const NO_LOSERS_EXPLANATION =
  "A player's stats count only as far as his AFL club's result allows: a win counts in full; a draw or a loss by 1 to 5 points counts half; a loss by 6 or more counts nothing. It applies to every category, so a losing player's clangers, frees against and turnovers are zeroed too. Works with either scoring mode.";
