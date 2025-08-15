'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';

interface PlayerRow {
  id: string;
  name: string;
  team?: string;
  position?: string;
  totalValue: number;
  rank: number;
}

interface RankingsTableProps {
  players: PlayerRow[];
}

export function RankingsTable({ players }: RankingsTableProps) {
  const sortedPlayers = useMemo(() => {
    return [...players].sort((a, b) => a.rank - b.rank);
  }, [players]);

  const getRowHighlight = (rank: number) => {
    if (rank === 1)
      return 'bg-gradient-to-r from-amber-50 to-yellow-50 border-l-4 border-amber-400';
    if (rank <= 3)
      return 'bg-gradient-to-r from-emerald-50 to-green-50 border-l-4 border-emerald-400';
    if (rank <= 10) return 'bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-400';
    if (rank <= 25)
      return 'bg-gradient-to-r from-purple-50 to-violet-50 border-l-4 border-purple-400';
    return 'hover:bg-gray-50';
  };

  const getRankBadge = (rank: number) => {
    if (rank === 1) return 'bg-gradient-to-r from-amber-400 to-yellow-500 text-white';
    if (rank <= 3) return 'bg-gradient-to-r from-emerald-400 to-green-500 text-white';
    if (rank <= 10) return 'bg-gradient-to-r from-blue-400 to-indigo-500 text-white';
    if (rank <= 25) return 'bg-gradient-to-r from-purple-400 to-violet-500 text-white';
    return 'bg-gray-100 text-gray-700';
  };

  const getTotalValueColor = (rank: number) => {
    if (rank === 1) return 'text-amber-700 font-bold';
    if (rank <= 3) return 'text-emerald-700 font-semibold';
    if (rank <= 10) return 'text-blue-700 font-medium';
    if (rank <= 25) return 'text-purple-700';
    return 'text-gray-900';
  };

  return (
    <div className="overflow-x-auto bg-white rounded-lg shadow-sm border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
          <tr>
            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
              Rank
            </th>
            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
              Player
            </th>
            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
              Team
            </th>
            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
              Position
            </th>
            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
              Total Value
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {sortedPlayers.map((player, index) => (
            <motion.tr
              key={player.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.02 }}
              className={`transition-all duration-200 ${getRowHighlight(player.rank)}`}
            >
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <span
                    className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${getRankBadge(player.rank)}`}
                  >
                    {player.rank}
                  </span>
                  {player.rank === 1 && <span className="ml-2 text-amber-500">🏆</span>}
                  {player.rank === 2 && <span className="ml-2 text-gray-400">🥈</span>}
                  {player.rank === 3 && <span className="ml-2 text-amber-600">🥉</span>}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm font-semibold text-gray-900">{player.name}</div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                  {player.team || '-'}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className="text-sm text-gray-600 font-medium">{player.position || '-'}</span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <span className={`text-sm font-mono ${getTotalValueColor(player.rank)}`}>
                    {player.totalValue.toFixed(2)}
                  </span>
                  {player.rank <= 10 && (
                    <div className="ml-2">
                      <div
                        className={`w-16 h-2 rounded-full bg-gradient-to-r ${
                          player.rank === 1
                            ? 'from-amber-200 to-amber-400'
                            : player.rank <= 3
                              ? 'from-emerald-200 to-emerald-400'
                              : 'from-blue-200 to-blue-400'
                        }`}
                      >
                        <div
                          className={`h-full rounded-full ${
                            player.rank === 1
                              ? 'bg-amber-500'
                              : player.rank <= 3
                                ? 'bg-emerald-500'
                                : 'bg-blue-500'
                          }`}
                          style={{
                            width: `${Math.max(20, Math.min(100, (player.totalValue / Math.max(...sortedPlayers.map((p) => p.totalValue))) * 100))}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>

      {/* Legend */}
      <div className="bg-gray-50 px-6 py-3 border-t border-gray-200">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-gradient-to-r from-amber-400 to-yellow-500"></div>
            <span className="text-gray-600">Rank #1</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-gradient-to-r from-emerald-400 to-green-500"></div>
            <span className="text-gray-600">Top 3</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-gradient-to-r from-blue-400 to-indigo-500"></div>
            <span className="text-gray-600">Top 10</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-gradient-to-r from-purple-400 to-violet-500"></div>
            <span className="text-gray-600">Top 25</span>
          </div>
        </div>
      </div>
    </div>
  );
}
