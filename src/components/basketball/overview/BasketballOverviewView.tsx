import Link from 'next/link';

import { buttonStyles, textLinkStyles } from '@/components/ui/controlStyles';
import type {
  BasketballOverview,
  BasketballOverviewPlayer,
  BasketballOverviewSide,
} from '@/server/basketball/readModels/overview';

import { InjuryBadge, PlayerIdentity } from '../shell/PlayerIdentity';
import { basketballLeagueHref, formatEasternDate, formatTimeAgo } from '../shell/basketballFormat';

function Freshness({ overview, now }: { overview: BasketballOverview; now: Date }) {
  const { stats, injuryReport } = overview;
  if (!stats.updatedAt) {
    return (
      <p className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-foreground">
        NBA stats haven&apos;t been loaded yet. Games left and injuries appear after the first
        update.
      </p>
    );
  }
  const statsText = `NBA stats ${stats.stale ? 'last updated' : 'updated'} ${formatTimeAgo(stats.updatedAt, now)}`;
  const injuryText = injuryReport.updatedAt
    ? `injury report ${injuryReport.stale ? 'last updated' : 'updated'} ${formatTimeAgo(injuryReport.updatedAt, now)}`
    : 'injury report not loaded yet';
  const stale = stats.stale || injuryReport.stale;
  return (
    <p
      className={
        stale
          ? 'rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-foreground'
          : 'text-sm text-muted-foreground'
      }
    >
      {statsText} · {injuryText}
      {stale ? '. Numbers may be out of date.' : ''}
    </p>
  );
}

function SideSummary({ side, label }: { side: BasketballOverviewSide; label: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="truncate font-semibold text-foreground">{side.name}</p>
      <p className="mt-1 font-display text-3xl font-bold leading-none tabular-nums text-foreground">
        {side.gamesLeft}
        <span className="ml-1.5 font-sans text-sm font-medium text-muted-foreground">
          games left
        </span>
      </p>
    </div>
  );
}

function ThisWeek({ overview, leagueId }: { overview: BasketballOverview; leagueId: string }) {
  const { phase, week, me, opponent } = overview;
  // The league header already shows the week's dates.
  const title =
    phase === 'PRESEASON'
      ? `Week 1 starts ${formatEasternDate(week.start)}`
      : phase === 'ENDED'
        ? 'Regular season over'
        : opponent
          ? "This week's matchup"
          : 'This week';
  return (
    <section
      aria-labelledby="bb-week-title"
      className="rounded-lg border border-border bg-card p-4 sm:p-5"
    >
      <h2 id="bb-week-title" className="font-display text-lg font-bold text-foreground">
        {title}
      </h2>
      {opponent ? (
        <>
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3">
            <SideSummary side={me} label="You" />
            <span className="pb-1 text-sm font-semibold text-muted-foreground">vs</span>
            <div className="text-right">
              <SideSummary side={opponent} label="Opponent" />
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            NBA games still to play this week by players not on the injured list. The Matchup page
            counts only the games that fit your starting slots.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={basketballLeagueHref(leagueId, 'matchup')}
              className={buttonStyles({ variant: 'primary', size: 'sm' })}
            >
              Open matchup
            </Link>
            <Link
              href={basketballLeagueHref(leagueId, 'pickups')}
              className={buttonStyles({ variant: 'outline', size: 'sm' })}
            >
              Find pickups
            </Link>
          </div>
        </>
      ) : (
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {me.players.length === 0
              ? "Add your players and this week's opponent to compare your week."
              : `You have ${me.gamesLeft} ${me.gamesLeft === 1 ? 'game' : 'games'} left this week. Set your opponent to compare.`}
          </p>
          <Link
            href={`${basketballLeagueHref(leagueId, 'roster')}#opponent`}
            className={buttonStyles({ variant: 'primary', size: 'sm' })}
          >
            Set this week&apos;s opponent
          </Link>
        </div>
      )}
    </section>
  );
}

function MyRoster({
  players,
  leagueId,
}: {
  players: BasketballOverviewPlayer[];
  leagueId: string;
}) {
  const rows = [...players].sort(
    (left, right) => Number(left.onInjuredList) - Number(right.onInjuredList)
  );
  return (
    <section aria-labelledby="bb-my-roster-title" className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="bb-my-roster-title" className="font-display text-lg font-bold text-foreground">
          My roster
        </h2>
        <Link
          href={basketballLeagueHref(leagueId, 'roster')}
          className={`${textLinkStyles} text-sm`}
        >
          Manage roster
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          Your roster is empty.{' '}
          <Link href={basketballLeagueHref(leagueId, 'roster')} className={textLinkStyles}>
            Add your players on the Roster page
          </Link>
          .
        </p>
      ) : (
        <div
          role="region"
          aria-label="My roster"
          className="relative overflow-x-auto rounded-lg border border-border bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <table className="w-full min-w-[22rem] table-fixed text-sm">
            <caption className="sr-only">
              My roster with NBA games left and played this week
            </caption>
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Player
                </th>
                <th scope="col" className="w-20 px-3 py-2 text-right font-semibold">
                  Left
                </th>
                <th scope="col" className="w-24 px-3 py-2 text-right font-semibold">
                  This week
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((player) => (
                <tr
                  key={player.playerId}
                  className={`h-14 border-b border-border last:border-b-0 ${player.onInjuredList ? 'bg-muted/40' : ''}`}
                >
                  <th scope="row" className="px-3 text-left font-normal">
                    <PlayerIdentity
                      fullName={player.fullName}
                      teamCode={player.teamCode}
                      positions={player.positions}
                      injury={player.injury}
                      onInjuredList={player.onInjuredList}
                    />
                  </th>
                  <td className="px-3 text-right font-display text-lg font-bold tabular-nums text-foreground">
                    {player.gamesLeft}
                  </td>
                  <td className="px-3 text-right tabular-nums text-muted-foreground">
                    {player.gamesThisWeek}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Injuries({ overview }: { overview: BasketballOverview }) {
  const sides = [overview.me, overview.opponent].flatMap((side) => (side ? [side] : []));
  const injured = sides.flatMap((side) =>
    side.players.flatMap((player) =>
      player.injury ? [{ side, player, injury: player.injury }] : []
    )
  );
  return (
    <section
      aria-labelledby="bb-injuries-title"
      className="rounded-lg border border-border bg-card p-4"
    >
      <h2 id="bb-injuries-title" className="font-display text-lg font-bold text-foreground">
        Injuries
      </h2>
      {injured.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {overview.injuryReport.updatedAt
            ? `No one on ${overview.opponent ? 'either team' : 'your team'} is on the NBA injury report.`
            : 'The NBA injury report has not been loaded yet.'}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {injured.map(({ side, player, injury }) => (
            <li key={player.playerId} className="flex items-start justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {player.fullName}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {[
                    side === overview.me ? 'Your team' : side.name,
                    injury.detail,
                    injury.expectedReturnOn
                      ? `back ${formatEasternDate(injury.expectedReturnOn)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <InjuryBadge injury={injury} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The Overview page body: freshness, this week, my roster with games left, and injuries. */
export function BasketballOverviewView({
  overview,
  leagueId,
  now,
}: {
  overview: BasketballOverview;
  leagueId: string;
  now: Date;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Freshness overview={overview} now={now} />
      <ThisWeek overview={overview} leagueId={leagueId} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <MyRoster players={overview.me.players} leagueId={leagueId} />
        <div className="flex flex-col gap-5">
          <Injuries overview={overview} />
          <nav
            aria-label="More for this league"
            className="rounded-lg border border-border bg-card p-4"
          >
            <h2 className="font-display text-lg font-bold text-foreground">Next</h2>
            <ul className="mt-2 flex flex-col gap-2 text-sm">
              <li>
                <Link href={basketballLeagueHref(leagueId, 'players')} className={textLinkStyles}>
                  Players ranked on your categories
                </Link>
              </li>
              <li>
                <Link href={basketballLeagueHref(leagueId, 'pickups')} className={textLinkStyles}>
                  Free agents who help this week
                </Link>
              </li>
              <li>
                <Link href={basketballLeagueHref(leagueId, 'trade')} className={textLinkStyles}>
                  Check a trade
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </div>
  );
}
