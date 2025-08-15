// Enhanced Player Analysis with Live Data Integration
// This demonstrates migrating from mock data to live Firebase data

'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MagnifyingGlassIcon,
  ArrowsUpDownIcon,
  SignalIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useLiveData } from '@/hooks/useLiveData';

// Enhanced types to work with both legacy and ETL data
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
  price?: number;
  priceChange?: number;
  ownership?: number;
  form?: number[];
  projectedScore?: number;
  seasonStats: PlayerStats;
  recentGames?: Array<{
    round: number;
    opponent: string;
    score: number;
    stats: PlayerStats;
  }>;
  injuryStatus?: 'healthy' | 'questionable' | 'injured';
  upcomingFixtures?: Array<{
    round: number;
    opponent: string;
    difficulty: 1 | 2 | 3 | 4 | 5;
  }>;
  trends?: {
    priceChangePercent: number;
    ownershipChange: number;
    formTrend: 'rising' | 'falling' | 'stable';
  };
  // ETL data fields
  fantasyScore: number;
  round: number;
  season: number;
  lastUpdated: string;
  source: string;
}

interface PlayerAnalysisWithLiveDataProps {
  onPlayerSelect?: (player: Player) => void;
  showComparison?: boolean;
}

export default function PlayerAnalysisWithLiveData({
  onPlayerSelect,
  showComparison = true,
}: PlayerAnalysisWithLiveDataProps) {
  // Live data integration
  const { playerStats, liveMatches, isLoading, error, lastUpdate, isLive } = useLiveData();

  // Local state
  const [selectedPlayers, setSelectedPlayers] = useState<Player[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [positionFilter, setPositionFilter] = useState<string>('all');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'fantasyScore' | 'name' | 'team' | 'lastUpdated'>(
    'fantasyScore'
  );
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [viewMode, setViewMode] = useState<'analysis' | 'comparison'>('analysis');

  // Transform ETL data to component format
  const transformedPlayers: Player[] = useMemo(() => {
    return playerStats.map((stat) => ({
      id: stat.id,
      name: stat.name,
      position: stat.position,
      team: stat.team,
      averageScore: stat.fantasyScore,
      fantasyScore: stat.fantasyScore,
      round: stat.round,
      season: stat.season,
      lastUpdated: stat.lastUpdated,
      source: stat.source,
      seasonStats: {
        disposals: stat.disposals,
        kicks: stat.kicks,
        handballs: stat.handballs,
        marks: stat.marks,
        tackles: stat.tackles,
        goals: stat.goals,
        behinds: stat.behinds,
        hitouts: stat.hitouts || 0,
        interceptMarks: stat.contested_possessions || 0,
        rebounds: stat.rebound50s || 0,
      },
      // Default values for optional fields
      price: 500000,
      priceChange: 0,
      ownership: 50,
      form: [stat.fantasyScore],
      projectedScore: stat.fantasyScore,
      injuryStatus: 'healthy' as const,
      recentGames: [
        {
          round: stat.round,
          opponent: 'TBD',
          score: stat.fantasyScore,
          stats: {
            disposals: stat.disposals,
            kicks: stat.kicks,
            handballs: stat.handballs,
            marks: stat.marks,
            tackles: stat.tackles,
            goals: stat.goals,
            behinds: stat.behinds,
            hitouts: stat.hitouts || 0,
          },
        },
      ],
      upcomingFixtures: [],
      trends: {
        priceChangePercent: 0,
        ownershipChange: 0,
        formTrend: 'stable' as const,
      },
    }));
  }, [playerStats]);

  // Filter and sort players
  const filteredPlayers = useMemo(() => {
    let filtered = transformedPlayers.filter((player) => {
      const matchesSearch =
        player.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        player.team.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesPosition = positionFilter === 'all' || player.position === positionFilter;
      const matchesTeam = teamFilter === 'all' || player.team === teamFilter;

      return matchesSearch && matchesPosition && matchesTeam;
    });

    filtered.sort((a, b) => {
      let aValue: number | string = a[sortBy];
      let bValue: number | string = b[sortBy];

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortOrder === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
      }

      // Ensure both values are numbers for arithmetic operations
      const aNum = Number(aValue);
      const bNum = Number(bValue);

      return sortOrder === 'asc' ? aNum - bNum : bNum - aNum;
    });

    return filtered;
  }, [transformedPlayers, searchTerm, positionFilter, teamFilter, sortBy, sortOrder]);

  // Get unique teams and positions for filters
  const teams = useMemo(
    () => [...new Set(transformedPlayers.map((p) => p.team))].sort(),
    [transformedPlayers]
  );

  const positions = useMemo(
    () => [...new Set(transformedPlayers.map((p) => p.position))].sort(),
    [transformedPlayers]
  );

  const togglePlayerSelection = (player: Player) => {
    if (selectedPlayers.find((p) => p.id === player.id)) {
      setSelectedPlayers(selectedPlayers.filter((p) => p.id !== player.id));
    } else {
      setSelectedPlayers([...selectedPlayers, player]);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header with Live Data Status */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-4xl font-bold text-white mb-4">Player Analysis {isLive && '🔴'}</h1>
            <p className="text-xl text-slate-300">
              Advanced analytics powered by {isLive ? 'live' : 'historical'} data
            </p>
          </div>

          {/* Live Data Status Indicator */}
          <div
            className={`p-4 rounded-lg ${
              isLive
                ? 'bg-green-900/50 border border-green-500'
                : 'bg-slate-800/50 border border-slate-600'
            }`}
          >
            <div className="flex items-center space-x-2">
              <SignalIcon className={`w-5 h-5 ${isLive ? 'text-green-400' : 'text-slate-400'}`} />
              <div>
                <p className="text-white font-medium">{isLive ? 'Live Data' : 'Historical Data'}</p>
                {lastUpdate && (
                  <p className="text-slate-300 text-sm">
                    Updated: {new Date(lastUpdate).toLocaleTimeString()}
                  </p>
                )}
                <p className="text-slate-400 text-xs">{transformedPlayers.length} players loaded</p>
              </div>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-12">
            <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-slate-300">Loading player data from Firebase...</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-900/50 border border-red-500 p-4 rounded-lg mb-6">
            <div className="flex items-center space-x-2">
              <ExclamationTriangleIcon className="w-5 h-5 text-red-400" />
              <p className="text-red-200">
                <strong>Error loading data:</strong> {error}
              </p>
            </div>
          </div>
        )}

        {!isLoading && !error && (
          <>
            {/* Controls */}
            <div className="bg-slate-800/50 rounded-lg p-6 mb-6 backdrop-blur-sm">
              {/* View Mode Toggle */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex space-x-2">
                  <button
                    onClick={() => setViewMode('analysis')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      viewMode === 'analysis'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    Analysis
                  </button>
                  {showComparison && (
                    <button
                      onClick={() => setViewMode('comparison')}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        viewMode === 'comparison'
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      Compare ({selectedPlayers.length})
                    </button>
                  )}
                </div>

                {/* Live Match Indicator */}
                {liveMatches.length > 0 && (
                  <div className="bg-green-900/50 border border-green-500 px-3 py-1 rounded-lg">
                    <span className="text-green-300 text-sm">
                      🏈 {liveMatches.length} live match{liveMatches.length !== 1 ? 'es' : ''}
                    </span>
                  </div>
                )}
              </div>

              {/* Search and Filters */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* Search */}
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search players..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Position Filter */}
                <select
                  value={positionFilter}
                  onChange={(e) => setPositionFilter(e.target.value)}
                  className="px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Positions</option>
                  {positions.map((position) => (
                    <option key={position} value={position}>
                      {position}
                    </option>
                  ))}
                </select>

                {/* Team Filter */}
                <select
                  value={teamFilter}
                  onChange={(e) => setTeamFilter(e.target.value)}
                  className="px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Teams</option>
                  {teams.map((team) => (
                    <option key={team} value={team}>
                      {team}
                    </option>
                  ))}
                </select>

                {/* Sort By */}
                <select
                  value={sortBy}
                  onChange={(e) =>
                    setSortBy(e.target.value as 'fantasyScore' | 'name' | 'team' | 'lastUpdated')
                  }
                  className="px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="fantasyScore">Fantasy Score</option>
                  <option value="name">Name</option>
                  <option value="team">Team</option>
                  <option value="lastUpdated">Last Updated</option>
                </select>

                {/* Sort Order */}
                <button
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  className="flex items-center justify-center px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <ArrowsUpDownIcon className="w-4 h-4 mr-2" />
                  {sortOrder === 'asc' ? 'Asc' : 'Desc'}
                </button>
              </div>
            </div>

            {/* Player Grid/List */}
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredPlayers.slice(0, 12).map((player) => {
                const isSelected = selectedPlayers.find((p) => p.id === player.id);

                return (
                  <motion.div
                    key={player.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`bg-slate-800/50 rounded-lg p-6 backdrop-blur-sm border-2 transition-all cursor-pointer ${
                      isSelected
                        ? 'border-blue-500 bg-blue-900/30'
                        : 'border-slate-700 hover:border-slate-600'
                    }`}
                    onClick={() => {
                      togglePlayerSelection(player);
                      onPlayerSelect?.(player);
                    }}
                  >
                    {/* Player Header */}
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-bold text-white">{player.name}</h3>
                        <p className="text-slate-300">
                          {player.position} • {player.team}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-blue-400">{player.fantasyScore}</p>
                        <p className="text-slate-400 text-sm">Fantasy Score</p>
                      </div>
                    </div>

                    {/* Key Stats */}
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <p className="text-slate-400 text-sm">Disposals</p>
                        <p className="text-white font-medium">{player.seasonStats.disposals}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 text-sm">Goals</p>
                        <p className="text-white font-medium">{player.seasonStats.goals}</p>
                      </div>
                    </div>

                    {/* Data Source Info */}
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500">
                        Round {player.round} • {player.source}
                      </span>
                      <span className="text-slate-500">
                        {new Date(player.lastUpdated).toLocaleDateString()}
                      </span>
                    </div>

                    {/* Selection Indicator */}
                    {isSelected && (
                      <div className="mt-3 p-2 bg-blue-600/50 rounded-lg">
                        <p className="text-blue-200 text-sm text-center">Selected for comparison</p>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>

            {/* Comparison View */}
            <AnimatePresence>
              {viewMode === 'comparison' && selectedPlayers.length >= 2 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-8 bg-slate-800/50 rounded-lg p-6 backdrop-blur-sm"
                >
                  <h2 className="text-2xl font-bold text-white mb-6">Player Comparison</h2>

                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-600">
                          <th className="text-left p-3 text-slate-300">Metric</th>
                          {selectedPlayers.map((player) => (
                            <th key={player.id} className="text-left p-3 text-white">
                              {player.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-slate-700">
                          <td className="p-3 text-slate-300">Fantasy Score</td>
                          {selectedPlayers.map((player) => (
                            <td key={player.id} className="p-3 text-blue-400 font-bold">
                              {player.fantasyScore}
                            </td>
                          ))}
                        </tr>
                        <tr className="border-b border-slate-700">
                          <td className="p-3 text-slate-300">Disposals</td>
                          {selectedPlayers.map((player) => (
                            <td key={player.id} className="p-3 text-white">
                              {player.seasonStats.disposals}
                            </td>
                          ))}
                        </tr>
                        <tr className="border-b border-slate-700">
                          <td className="p-3 text-slate-300">Goals</td>
                          {selectedPlayers.map((player) => (
                            <td key={player.id} className="p-3 text-green-400">
                              {player.seasonStats.goals}
                            </td>
                          ))}
                        </tr>
                        <tr className="border-b border-slate-700">
                          <td className="p-3 text-slate-300">Tackles</td>
                          {selectedPlayers.map((player) => (
                            <td key={player.id} className="p-3 text-white">
                              {player.seasonStats.tackles}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Results Summary */}
            <div className="mt-6 text-center">
              <p className="text-slate-400">
                Showing {Math.min(filteredPlayers.length, 12)} of {filteredPlayers.length} players
                {searchTerm && ` matching "${searchTerm}"`}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
