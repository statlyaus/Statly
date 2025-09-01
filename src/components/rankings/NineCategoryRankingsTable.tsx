'use client';

import React from 'react';

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
    if (zScore >= 2) return 'text-green-700 bg-green-50';
    if (zScore >= 1) return 'text-green-600 bg-green-100';
    if (zScore >= 0.5) return 'text-blue-600 bg-blue-100';
    if (zScore >= -0.5) return 'text-gray-700 bg-gray-100';
    if (zScore >= -1) return 'text-orange-600 bg-orange-100';
    return 'text-red-600 bg-red-100';
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
    <div className="relative bg-white shadow-sm rounded-lg overflow-hidden">
      <div className="overflow-auto max-h-[80vh]">
        <table className="min-w-full divide-y divide-gray-200">
          <caption className="sr-only">Nine category player rankings table</caption>
          <thead className="bg-gray-50 sticky top-0 z-50 shadow-sm">
            <tr>
              <th
                scope="col"
                className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 sticky top-0"
              >
                Rank
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 sticky top-0"
              >
                Player
              </th>
              <th
                scope="col"
                className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 sticky top-0"
              >
                Team
              </th>
              <th
                scope="col"
                className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 sticky top-0"
              >
                Pos
              </th>
              <th
                scope="col"
                className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 sticky top-0"
              >
                Games
              </th>
              <th
                scope="col"
                className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 sticky top-0"
              >
                Overall
              </th>
              {CATEGORY_COLUMNS.map(([label, key]) => (
                <th
                  key={key}
                  scope="col"
                  className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 sticky top-0"
                >
                  <div>{label}</div>
                  <div className="text-xs opacity-75">avg/z</div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="bg-white divide-y divide-gray-200">
            {players.map((player) => (
              <tr key={player.playerId} className="hover:bg-gray-50">
                <td className="px-3 py-4 whitespace-nowrap">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-800 text-sm font-bold">
                    {player.rank}
                  </span>
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">{player.playerName}</div>
                </td>
                <td className="px-3 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-600">{player.team}</span>
                </td>
                <td className="px-3 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-600">{player.position}</span>
                </td>
                <td className="px-3 py-4 whitespace-nowrap text-center">
                  <span className="text-sm font-medium text-gray-900">{player.games}</span>
                </td>
                <td className="px-3 py-4 whitespace-nowrap text-center">
                  <span className="text-sm font-mono font-bold text-gray-900">
                    {Number.isFinite(player.overall) ? player.overall.toFixed(1) : '0.0'}
                  </span>
                </td>

                {CATEGORY_COLUMNS.map(([_, cat]) => {
                  const perGame = player.categories?.[cat]?.perGame ?? 0;
                  const z = player.categories?.[cat]?.zScore ?? 0;
                  return (
                    <td key={cat} className="px-2 py-4 whitespace-nowrap text-center">
                      <div className={`text-xs px-1 py-1 rounded ${getStatColor(z)}`}>
                        <div className="font-mono font-bold">{perGame.toFixed(1)}</div>
                        <div className="text-xs opacity-75">{getStatIcon(z)}</div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

NineCategoryRankingsTable.displayName = 'NineCategoryRankingsTable';
export default NineCategoryRankingsTable;
