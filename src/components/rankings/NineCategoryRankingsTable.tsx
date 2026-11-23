'use client';

import React from 'react';

import { FANTASY_CATEGORIES, REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

type RankingCategory = (typeof REAL_DATA_NINE_CATEGORY_PRESET)[number];

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
      /** Null when the player never reported the stat. */
      perGame: number | null;
      zScore: number | null;
    }
  >;
}

interface Props {
  players: PlayerCategoryRanking[];
}

// The league's nine categories, labelled from their definitions.
const CATEGORY_COLUMNS = REAL_DATA_NINE_CATEGORY_PRESET.map((key) => ({
  key,
  label: FANTASY_CATEGORIES[key].label,
  shortLabel: FANTASY_CATEGORIES[key].shortLabel ?? FANTASY_CATEGORIES[key].label,
}));

function NineCategoryRankingsTable({ players }: Props): React.JSX.Element {
  const getStatColor = (zScore: number) => {
    if (zScore >= 2) return 'text-green-700 bg-green-50';
    if (zScore >= 1) return 'text-green-600 bg-green-100';
    if (zScore >= 0.5) return 'text-secondary-foreground bg-secondary';
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
    <div className="relative border border-border bg-white overflow-hidden">
      <div className="overflow-auto max-h-[80vh]">
        <table className="min-w-full divide-y divide-gray-200">
          <caption className="sr-only">Nine category player rankings table</caption>
          <thead className="bg-gray-50 sticky top-0 z-50 border-b-[1.5px] border-foreground">
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
              {CATEGORY_COLUMNS.map(({ key, label, shortLabel }) => (
                <th
                  key={key}
                  scope="col"
                  className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 sticky top-0"
                >
                  <div>
                    <abbr title={label} className="no-underline">
                      {shortLabel}
                    </abbr>
                  </div>
                  <div className="text-xs opacity-75">avg/z</div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="bg-white divide-y divide-gray-200">
            {players.map((player) => (
              <tr key={player.playerId} className="hover:bg-gray-50">
                <td className="px-3 py-4 whitespace-nowrap">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-secondary text-secondary-foreground text-sm font-bold">
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

                {CATEGORY_COLUMNS.map(({ key: cat, label }) => {
                  const perGame = player.categories?.[cat]?.perGame ?? null;
                  const z = player.categories?.[cat]?.zScore ?? null;
                  if (perGame === null || z === null) {
                    // A stat the player never reported is missing, not zero.
                    return (
                      <td key={cat} className="px-2 py-4 whitespace-nowrap text-center">
                        <span className="text-xs text-gray-500" aria-hidden="true">
                          –
                        </span>
                        <span className="sr-only">{label} not reported</span>
                      </td>
                    );
                  }
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
