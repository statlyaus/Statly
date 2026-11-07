import Link from 'next/link';

import { basketballLeagueHref } from './basketballFormat';
import type { TakenPlayersCheck } from './takenPlayers';

/** The id of the roster page's "Players on other teams" section, for links that jump to it. */
export const OTHER_TEAMS_ANCHOR = 'other-teams';

/**
 * Warns that free-agent suggestions may include players rostered in the real league, while too few
 * players are marked as taken. Renders nothing once there are enough. Server-safe: no hooks.
 */
export function TakenPlayersNotice({
  check,
  leagueId,
  className = '',
}: {
  check: TakenPlayersCheck;
  leagueId: string;
  className?: string;
}) {
  if (check.enough) return null;
  return (
    <p
      role="status"
      className={`rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-foreground ${className}`}
    >
      {check.taken === 0
        ? 'No players are'
        : `Only ${check.taken} ${check.taken === 1 ? 'player is' : 'players are'}`}{' '}
      marked as taken in this league, so some suggestions may already be on other teams.{' '}
      <Link
        href={`${basketballLeagueHref(leagueId, 'roster')}#${OTHER_TEAMS_ANCHOR}`}
        className="font-semibold underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Add the other teams&apos; players
      </Link>
      .
    </p>
  );
}
