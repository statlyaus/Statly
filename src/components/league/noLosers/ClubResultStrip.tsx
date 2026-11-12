import { formatLeagueTime } from '@/lib/leagueTime';
import { getTeamAbbreviation } from '@/lib/teamLogos';

/**
 * BR-41: the round's AFL games with each manager's counted players per club. Results are the
 * stored official ones; Footywire has no in-game score, so a game in progress shows none (BR-20).
 */

export interface ClubStripGame {
  matchUid: string;
  homeClub: string;
  awayClub: string;
  homePoints: number | null;
  awayPoints: number | null;
  state: 'FINAL' | 'ABANDONED' | 'RESULT_PENDING' | 'IN_PROGRESS' | 'SCHEDULED';
  startsAt: string | null;
}

export interface ClubStripCount {
  club: string;
  home: number;
  away: number;
}

function gameStatusText(game: ClubStripGame, timeZone?: string): string {
  if (game.state === 'FINAL' && game.homePoints !== null && game.awayPoints !== null) {
    if (game.homePoints === game.awayPoints) return 'Drawn';
    const homeWon = game.homePoints > game.awayPoints;
    const winner = getTeamAbbreviation(homeWon ? game.homeClub : game.awayClub);
    return `${winner} won by ${Math.abs(game.homePoints - game.awayPoints)}`;
  }
  if (game.state === 'ABANDONED') return 'Abandoned · counts in full';
  if (game.state === 'RESULT_PENDING') return 'Result pending';
  if (game.state === 'IN_PROGRESS') return 'Playing · result at full time';
  const startsAt = game.startsAt ? new Date(game.startsAt) : null;
  return startsAt && Number.isFinite(startsAt.getTime())
    ? formatLeagueTime(startsAt, timeZone)
    : 'Not started';
}

function winnerOf(game: ClubStripGame): 'home' | 'away' | null {
  if (game.state !== 'FINAL' || game.homePoints === null || game.awayPoints === null) return null;
  if (game.homePoints === game.awayPoints) return null;
  return game.homePoints > game.awayPoints ? 'home' : 'away';
}

export function ClubResultStrip({
  games,
  counts,
  homeTeamName,
  awayTeamName,
  timeZone,
}: {
  games: readonly ClubStripGame[];
  counts: readonly ClubStripCount[];
  homeTeamName: string;
  awayTeamName: string;
  timeZone?: string;
}) {
  if (!games.length) return null;
  const countFor = (club: string) =>
    counts.find((entry) => entry.club.toUpperCase() === club.toUpperCase()) ?? {
      club,
      home: 0,
      away: 0,
    };

  return (
    <section aria-label="AFL results this round" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-display text-base font-bold text-[color:var(--league-text)]">
          AFL results
        </h3>
        <p className="text-xs text-[color:var(--league-text-muted)]">
          Counted players: {homeTeamName} · {awayTeamName}
        </p>
      </div>
      <ul className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 lg:grid-cols-3">
        {games.map((game) => {
          const winner = winnerOf(game);
          const status = gameStatusText(game, timeZone);
          const home = countFor(game.homeClub);
          const away = countFor(game.awayClub);
          const score = (points: number | null) => (game.state === 'FINAL' ? points : null);
          const summary =
            `${game.homeClub}${score(game.homePoints) !== null ? ` ${game.homePoints}` : ''} v ` +
            `${game.awayClub}${score(game.awayPoints) !== null ? ` ${game.awayPoints}` : ''}. ${status}. ` +
            `Counted players on ${game.homeClub}: ${homeTeamName} ${home.home}, ${awayTeamName} ${home.away}. ` +
            `On ${game.awayClub}: ${homeTeamName} ${away.home}, ${awayTeamName} ${away.away}.`;
          return (
            <li
              key={game.matchUid}
              className="rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-3 py-2 text-sm"
            >
              <span className="sr-only">{summary}</span>
              <div aria-hidden="true">
                {(['home', 'away'] as const).map((side) => {
                  const club = side === 'home' ? game.homeClub : game.awayClub;
                  const points = side === 'home' ? game.homePoints : game.awayPoints;
                  const count = side === 'home' ? home : away;
                  return (
                    <div
                      key={side}
                      className={`flex items-center gap-2 tabular-nums ${
                        winner === side
                          ? 'font-bold text-[color:var(--league-text)]'
                          : 'text-[color:var(--league-text-muted)]'
                      }`}
                    >
                      <span className="w-10 font-semibold">{getTeamAbbreviation(club)}</span>
                      <span className="w-8 text-right">{score(points) ?? ''}</span>
                      <span className="ml-auto text-xs font-medium">
                        {count.home} · {count.away}
                      </span>
                    </div>
                  );
                })}
                <p className="mt-1 text-xs text-[color:var(--league-text-muted)]">{status}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
