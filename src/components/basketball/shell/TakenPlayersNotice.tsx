import Link from 'next/link';

import { badgeStyles } from '@/components/ui/controlStyles';
import { cn } from '@/lib/utils';

import { basketballLeagueHref } from './basketballFormat';
import { takenPlayersSummary, type TakenPlayersCheck } from './takenPlayers';

/** The id of the roster page's "Players on other teams" section, for links that jump to it. */
export const OTHER_TEAMS_ANCHOR = 'other-teams';

/**
 * Warns that free-agent suggestions may include players rostered in the real league, while too few
 * players on other teams are entered. Renders nothing once there are enough. Server-safe: no hooks.
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
      // The badge recipe's warning tone, laid out as a wrapping block.
      className={cn(
        badgeStyles({ tone: 'warning', size: 'md' }),
        'block whitespace-normal rounded-md px-3 py-2 font-normal',
        className
      )}
    >
      Statly knows {takenPlayersSummary(check)}, so some suggestions may already be rostered.{' '}
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
