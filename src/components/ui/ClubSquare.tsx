import { clubSquareBackground } from '@/lib/clubGuernseys';
import { getTeamAbbreviation } from '@/lib/teamLogos';

/**
 * A club in the fantasy app: the 13px club square beside the club's abbreviation (style guide,
 * "Club colours"). The square is the only place a club's colour appears, and text never sits on it.
 */
export function ClubSquare({ club }: { club: string }): React.JSX.Element {
  return (
    <span className="inline-flex flex-none items-center gap-1.5">
      <span
        aria-hidden="true"
        data-club-square=""
        className="size-[13px] flex-none border border-foreground"
        style={{ background: clubSquareBackground(club) }}
      />
      <abbr title={club} className="no-underline">
        {getTeamAbbreviation(club)}
      </abbr>
    </span>
  );
}
