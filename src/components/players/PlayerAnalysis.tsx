'use client';

import React, { useState, useMemo } from 'react';

import {
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  ArrowsUpDownIcon,
} from '@heroicons/react/24/outline';
import { motion, AnimatePresence } from 'framer-motion';

// Types
interface PlayerStats {
  disposals: number;
  kicks: number;
  handballs: number;
  marks: number;
  tackles: number;
  goals: number;
  behinds: number;
  hitouts?: number;
  interceptMarks?: number;
  rebounds?: number;
}

interface Player {
  id: string;
  name: string;
  position: string;
  team: string;
  averageScore: number;
  price: number;
  priceChange: number;
  ownership: number;
  form: number[];
  projectedScore: number;
  seasonStats: PlayerStats;
  recentGames: Array<{
    round: number;
    opponent: string;
    score: number;
    stats: PlayerStats;
  }>;
  injuryStatus: 'healthy' | 'questionable' | 'injured';
  upcomingFixtures: Array<{
    round: number;
    opponent: string;
    difficulty: 1 | 2 | 3 | 4 | 5;
  }>;
  trends: {
    priceChangePercent: number;
    ownershipChange: number;
    formTrend: 'rising' | 'falling' | 'stable';
  };
}

interface PlayerAnalysisProps {
  players?: Player[];
  onPlayerSelect?: (player: Player) => void;
  showComparison?: boolean;
}

// Mock data
const mockPlayers: Player[] = [
  {
    id: '1',
    name: 'Marcus Bontempelli',
    position: 'MID',
    team: 'Western Bulldogs',
    averageScore: 118,
    price: 850000,
    priceChange: 12000,
    ownership: 67,
    form: [142, 98, 135, 110, 128, 145, 89],
    projectedScore: 115,
    seasonStats: {
      disposals: 28.5,
      kicks: 18.2,
      handballs: 10.3,
      marks: 6.8,
      tackles: 4.2,
      goals: 0.8,
      behinds: 0.4,
    },
    recentGames: [
      {
        round: 12,
        opponent: 'Richmond',
        score: 142,
        stats: {
          disposals: 32,
          kicks: 20,
          handballs: 12,
          marks: 8,
          tackles: 5,
          goals: 2,
          behinds: 1,
        },
      },
      {
        round: 11,
        opponent: 'Carlton',
        score: 98,
        stats: {
          disposals: 24,
          kicks: 15,
          handballs: 9,
          marks: 5,
          tackles: 3,
          goals: 0,
          behinds: 2,
        },
      },
    ],
    injuryStatus: 'healthy',
    upcomingFixtures: [
      { round: 13, opponent: 'Geelong', difficulty: 4 },
      { round: 14, opponent: 'North Melbourne', difficulty: 2 },
    ],
    trends: {
      priceChangePercent: 1.4,
      ownershipChange: 2.3,
      formTrend: 'rising',
    },
  },
  {
    id: '2',
    name: 'Max Gawn',
    position: 'RUC',
    team: 'Melbourne',
    averageScore: 108,
    price: 720000,
    priceChange: -8000,
    ownership: 45,
    form: [89, 125, 92, 118, 102, 134, 76],
    projectedScore: 105,
    seasonStats: {
      disposals: 18.2,
      kicks: 12.1,
      handballs: 6.1,
      marks: 5.4,
      tackles: 2.8,
      goals: 0.6,
      behinds: 0.3,
      hitouts: 38.5,
    },
    recentGames: [
      {
        round: 12,
        opponent: 'Hawthorn',
        score: 89,
        stats: {
          disposals: 16,
          kicks: 10,
          handballs: 6,
          marks: 4,
          tackles: 2,
          goals: 1,
          behinds: 0,
          hitouts: 42,
        },
      },
    ],
    injuryStatus: 'healthy',
    upcomingFixtures: [
      { round: 13, opponent: 'Brisbane', difficulty: 3 },
      { round: 14, opponent: 'Sydney', difficulty: 5 },
    ],
    trends: {
      priceChangePercent: -1.1,
      ownershipChange: -0.8,
      formTrend: 'stable',
    },
  },
];

export default function PlayerAnalysis({
  players = mockPlayers,
  onPlayerSelect,
}: PlayerAnalysisProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterPosition, setFilterPosition] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'score' | 'price' | 'ownership' | 'form'>('score');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedPlayers, setSelectedPlayers] = useState<Player[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'comparison'>('list');

  // Filter and sort players
  const filteredPlayers = useMemo(() => {
    let filtered = players.filter((player) => {
      const matchesSearch =
        player.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        player.team.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesPosition = filterPosition === 'all' || player.position === filterPosition;
      return matchesSearch && matchesPosition;
    });

    // Sort players
    filtered.sort((a, b) => {
      let aValue: number, bValue: number;

      switch (sortBy) {
        case 'score':
          aValue = a.averageScore;
          bValue = b.averageScore;
          break;
        case 'price':
          aValue = a.price;
          bValue = b.price;
          break;
        case 'ownership':
          aValue = a.ownership;
          bValue = b.ownership;
          break;
        case 'form':
          aValue = a.form.slice(-3).reduce((sum, score) => sum + score, 0) / 3;
          bValue = b.form.slice(-3).reduce((sum, score) => sum + score, 0) / 3;
          break;
        default:
          return 0;
      }

      return sortOrder === 'desc' ? bValue - aValue : aValue - bValue;
    });

    return filtered;
  }, [players, searchTerm, filterPosition, sortBy, sortOrder]);

  const getPositionColor = (position: string) => {
    switch (position) {
      case 'FWD':
        return 'bg-red-100 text-red-800';
      case 'MID':
        return 'bg-green-100 text-green-800';
      case 'DEF':
        return 'bg-blue-100 text-blue-800';
      case 'RUC':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getFormTrendIcon = (trend: string) => {
    switch (trend) {
      case 'rising':
        return <ArrowTrendingUpIcon className="w-4 h-4 text-green-500" />;
      case 'falling':
        return <ArrowTrendingDownIcon className="w-4 h-4 text-red-500" />;
      default:
        return <div className="w-4 h-4 bg-gray-300 rounded-full" />;
    }
  };

  const getDifficultyColor = (difficulty: number) => {
    switch (difficulty) {
      case 1:
        return 'bg-green-500';
      case 2:
        return 'bg-lime-500';
      case 3:
        return 'bg-yellow-500';
      case 4:
        return 'bg-orange-500';
      case 5:
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const togglePlayerSelection = (player: Player) => {
    if (selectedPlayers.find((p) => p.id === player.id)) {
      setSelectedPlayers(selectedPlayers.filter((p) => p.id !== player.id));
    } else if (selectedPlayers.length < 3) {
      setSelectedPlayers([...selectedPlayers, player]);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Player Analysis</h1>
          <p className="text-gray-600 mt-1">Advanced player statistics and comparisons</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('list')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              viewMode === 'list'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            List View
          </button>
          <button
            onClick={() => setViewMode('comparison')}
            disabled={selectedPlayers.length < 2}
            className={`px-4 py-2 rounded-lg transition-colors ${
              viewMode === 'comparison' && selectedPlayers.length >= 2
                ? 'bg-blue-600 text-white'
                : selectedPlayers.length < 2
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Compare ({selectedPlayers.length})
          </button>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search players..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="relative">
            <FunnelIcon className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <select
              value={filterPosition}
              onChange={(e) => setFilterPosition(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none"
            >
              <option value="all">All Positions</option>
              <option value="FWD">Forwards</option>
              <option value="MID">Midfielders</option>
              <option value="DEF">Defenders</option>
              <option value="RUC">Rucks</option>
            </select>
          </div>

          <div className="relative">
            <ArrowsUpDownIcon className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none"
            >
              <option value="score">Average Score</option>
              <option value="price">Price</option>
              <option value="ownership">Ownership</option>
              <option value="form">Recent Form</option>
            </select>
          </div>

          <button
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            {sortOrder === 'desc' ? '↓' : '↑'}{' '}
            {sortOrder === 'desc' ? 'High to Low' : 'Low to High'}
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {viewMode === 'list' ? (
          <motion.div
            key="list"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-white rounded-xl shadow-lg overflow-hidden"
          >
            <div className="grid grid-cols-12 gap-4 p-4 bg-gray-50 text-sm font-medium text-gray-600">
              <div className="col-span-3">Player</div>
              <div className="col-span-2">Avg Score</div>
              <div className="col-span-2">Price</div>
              <div className="col-span-1">Own%</div>
              <div className="col-span-2">Form</div>
              <div className="col-span-1">Trend</div>
              <div className="col-span-1">Action</div>
            </div>

            {filteredPlayers.map((player, index) => {
              const recentForm = player.form.slice(-3).reduce((sum, score) => sum + score, 0) / 3;
              const isSelected = selectedPlayers.find((p) => p.id === player.id);

              return (
                <motion.div
                  key={player.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={`grid grid-cols-12 gap-4 p-4 border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${
                    isSelected ? 'bg-blue-50 border-blue-200' : ''
                  }`}
                  onClick={() => onPlayerSelect?.(player)}
                >
                  <div className="col-span-3">
                    <div className="flex items-center gap-2">
                      <div>
                        <div className="font-medium text-gray-900">{player.name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${getPositionColor(player.position)}`}
                          >
                            {player.position}
                          </span>
                          <span className="text-sm text-gray-600">{player.team}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="col-span-2">
                    <div className="font-medium text-gray-900">{player.averageScore}</div>
                    <div className="text-sm text-gray-500">Proj: {player.projectedScore}</div>
                  </div>

                  <div className="col-span-2">
                    <div className="font-medium text-gray-900">
                      ${(player.price / 1000).toFixed(0)}k
                    </div>
                    <div
                      className={`text-sm ${
                        player.priceChange > 0
                          ? 'text-green-600'
                          : player.priceChange < 0
                            ? 'text-red-600'
                            : 'text-gray-500'
                      }`}
                    >
                      {player.priceChange > 0 ? '+' : ''}${(player.priceChange / 1000).toFixed(0)}k
                    </div>
                  </div>

                  <div className="col-span-1">
                    <div className="font-medium text-gray-900">{player.ownership}%</div>
                  </div>

                  <div className="col-span-2">
                    <div className="font-medium text-gray-900">{recentForm.toFixed(1)}</div>
                    <div className="flex gap-1 mt-1">
                      {player.form.slice(-5).map((score, i) => (
                        <div
                          key={i}
                          className={`w-2 h-2 rounded-full ${
                            score > player.averageScore
                              ? 'bg-green-500'
                              : score < player.averageScore * 0.8
                                ? 'bg-red-500'
                                : 'bg-yellow-500'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="col-span-1">{getFormTrendIcon(player.trends.formTrend)}</div>

                  <div className="col-span-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePlayerSelection(player);
                      }}
                      className={`w-6 h-6 rounded border-2 transition-colors ${
                        isSelected
                          ? 'bg-blue-600 border-blue-600'
                          : 'border-gray-300 hover:border-blue-400'
                      }`}
                    >
                      {isSelected && <span className="text-white text-xs">✓</span>}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        ) : (
          <motion.div
            key="comparison"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-white rounded-xl shadow-lg p-6"
          >
            <h3 className="text-lg font-semibold text-gray-900 mb-6">Player Comparison</h3>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {selectedPlayers.map((player) => (
                <div key={player.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="text-center mb-4">
                    <h4 className="font-semibold text-gray-900">{player.name}</h4>
                    <div className="flex items-center justify-center gap-2 mt-1">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${getPositionColor(player.position)}`}
                      >
                        {player.position}
                      </span>
                      <span className="text-sm text-gray-600">{player.team}</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Avg Score</span>
                      <span className="font-medium">{player.averageScore}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Price</span>
                      <span className="font-medium">${(player.price / 1000).toFixed(0)}k</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Ownership</span>
                      <span className="font-medium">{player.ownership}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Disposals</span>
                      <span className="font-medium">{player.seasonStats.disposals}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Marks</span>
                      <span className="font-medium">{player.seasonStats.marks}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Goals</span>
                      <span className="font-medium">{player.seasonStats.goals}</span>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="text-sm text-gray-600 mb-2">Upcoming Fixtures</div>
                    <div className="space-y-1">
                      {player.upcomingFixtures.slice(0, 2).map((fixture, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span>
                            R{fixture.round} vs {fixture.opponent}
                          </span>
                          <div
                            className={`w-3 h-3 rounded-full ${getDifficultyColor(fixture.difficulty)}`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
