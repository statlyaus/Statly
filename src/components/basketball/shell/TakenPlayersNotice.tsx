import Link from 'next/link';

import { textLinkStyles } from '@/components/ui/controlStyles';
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
      // A sun alert: a sentence is not a badge, so no tape, capitals or tilt.
      className={cn('ground-sun block px-3 py-2 text-sm', className)}
    >
      Statly knows {takenPlayersSummary(check)}, so some suggestions may already be rostered.{' '}
      <Link
        href={`${basketballLeagueHref(leagueId, 'roster')}#${OTHER_TEAMS_ANCHOR}`}
        // Ink link in ink words: the underline stays so the link is not told by weight alone.
        className={cn(textLinkStyles, 'decoration-current')}
      >
        Add the other teams&apos; players
      </Link>
      .
    </p>
  );
}
