import { clubSquare } from '@/lib/clubGuernseys';
import { getTeamAbbreviation } from '@/lib/teamLogos';

/**
 * A club in the fantasy app: the 13px club square beside the club's abbreviation (style guide,
 * "Club colours"). The square is the only place a club's colour appears, and text never sits on it.
 */
export function ClubSquare({ club }: { club: string }): React.JSX.Element {
  const square = clubSquare(club);
  return (
    <span className="inline-flex flex-none items-center gap-1.5">
      <span
        aria-hidden="true"
        data-club-square=""
        className={`size-[13px] flex-none ${square.edged ? 'border-[1.5px] border-foreground' : ''}`}
        style={{ background: square.fill }}
      />
      <span>{getTeamAbbreviation(club)}</span>
    </span>
  );
}
