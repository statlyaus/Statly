'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, BarChart3, TrendingUp, Award } from 'lucide-react';
import type { Player } from '@/types/players';
import { getStatColor } from '@/hooks/usePlayerStats';

interface PlayerComparisonProps {
  players: Player[];
  isOpen: boolean;
  onClose: () => void;
  initialPlayers?: Player[];
}

interface ComparisonStat {
  key: string;
  label: string;
  accessor: (player: Player) => number | undefined;
  format?: (value: number) => string;
  category: 'general' | 'scoring' | 'defensive' | 'advanced';
}

const COMPARISON_STATS: ComparisonStat[] = [
  // General Stats
  { key: 'avg', label: 'Average', accessor: (p) => p.avg, format: (v) => v.toFixed(1), category: 'general' },
  { key: 'kicks', label: 'Kicks', accessor: (p) => p.kicks, category: 'general' },
  { key: 'handballs', label: 'Handballs', accessor: (p) => p.handballs, category: 'general' },
  { key: 'disposals', label: 'Disposals', accessor: (p) => (p.kicks || 0) + (p.handballs || 0), category: 'general' },
  
  // Scoring Stats
  { key: 'goals', label: 'Goals', accessor: (p) => p.goals, category: 'scoring' },
  { key: 'inside50s', label: 'Inside 50s', accessor: (p) => p.inside50s, category: 'scoring' },
  
  // Defensive Stats
  { key: 'tackles', label: 'Tackles', accessor: (p) => p.tackles, category: 'defensive' },
  { key: 'rebound50s', label: 'Rebound 50s', accessor: (p) => p.rebound50s, category: 'defensive' },
  
  // Advanced Stats
  { key: 'marks', label: 'Marks', accessor: (p) => p.marks, category: 'advanced' },
  { key: 'contestedPossessions', label: 'Contested Poss.', accessor: (p) => p.contestedPossessions, category: 'advanced' },
  { key: 'hitouts', label: 'Hitouts', accessor: (p) => p.hitouts, category: 'advanced' },
  { key: 'clearances', label: 'Clearances', accessor: (p) => p.clearances, category: 'advanced' },
];

const STAT_CATEGORIES = [
  { key: 'general', label: 'General', icon: BarChart3 },
  { key: 'scoring', label: 'Scoring', icon: Award },
  { key: 'defensive', label: 'Defensive', icon: TrendingUp },
  { key: 'advanced', label: 'Advanced', icon: BarChart3 },
];

export default function PlayerComparison({ players, isOpen, onClose, initialPlayers = [] }: PlayerComparisonProps) {
  const [selectedPlayers, setSelectedPlayers] = useState<Player[]>(initialPlayers.slice(0, 4));
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('general');

  // Filter available players for selection
  const availablePlayers = useMemo(() => {
    return players.filter(player => 
      !selectedPlayers.find(selected => selected.id === player.id) &&
      (searchTerm === '' || 
       player.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
       (player.team && player.team.toLowerCase().includes(searchTerm.toLowerCase())))
    ).slice(0, 10); // Limit to 10 for performance
  }, [players, selectedPlayers, searchTerm]);

  // Get stats for selected category
  const categoryStats = useMemo(() => {
    return COMPARISON_STATS.filter(stat => stat.category === selectedCategory);
  }, [selectedCategory]);

  const addPlayer = (player: Player) => {
    if (selectedPlayers.length < 4) {
      setSelectedPlayers([...selectedPlayers, player]);
      setSearchTerm('');
    }
  };

  const removePlayer = (playerId: string) => {
    setSelectedPlayers(selectedPlayers.filter(p => p.id !== playerId));
  };

  const getBestValue = (statKey: string) => {
    const stat = COMPARISON_STATS.find(s => s.key === statKey);
    if (!stat) return null;
    
    const values = selectedPlayers
      .map(player => stat.accessor(player))
      .filter(val => val !== undefined && val !== null) as number[];
    
    return values.length > 0 ? Math.max(...values) : null;
  };

  const getPlayerStatRank = (player: Player, statKey: string) => {
    const stat = COMPARISON_STATS.find(s => s.key === statKey);
    if (!stat) return 0;
    
    const playerValue = stat.accessor(player);
    if (playerValue === undefined || playerValue === null) return 0;
    
    const values = selectedPlayers
      .map(p => stat.accessor(p))
      .filter(val => val !== undefined && val !== null) as number[];
    
    const sortedValues = [...values].sort((a, b) => b - a);
    return sortedValues.indexOf(playerValue) + 1;
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Player Comparison</h2>
              <p className="text-gray-500 dark:text-gray-400 mt-1">Compare up to 4 players side by side</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
            >
              <X className="w-6 h-6 text-gray-500 dark:text-gray-400" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
            {/* Player Selection */}
            <div className="mb-6">
              <div className="flex flex-wrap gap-3 mb-4">
                {selectedPlayers.map((player) => (
                  <div
                    key={player.id}
                    className="flex items-center bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 px-3 py-2 rounded-full"
                  >
                    <span className="font-medium">{player.name}</span>
                    <span className="ml-2 text-blue-600 dark:text-blue-400">({player.team})</span>
                    <button
                      onClick={() => removePlayer(player.id)}
                      className="ml-2 hover:bg-blue-200 dark:hover:bg-blue-800 rounded-full p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                
                {selectedPlayers.length < 4 && (
                  <div className="flex items-center">
                    <input
                      type="text"
                      placeholder="Search players..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                )}
              </div>

              {/* Available Players */}
              {searchTerm && availablePlayers.length > 0 && selectedPlayers.length < 4 && (
                <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 max-h-32 overflow-y-auto">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {availablePlayers.map((player) => (
                      <button
                        key={player.id}
                        onClick={() => addPlayer(player)}
                        className="flex items-center justify-between p-2 hover:bg-white dark:hover:bg-gray-800 rounded border border-transparent hover:border-gray-200 dark:hover:border-gray-700 text-left"
                      >
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">{player.name}</div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">{player.team} • {player.position}</div>
                        </div>
                        <Plus className="w-4 h-4 text-gray-400" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {selectedPlayers.length >= 2 && (
              <>
                {/* Category Selection */}
                <div className="mb-6">
                  <div className="flex flex-wrap gap-2">
                    {STAT_CATEGORIES.map((category) => {
                      const Icon = category.icon;
                      return (
                        <button
                          key={category.key}
                          onClick={() => setSelectedCategory(category.key)}
                          className={`flex items-center px-4 py-2 rounded-lg font-medium transition-colors ${
                            selectedCategory === category.key
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                              : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                          }`}
                        >
                          <Icon className="w-4 h-4 mr-2" />
                          {category.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Comparison Table */}
                <div className="overflow-x-auto">
                  <table className="w-full border border-gray-200 dark:border-gray-700 rounded-lg">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-900">
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                          Statistic
                        </th>
                        {selectedPlayers.map((player) => (
                          <th key={player.id} className="px-4 py-3 text-center text-sm font-medium text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 min-w-32">
                            <div className="space-y-1">
                              <div className="font-semibold text-gray-900 dark:text-white">{player.name}</div>
                              <div className="text-xs">{player.team}</div>
                              <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                player.position === 'DEF' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
                                player.position === 'MID' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                                player.position === 'FWD' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                                player.position === 'RUC' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' :
                                'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                              }`}>
                                {player.position}
                              </span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {categoryStats.map((stat, index) => {
                        const bestValue = getBestValue(stat.key);
                        return (
                          <tr key={stat.key} className={index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-900'}>
                            <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700">
                              {stat.label}
                            </td>
                            {selectedPlayers.map((player) => {
                              const value = stat.accessor(player);
                              const rank = getPlayerStatRank(player, stat.key);
                              const isBest = value === bestValue && value !== undefined && value !== null;
                              const colorClass = value !== undefined && value !== null && player.position 
                                ? getStatColor(stat.key, value, player.position)
                                : 'text-gray-500 dark:text-gray-400';
                              
                              return (
                                <td key={player.id} className="px-4 py-3 text-center border-b border-gray-200 dark:border-gray-700 relative">
                                  <div className={`text-sm font-medium ${colorClass} ${isBest ? 'font-bold' : ''}`}>
                                    {value !== undefined && value !== null 
                                      ? stat.format ? stat.format(value) : value.toString()
                                      : '-'
                                    }
                                  </div>
                                  {rank <= 3 && value !== undefined && value !== null && (
                                    <div className={`text-xs mt-1 ${
                                      rank === 1 ? 'text-yellow-600 dark:text-yellow-400' :
                                      rank === 2 ? 'text-gray-600 dark:text-gray-400' :
                                      'text-orange-600 dark:text-orange-400'
                                    }`}>
                                      #{rank}
                                    </div>
                                  )}
                                  {isBest && (
                                    <div className="absolute -top-1 -right-1">
                                      <Award className="w-4 h-4 text-yellow-500" />
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {selectedPlayers.length < 2 && (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                <BarChart3 className="w-12 h-12 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
                <p className="text-lg font-medium mb-2">Select at least 2 players to compare</p>
                <p>Use the search box above to find and add players for comparison.</p>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
