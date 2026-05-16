'use client';

import React from 'react';

import { UITable, tableClasses } from '@/components/ui/table';
import { TeamLogo } from '@/components/TeamLogo';
import { getTeamAbbreviation } from '@/lib/teamLogos';

export type RankingCategory =
  | 'goals'
  | 'goal_assists'
  | 'tackles'
  | 'clearances'
  | 'inside_50s'
  | 'rebound_50s'
  | 'hitouts'
  | 'intercepts'
  | 'marks';

export interface PlayerCategoryRanking {
  playerId: string;
  playerName: string;
  team: string;
  position: string;
  games: number;
  overall: number;
  rank: number;
  categories: Record<
    RankingCategory,
    {
      perGame: number;
      zScore: number;
    }
  >;
}

interface Props {
  players: PlayerCategoryRanking[];
}

// Hoisted category columns to avoid re-creating on each render
export const CATEGORY_COLUMNS: ReadonlyArray<readonly [string, RankingCategory]> = [
  ['G', 'goals'],
  ['GA', 'goal_assists'],
  ['T', 'tackles'],
  ['CL', 'clearances'],
  ['I50', 'inside_50s'],
  ['R50', 'rebound_50s'],
  ['HO', 'hitouts'],
  ['I', 'intercepts'],
  ['M', 'marks'],
];

function NineCategoryRankingsTable({ players }: Props): React.JSX.Element {
  const getStatColor = (zScore: number) => {
    if (zScore >= 2) return 'bg-primary/15 text-primary';
    if (zScore >= 1) return 'bg-primary/10 text-primary';
    if (zScore >= 0.5) return 'bg-accent text-accent-foreground';
    if (zScore >= -0.5) return 'bg-muted text-muted-foreground';
    if (zScore >= -1) return 'bg-destructive/10 text-destructive';
    return 'bg-destructive/15 text-destructive';
  };

  const getStatIcon = (zScore: number) => {
    if (zScore >= 2) return '🔥';
    if (zScore >= 1) return '⭐';
    if (zScore >= 0.5) return '📈';
    if (zScore >= -0.5) return '➖';
    if (zScore >= -1) return '📉';
    return '❌';
  };

  return (
    <div className={tableClasses.container}>
      <div className="overflow-auto max-h-[80vh]">
        <UITable className="min-w-full">
          <caption className="sr-only">Nine category player rankings table</caption>
          <thead className={`${tableClasses.thead} sticky top-0 z-50 shadow-sm`}>
            <tr>
              <th scope="col" className={`${tableClasses.th} bg-muted/40 text-left`}>
                Rank
              </th>
              <th scope="col" className={`${tableClasses.th} bg-muted/40 text-left`}>
                Player
              </th>
              <th scope="col" className={`${tableClasses.th} bg-muted/40 text-left`}>
                Team
              </th>
              <th scope="col" className={`${tableClasses.th} bg-muted/40 text-left`}>
                Pos
              </th>
              <th scope="col" className={`${tableClasses.th} bg-muted/40 text-right`}>
                Games
              </th>
              <th scope="col" className={`${tableClasses.th} bg-muted/40 text-right`}>
                Overall
              </th>
              {CATEGORY_COLUMNS.map(([label, key]) => (
                <th
                  key={key}
                  scope="col"
                  className={`${tableClasses.th} bg-muted/40 px-2 text-center`}
                >
                  <div>{label}</div>
                  <div className="text-xs opacity-75">avg/z</div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className={tableClasses.tbody}>
            {players.length === 0 ? (
              <tr>
                <td
                  colSpan={CATEGORY_COLUMNS.length + 6}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  No rankings available.
                </td>
              </tr>
            ) : (
              players.map((player) => (
                <tr key={player.playerId} className="hover:bg-muted/40">
                  <td className={`${tableClasses.td} whitespace-nowrap`}>
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-bold">
                      {player.rank}
                    </span>
                  </td>
                  <td className={`${tableClasses.td} whitespace-nowrap`}>
                    <div className="font-medium">{player.playerName}</div>
                  </td>
                  <td className={`${tableClasses.td} whitespace-nowrap`}>
                    <span
                      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
                      title={player.team}
                    >
                      <TeamLogo team={player.team} size={16} withCircle decorative />
                      <span>{getTeamAbbreviation(player.team)}</span>
                    </span>
                  </td>
                  <td className={`${tableClasses.td} whitespace-nowrap`}>
                    <span className="text-sm text-muted-foreground">{player.position}</span>
                  </td>
                  <td className={`${tableClasses.tdNumeric} whitespace-nowrap`}>
                    <span className="font-medium">{player.games}</span>
                  </td>
                  <td className={`${tableClasses.tdNumeric} whitespace-nowrap`}>
                    <span className="font-mono font-bold">
                      {Number.isFinite(player.overall) ? player.overall.toFixed(1) : '0.0'}
                    </span>
                  </td>

                  {CATEGORY_COLUMNS.map(([_, cat]) => {
                    const perGame = player.categories?.[cat]?.perGame ?? 0;
                    const z = player.categories?.[cat]?.zScore ?? 0;
                    return (
                      <td key={cat} className={`${tableClasses.tdNumeric} px-2 whitespace-nowrap`}>
                        <div className={`text-xs px-1 py-1 rounded ${getStatColor(z)}`}>
                          <div className="font-mono font-bold">{perGame.toFixed(1)}</div>
                          <div className="text-xs opacity-75">{getStatIcon(z)}</div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </UITable>
      </div>
    </div>
  );
}

NineCategoryRankingsTable.displayName = 'NineCategoryRankingsTable';
export default NineCategoryRankingsTable;
