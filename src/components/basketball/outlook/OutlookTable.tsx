import type { ReactNode } from 'react';

import type { OutlookPlayer } from '@/server/basketball/readModels/roleOutlook';

import { InjuryBadge, OwnerLabel, SortHeaderLink } from '../analysis/AnalysisBits';
import { formatChance, formatPct, formatSigned } from '../analysis/format';
import { driverText } from './OutlookPanels';
import type { OutlookTableView } from './outlookView';

type SortState = 'ascending' | 'descending' | 'none';

interface Column {
  /** The sort key, shared with `SORTS` in outlookView. */
  key: string;
  label: string;
  /** Plain words: the header's tooltip and the sort link's accessible name. */
  name: string;
  width: string;
  cell: (player: OutlookPlayer) => ReactNode;
}

const n1 = (value: number) => value.toFixed(1);

/** A main value with a smaller second line under it. */
function Two({ main, sub, title }: { main: ReactNode; sub: ReactNode; title?: string }) {
  return (
    <>
      <span className="block">{main}</span>
      <span className="block truncate text-xs text-muted-foreground" title={title}>
        {sub}
      </span>
    </>
  );
}

const STATS = [
  { key: 'pts', label: 'PTS', name: 'points' },
  { key: 'fg3m', label: '3PM', name: 'threes made' },
  { key: 'reb', label: 'REB', name: 'rebounds' },
  { key: 'ast', label: 'AST', name: 'assists' },
  { key: 'stl', label: 'STL', name: 'steals' },
  { key: 'blk', label: 'BLK', name: 'blocks' },
  { key: 'tov', label: 'TO', name: 'turnovers' },
] as const;

function statColumns(
  per: string,
  line: (player: OutlookPlayer) => OutlookPlayer['next5' | 'restOfSeason']
): Column[] {
  return [
    ...STATS.map((stat) => ({
      key: stat.key,
      label: stat.label,
      name: `${stat.name} a game, ${per}`,
      width: 'w-14',
      cell: (player: OutlookPlayer) => n1(line(player).stats[stat.key]),
    })),
    {
      key: 'fgPct',
      label: 'FG%',
      name: `field goal percentage, ${per}`,
      width: 'w-16',
      cell: (player) => formatPct(line(player).fgPct),
    },
    {
      key: 'ftPct',
      label: 'FT%',
      name: `free throw percentage, ${per}`,
      width: 'w-16',
      cell: (player) => formatPct(line(player).ftPct),
    },
  ];
}

function injuryShift(player: OutlookPlayer) {
  const { injuryMinutesShift: shift, drivers } = player.role;
  const named = drivers.map(driverText).join('; ');
  if (shift === 0 && !named) return <span className="text-muted-foreground">–</span>;
  return <Two main={formatSigned(shift)} sub={named || '–'} title={named || undefined} />;
}

const NEXT5_COLUMNS: Column[] = [
  {
    key: 'gp',
    label: 'GP',
    name: 'games played for his team',
    width: 'w-12',
    cell: (p) => p.role.gamesPlayed,
  },
  {
    key: 'minL5',
    label: 'MIN L5',
    name: 'minutes a game, last 5',
    width: 'w-16',
    cell: (p) => n1(p.role.minutesLast5),
  },
  {
    key: 'min',
    label: 'MIN next 5',
    name: 'minutes a game, next 5 (change, and the range he lands in 8 times in 10)',
    width: 'w-28',
    cell: (p) => (
      <Two
        main={n1(p.role.minutesNext5)}
        sub={
          <>
            {formatSigned(p.role.minutesChange)} · {n1(p.role.minutesRange80.low)}–
            {n1(p.role.minutesRange80.high)}
          </>
        }
      />
    ),
  },
  {
    key: 'up3',
    label: 'P(+3)',
    name: 'chance of 3 or more extra minutes a game',
    width: 'w-16',
    cell: (p) => formatChance(p.role.chanceMinutesUp3),
  },
  {
    key: 'down3',
    label: 'P(−3)',
    name: 'chance of 3 or more fewer minutes a game',
    width: 'w-16',
    cell: (p) => formatChance(p.role.chanceMinutesDown3),
  },
  {
    key: 'usg',
    label: 'USG% next 5',
    name: 'usage rate, next 5 (last 5 under it)',
    width: 'w-20',
    cell: (p) => <Two main={n1(p.role.usageNext5)} sub={`L5 ${n1(p.role.usageLast5)}`} />,
  },
  {
    key: 'usage',
    label: 'Usage next 5',
    name: 'total usage, next 5: usage rate × minutes ÷ 48 (change under it)',
    width: 'w-20',
    cell: (p) => (
      <Two main={n1(p.role.totalUsageNext5)} sub={formatSigned(p.role.totalUsageChange)} />
    ),
  },
  {
    key: 'shift',
    label: 'Injury shift',
    name: 'minutes a game from teammates newly out or coming back',
    width: 'w-40',
    cell: injuryShift,
  },
  {
    key: 'bigger',
    label: 'Bigger role',
    name: 'games in a row in a bigger role',
    width: 'w-16',
    cell: (p) => p.role.biggerRoleGames,
  },
  {
    key: 'games',
    label: 'Games next 5',
    name: "expected games in his team's next 5 (back-to-backs and the chance he sits one)",
    width: 'w-24',
    cell: (p) => (
      <Two
        main={n1(p.next5.expectedGames)}
        sub={
          p.next5.backToBacks > 0
            ? `${p.next5.backToBacks} B2B · ${formatChance(p.next5.chanceSitsBackToBack)} sit`
            : 'No B2B'
        }
      />
    ),
  },
  {
    key: 'week',
    label: 'This week',
    name: 'expected games left in this fantasy week',
    width: 'w-16',
    cell: (p) => n1(p.expectedGamesThisWeek),
  },
  ...statColumns('next 5', (p) => p.next5),
  {
    key: 'opp',
    label: 'Opp def',
    name: 'points his next 5 opponents allow against average',
    width: 'w-16',
    cell: (p) => `${formatSigned(p.next5.oppDefence)}%`,
  },
];

const ROS_COLUMNS: Column[] = [
  {
    key: 'min',
    label: 'MIN',
    name: 'minutes a game played, rest of season',
    width: 'w-16',
    cell: (p) => n1(p.restOfSeason.minutes),
  },
  {
    key: 'shift',
    label: 'Teammate shift',
    name: 'minutes a game from teammates expected to miss games',
    width: 'w-20',
    cell: (p) => formatSigned(p.restOfSeason.teammateShift),
  },
  {
    key: 'games',
    label: 'Games',
    name: 'expected games played, rest of season',
    width: 'w-16',
    cell: (p) => n1(p.restOfSeason.expectedGames),
  },
  {
    key: 'left',
    label: 'Team left',
    name: "his team's games left",
    width: 'w-16',
    cell: (p) => p.restOfSeason.teamGamesLeft,
  },
  ...statColumns('rest of season', (p) => p.restOfSeason),
];

const VIEWS: Record<OutlookTableView, { columns: Column[]; width: string; caption: string }> = {
  NEXT5: {
    columns: NEXT5_COLUMNS,
    width: 'min-w-[112rem] sm:min-w-[115rem]',
    caption:
      "Each player's predicted minutes, usage, injury shift, games and stats over his team's next 5 games.",
  },
  ROS: {
    columns: ROS_COLUMNS,
    width: 'min-w-[69rem] sm:min-w-[72rem]',
    caption: "Each player's predicted minutes, games and stats a game for the rest of the season.",
  },
};

export function OutlookTable({
  players,
  view,
  injuriesStale,
  sortHref,
  sortState,
}: {
  players: OutlookPlayer[];
  view: OutlookTableView;
  injuriesStale: boolean;
  sortHref: (key: string) => string;
  sortState: (key: string) => SortState;
}) {
  const { columns, width, caption } = VIEWS[view];
  const number = 'px-2 text-right tabular-nums text-foreground';

  return (
    <div
      role="region"
      aria-label="Outlook table"
      className="relative max-h-[70vh] overflow-auto rounded-lg border border-border bg-card"
    >
      <table className={`w-full table-fixed text-sm ${width}`}>
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-20 bg-card">
          <tr className="border-b border-border text-xs text-muted-foreground">
            <SortHeaderLink
              href={sortHref('name')}
              label="name"
              state={sortState('name')}
              className="sticky left-0 z-20 w-44 bg-card text-left shadow-[1px_0_0_0_var(--border)] sm:w-56"
              align="left"
            >
              Player
            </SortHeaderLink>
            <th scope="col" className="w-32 px-2 py-2 text-left font-semibold">
              Owner
            </th>
            {columns.map((column) => (
              <SortHeaderLink
                key={column.key}
                href={sortHref(column.key)}
                label={column.name}
                state={sortState(column.key)}
                className={column.width}
              >
                <abbr title={column.name}>{column.label}</abbr>
              </SortHeaderLink>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map((player) => {
            const mine = player.owner.kind === 'MINE';
            const rowBg = mine ? 'bg-accent' : 'bg-card';
            return (
              <tr
                key={player.playerId}
                className={`h-14 border-b border-border ${rowBg}`}
                aria-label={mine ? `${player.fullName} (your player)` : undefined}
              >
                <th
                  scope="row"
                  className={`sticky left-0 z-10 px-2 text-left font-normal shadow-[1px_0_0_0_var(--border)] ${rowBg}`}
                >
                  <span className="block truncate font-semibold text-foreground">
                    {player.fullName}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="truncate">
                      {player.teamCode} · {player.positions.join('/') || '–'}
                    </span>
                    <InjuryBadge
                      injury={player.injury}
                      seasonEnding={player.injury?.seasonEnding}
                      stale={injuriesStale}
                    />
                  </span>
                </th>
                <td className="px-2">
                  <span className="flex min-w-0">
                    <OwnerLabel owner={player.owner} />
                  </span>
                </td>
                {columns.map((column) => (
                  <td key={column.key} className={number}>
                    {column.cell(player)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
