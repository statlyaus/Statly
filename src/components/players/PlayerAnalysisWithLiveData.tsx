// Enhanced Player Analysis with Live Data Integration
// This demonstrates migrating from mock data to live Firebase data

'use client';

import React, { useState, useMemo } from 'react';

import {
  Search as MagnifyingGlassIcon,
  ArrowUpDown as ArrowsUpDownIcon,
  Signal as SignalIcon,
  TriangleAlert as ExclamationTriangleIcon,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { TeamLogo } from '@/components/TeamLogo';
import { useLiveData } from '@/hooks/useLiveData';
import type { LegacyPlayerStat } from '@/types/fantasy';

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
    return playerStats.map((stat: LegacyPlayerStat) => {
      const fantasy = stat.fantasyScore ?? 0;
      return {
        id: stat.id,
        name: stat.name,
        position: stat.position,
        team: stat.team,
        round: stat.round,
        season: stat.season,
        lastUpdated: stat.lastUpdated,
        source: stat.source,
        fantasyScore: fantasy,
        averageScore: fantasy,
        seasonStats: {
          disposals: stat.disposals,
          kicks: stat.kicks,
          handballs: stat.handballs,
          marks: stat.marks,
          tackles: stat.tackles,
          goals: stat.goals,
          behinds: stat.behinds,
          hitouts: stat.hitouts,
          interceptMarks: stat.contested_possessions,
          rebounds: stat.rebound50s,
        },
        // Default values for optional fields
        price: 500000,
        priceChange: 0,
        ownership: 50,
        injuryStatus: 'healthy',
        recentGames: [
          {
            round: stat.round,
            opponent: 'TBD',
            score: fantasy,
            stats: {
              disposals: stat.disposals,
              kicks: stat.kicks,
              handballs: stat.handballs,
              marks: stat.marks,
              tackles: stat.tackles,
              goals: stat.goals,
              behinds: stat.behinds,
              hitouts: stat.hitouts,
            },
          },
        ],
        upcomingFixtures: [],
        trends: {
          priceChangePercent: 0,
          ownershipChange: 0,
          formTrend: 'stable',
        },
      } as Player;
    });
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
    <div className="min-h-screen bg-gradient-to-br from-foreground via-info to-info p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header with Live Data Status */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-4xl font-bold text-white mb-4">Player Analysis {isLive && '🔴'}</h1>
            <p className="text-xl text-muted-foreground">
              Advanced analytics powered by {isLive ? 'live' : 'historical'} data
            </p>
          </div>

          {/* Live Data Status Indicator */}
          <div
            className={`p-4 rounded-lg ${
              isLive ? 'bg-success border border-success/20' : 'bg-muted border border-border'
            }`}
          >
            <div className="flex items-center space-x-2">
              <SignalIcon
                className={`w-5 h-5 ${isLive ? 'text-success' : 'text-muted-foreground'}`}
              />
              <div>
                <p className="text-white font-medium">{isLive ? 'Live Data' : 'Historical Data'}</p>
                {lastUpdate && (
                  <p className="text-muted-foreground text-sm">
                    Updated: {new Date(lastUpdate).toLocaleTimeString()}
                  </p>
                )}
                <p className="text-muted-foreground text-xs">
                  {transformedPlayers.length} players loaded
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-12">
            <div className="animate-spin w-8 h-8 border-4 border-info/20 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading player data from Firebase...</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-destructive border border-destructive/20 p-4 rounded-lg mb-6">
            <div className="flex items-center space-x-2">
              <ExclamationTriangleIcon className="w-5 h-5 text-destructive" />
              <p className="text-destructive">
                <strong>Error loading data:</strong> {error}
              </p>
            </div>
          </div>
        )}

        {!isLoading && !error && (
          <>
            {/* Controls */}
            <div className="bg-muted rounded-lg p-6 mb-6 backdrop-blur-sm">
              {/* View Mode Toggle */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex space-x-2">
                  <button
                    onClick={() => setViewMode('analysis')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      viewMode === 'analysis'
                        ? 'bg-info text-white'
                        : 'bg-muted text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    Analysis
                  </button>
                  {showComparison && (
                    <button
                      onClick={() => setViewMode('comparison')}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        viewMode === 'comparison'
                          ? 'bg-info text-white'
                          : 'bg-muted text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      Compare ({selectedPlayers.length})
                    </button>
                  )}
                </div>

                {/* Live Match Indicator */}
                {liveMatches.length > 0 && (
                  <div className="bg-success border border-success/20 px-3 py-1 rounded-lg">
                    <span className="text-success text-sm">
                      🏈 {liveMatches.length} live match{liveMatches.length !== 1 ? 'es' : ''}
                    </span>
                  </div>
                )}
              </div>

              {/* Search and Filters */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* Search */}
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search players..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-muted border border-border rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-info"
                  />
                </div>

                {/* Position Filter */}
                <select
                  value={positionFilter}
                  onChange={(e) => setPositionFilter(e.target.value)}
                  className="px-4 py-2 bg-muted border border-border rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-info"
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
                  className="px-4 py-2 bg-muted border border-border rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-info"
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
                  className="px-4 py-2 bg-muted border border-border rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-info"
                >
                  <option value="fantasyScore">Fantasy Score</option>
                  <option value="name">Name</option>
                  <option value="team">Team</option>
                  <option value="lastUpdated">Last Updated</option>
                </select>

                {/* Sort Order */}
                <button
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  className="flex items-center justify-center px-4 py-2 bg-muted border border-border rounded-lg text-white hover:bg-muted focus:outline-none focus:ring-2 focus:ring-info"
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
                    className={`bg-muted rounded-lg p-6 backdrop-blur-sm border-2 transition-all cursor-pointer ${
                      isSelected ? 'border-info/20 bg-info' : 'border-border hover:border-border'
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
                        <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
                          {player.team ? (
                            <TeamLogo team={player.team} size={18} withCircle decorative />
                          ) : null}
                          <span>
                            {player.position} • {player.team}
                          </span>
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-info">{player.fantasyScore}</p>
                        <p className="text-muted-foreground text-sm">Fantasy Score</p>
                      </div>
                    </div>

                    {/* Key Stats */}
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <p className="text-muted-foreground text-sm">Disposals</p>
                        <p className="text-white font-medium">{player.seasonStats.disposals}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-sm">Goals</p>
                        <p className="text-white font-medium">{player.seasonStats.goals}</p>
                      </div>
                    </div>

                    {/* Data Source Info */}
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">
                        Round {player.round} • {player.source}
                      </span>
                      <span className="text-muted-foreground">
                        {new Date(player.lastUpdated).toLocaleDateString()}
                      </span>
                    </div>

                    {/* Selection Indicator */}
                    {isSelected && (
                      <div className="mt-3 p-2 bg-info rounded-lg">
                        <p className="text-info text-sm text-center">Selected for comparison</p>
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
                  className="mt-8 bg-muted rounded-lg p-6 backdrop-blur-sm"
                >
                  <h2 className="text-2xl font-bold text-white mb-6">Player Comparison</h2>

                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left p-3 text-muted-foreground">Metric</th>
                          {selectedPlayers.map((player) => (
                            <th key={player.id} className="text-left p-3 text-white">
                              {player.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-border">
                          <td className="p-3 text-muted-foreground">Fantasy Score</td>
                          {selectedPlayers.map((player) => (
                            <td key={player.id} className="p-3 text-info font-bold">
                              {player.fantasyScore}
                            </td>
                          ))}
                        </tr>
                        <tr className="border-b border-border">
                          <td className="p-3 text-muted-foreground">Disposals</td>
                          {selectedPlayers.map((player) => (
                            <td key={player.id} className="p-3 text-white">
                              {player.seasonStats.disposals}
                            </td>
                          ))}
                        </tr>
                        <tr className="border-b border-border">
                          <td className="p-3 text-muted-foreground">Goals</td>
                          {selectedPlayers.map((player) => (
                            <td key={player.id} className="p-3 text-success">
                              {player.seasonStats.goals}
                            </td>
                          ))}
                        </tr>
                        <tr className="border-b border-border">
                          <td className="p-3 text-muted-foreground">Tackles</td>
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
              <p className="text-muted-foreground">
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
