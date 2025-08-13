'use client';

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, BarChart3, TrendingUp, Award, ChevronDown, ChevronUp, Info, ArrowUpDown } from 'lucide-react';
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
  priority: 'high' | 'medium' | 'low';
  description?: string;
}

const COMPARISON_STATS: ComparisonStat[] = [
  // General Stats - High Priority for Mobile
  { key: 'avg', label: 'Average', accessor: (p) => p.avg, format: (v) => v.toFixed(1), category: 'general', priority: 'high', description: 'Fantasy points average per game' },
  { key: 'kicks', label: 'Kicks', accessor: (p) => p.kicks, category: 'general', priority: 'high', description: 'Kicks per game' },
  { key: 'handballs', label: 'Handballs', accessor: (p) => p.handballs, category: 'general', priority: 'high', description: 'Handballs per game' },
  { key: 'disposals', label: 'Disposals', accessor: (p) => (p.kicks || 0) + (p.handballs || 0), category: 'general', priority: 'high', description: 'Total disposals (kicks + handballs)' },
  
  // Scoring Stats
  { key: 'goals', label: 'Goals', accessor: (p) => p.goals, category: 'scoring', priority: 'high', description: 'Goals per game' },
  { key: 'inside50s', label: 'Inside 50s', accessor: (p) => p.inside50s, category: 'scoring', priority: 'medium', description: 'Inside 50 entries per game' },
  
  // Defensive Stats
  { key: 'tackles', label: 'Tackles', accessor: (p) => p.tackles, category: 'defensive', priority: 'high', description: 'Tackles per game' },
  { key: 'rebound50s', label: 'Rebound 50s', accessor: (p) => p.rebound50s, category: 'defensive', priority: 'medium', description: 'Rebound 50s per game' },
  
  // Advanced Stats
  { key: 'marks', label: 'Marks', accessor: (p) => p.marks, category: 'advanced', priority: 'medium', description: 'Marks per game' },
  { key: 'contestedPossessions', label: 'Contested Poss.', accessor: (p) => p.contestedPossessions, category: 'advanced', priority: 'medium', description: 'Contested possessions per game' },
  { key: 'hitouts', label: 'Hitouts', accessor: (p) => p.hitouts, category: 'advanced', priority: 'low', description: 'Hitouts per game (ruck stat)' },
  { key: 'clearances', label: 'Clearances', accessor: (p) => p.clearances, category: 'advanced', priority: 'medium', description: 'Clearances per game' },
];

const STAT_CATEGORIES = [
  { key: 'all', label: 'All Stats', icon: BarChart3, description: 'View all statistics together' },
  { key: 'general', label: 'General', icon: BarChart3, description: 'Basic possession and disposal stats' },
  { key: 'scoring', label: 'Scoring', icon: Award, description: 'Goals and attacking statistics' },
  { key: 'defensive', label: 'Defensive', icon: TrendingUp, description: 'Defensive actions and rebounds' },
  { key: 'advanced', label: 'Advanced', icon: BarChart3, description: 'Specialized and positional stats' },
];

const PERFORMANCE_LEGEND = [
  { color: 'text-green-600 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-900/50', label: 'Excellent', description: 'Top 10% performance' },
  { color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-100 dark:bg-blue-900/50', label: 'Good', description: 'Above average' },
  { color: 'text-gray-600 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-700', label: 'Average', description: 'League average' },
  { color: 'text-red-600 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900/50', label: 'Below Average', description: 'Needs improvement' },
];

export default function PlayerComparison({ players, isOpen, onClose, initialPlayers = [] }: PlayerComparisonProps) {
  const [selectedPlayers, setSelectedPlayers] = useState<Player[]>(initialPlayers.slice(0, 4));
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showLegend, setShowLegend] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Filter available players for selection
  const availablePlayers = useMemo(() => {
    return players.filter(player => 
      !selectedPlayers.find(selected => selected.id === player.id) &&
      (searchTerm === '' || 
       player.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
       (player.team && player.team.toLowerCase().includes(searchTerm.toLowerCase())))
    ).slice(0, 10);
  }, [players, selectedPlayers, searchTerm]);

  // Get stats for selected category with mobile prioritization
  const categoryStats = useMemo(() => {
    if (selectedCategory === 'all') {
      return COMPARISON_STATS;
    }
    let stats = COMPARISON_STATS.filter(stat => stat.category === selectedCategory);
    
    // On mobile, prioritize high-priority stats
    if (isMobile) {
      stats = stats.sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });
    }
    
    return stats;
  }, [selectedCategory, isMobile]);

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

  const getTeamLogo = (team: string | undefined) => {
    return team ? `/logos/${team}.svg` : '/logos/fallback.svg';
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
          className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-7xl w-full max-h-[95vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Enhanced Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Player Comparison</h2>
              <p className="text-gray-600 dark:text-gray-400 mt-1">
                Compare up to 4 players side by side • Enhanced with team logos and duplicate handling
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/50 dark:hover:bg-gray-700 rounded-full transition-colors"
            >
              <X className="w-6 h-6 text-gray-500 dark:text-gray-400" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[calc(95vh-100px)]">
            {/* Legend Toggle */}
            <div className="p-6 pb-4 border-b border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setShowLegend(!showLegend)}
                className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                <Info className="w-4 h-4" />
                <span>Performance Color Guide</span>
                {showLegend ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {/* Performance Legend */}
              {showLegend && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700"
                >
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {PERFORMANCE_LEGEND.map((item, index) => (
                      <div key={index} className="flex items-center space-x-2">
                        <div className={`w-4 h-4 rounded ${item.bg}`}></div>
                        <div>
                          <div className={`text-sm font-medium ${item.color}`}>{item.label}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{item.description}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>

            <div className="p-6">
              {/* Enhanced Player Selection */}
              <div className="mb-6">
                <div className="flex flex-wrap gap-3 mb-4">
                  {selectedPlayers.map((player, index) => (
                    <div
                      key={player.id}
                      className="flex items-center bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200 px-4 py-3 rounded-lg shadow-sm"
                    >
                      <div className="flex items-center space-x-3">
                        {/* Team Logo */}
                        <div className="w-8 h-8 bg-white dark:bg-gray-700 rounded-full flex items-center justify-center border border-gray-200 dark:border-gray-600">
                          <img 
                            src={getTeamLogo(player.team)} 
                            alt={`${player.team} logo`}
                            className="w-6 h-6"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.src = '/logos/fallback.svg';
                            }}
                          />
                        </div>
                        
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-semibold">{player.name}</span>
                            {selectedPlayers.filter(p => p.name === player.name).length > 1 && (
                              <span className="text-xs bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-200 px-2 py-0.5 rounded">
                                #{index + 1}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center space-x-2 text-sm">
                            <span className="text-blue-600 dark:text-blue-400">{player.team}</span>
                            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                              player.position === 'DEF' ? 'bg-blue-200 text-blue-900 dark:bg-blue-800 dark:text-blue-100' :
                              player.position === 'MID' ? 'bg-green-200 text-green-900 dark:bg-green-800 dark:text-green-100' :
                              player.position === 'FWD' ? 'bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-100' :
                              player.position === 'RUC' ? 'bg-purple-200 text-purple-900 dark:bg-purple-800 dark:text-purple-100' :
                              'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100'
                            }`}>
                              {player.position}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => removePlayer(player.id)}
                        className="ml-3 hover:bg-blue-200 dark:hover:bg-blue-800 rounded-full p-1 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  
                  {selectedPlayers.length < 4 && (
                    <div className="flex items-center">
                      <input
                        type="text"
                        placeholder="Search to add players..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white shadow-sm min-w-64"
                      />
                    </div>
                  )}
                </div>

                {/* Available Players Search Results */}
                {searchTerm && availablePlayers.length > 0 && selectedPlayers.length < 4 && (
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700">
                    <div className="space-y-2">
                      {availablePlayers.map((player) => (
                        <button
                          key={player.id}
                          onClick={() => addPlayer(player)}
                          className="w-full flex items-center justify-between p-3 hover:bg-white dark:hover:bg-gray-800 rounded-lg border border-transparent hover:border-gray-200 dark:hover:border-gray-700 text-left transition-all hover:shadow-sm"
                        >
                          <div className="flex items-center space-x-3">
                            <div>
                              <div className="font-medium text-gray-900 dark:text-white">{player.name}</div>
                              <div className="text-sm text-gray-500 dark:text-gray-400">{player.team}</div>
                            </div>
                            <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                              player.position === 'DEF' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200' :
                              player.position === 'MID' ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200' :
                              player.position === 'FWD' ? 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200' :
                              player.position === 'RUC' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200' :
                              'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                            }`}>
                              {player.position}
                            </span>
                          </div>
                          <Plus className="w-5 h-5 text-gray-400" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {selectedPlayers.length >= 2 && (
                <>
                  {/* Always-Visible Navigation */}
                  <div className="mb-6 sticky top-0 bg-white dark:bg-gray-800 z-10 border-b border-gray-200 dark:border-gray-700 pb-4">
                    <div className="flex flex-col space-y-4">
                      <div>
                        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                          Statistics Categories
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {STAT_CATEGORIES.map((category) => {
                            const Icon = category.icon;
                            const isActive = selectedCategory === category.key;
                            return (
                              <button
                                key={category.key}
                                onClick={() => setSelectedCategory(category.key)}
                                className={`flex items-center px-4 py-2.5 rounded-lg font-medium transition-all duration-200 ${
                                  isActive
                                    ? 'bg-blue-600 text-white shadow-lg transform scale-105'
                                    : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 hover:shadow-md'
                                }`}
                                title={category.description}
                              >
                                <Icon className="w-4 h-4 mr-2" />
                                <span className={isMobile && category.key !== 'all' ? 'hidden sm:inline' : ''}>
                                  {category.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {selectedCategory === 'all' ? 'Showing all statistics' : `Showing ${categoryStats.length} ${selectedCategory} statistics`}
                        </div>
                        
                        {!isMobile && (
                          <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
                            <ArrowUpDown className="w-4 h-4" />
                            <span>Click any stat header to sort</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Responsive Comparison Display */}
                  {isMobile ? (
                    /* Mobile: Vertical Card Layout */
                    <div className="space-y-6">
                      {selectedPlayers.map((player, playerIndex) => (
                        <motion.div
                          key={player.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: playerIndex * 0.1 }}
                          className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
                        >
                          {/* Mobile Player Header */}
                          <div className="bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                            <div className="flex items-center space-x-3">
                              <div className="w-10 h-10 bg-white dark:bg-gray-700 rounded-full flex items-center justify-center border border-gray-200 dark:border-gray-600">
                                <img 
                                  src={getTeamLogo(player.team)} 
                                  alt={`${player.team} logo`}
                                  className="w-8 h-8"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.src = '/logos/fallback.svg';
                                  }}
                                />
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center space-x-2">
                                  <h3 className="font-semibold text-gray-900 dark:text-white">{player.name}</h3>
                                  {selectedPlayers.filter(p => p.name === player.name).length > 1 && (
                                    <span className="text-xs bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200 px-2 py-0.5 rounded">
                                      #{playerIndex + 1}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                                  <span>{player.team}</span>
                                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                                    player.position === 'DEF' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200' :
                                    player.position === 'MID' ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200' :
                                    player.position === 'FWD' ? 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200' :
                                    player.position === 'RUC' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200' :
                                    'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                                  }`}>
                                    {player.position}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Mobile Stats Grid */}
                          <div className="p-4">
                            <div className="grid grid-cols-2 gap-4">
                              {categoryStats.map((stat) => {
                                const value = stat.accessor(player);
                                const rank = getPlayerStatRank(player, stat.key);
                                const isBest = value === getBestValue(stat.key) && value !== undefined && value !== null;
                                const colorClass = value !== undefined && value !== null && player.position 
                                  ? getStatColor(stat.key, value, player.position)
                                  : 'text-gray-500 dark:text-gray-400';
                                
                                return (
                                  <div key={stat.key} className="text-center">
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1" title={stat.description}>
                                      {stat.label}
                                    </div>
                                    <div className={`text-lg font-semibold ${colorClass} ${isBest ? 'text-yellow-600 dark:text-yellow-400' : ''} flex items-center justify-center`}>
                                      {value !== undefined && value !== null 
                                        ? stat.format ? stat.format(value) : value.toString()
                                        : '-'
                                      }
                                      {isBest && selectedPlayers.length > 1 && (
                                        <Award className="w-4 h-4 ml-1 text-yellow-500" />
                                      )}
                                    </div>
                                    {rank <= 3 && value !== undefined && value !== null && selectedPlayers.length > 2 && (
                                      <div className={`inline-flex items-center justify-center w-5 h-5 text-xs font-medium rounded-full mt-1 ${
                                        rank === 1 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300' :
                                        rank === 2 ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300' :
                                        'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300'
                                      }`}>
                                        {rank}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  ) : (
                    /* Desktop: Enhanced Table Layout */
                    <div className="overflow-x-auto">
                      <table className="w-full border border-gray-200 dark:border-gray-700 rounded-lg">
                        {/* Enhanced Sticky Header */}
                        <thead className="sticky top-16 bg-gray-50 dark:bg-gray-900 z-10">
                          <tr>
                            <th className="px-6 py-4 text-left text-sm font-medium text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 min-w-40 bg-gray-50 dark:bg-gray-900">
                              <div className="flex items-center space-x-2" title="Hover over stats for descriptions">
                                <span>Statistic</span>
                                <Info className="w-4 h-4 text-gray-400" />
                              </div>
                            </th>
                            {selectedPlayers.map((player, index) => (
                              <th key={player.id} className="px-4 py-4 text-center text-sm font-medium text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 min-w-36">
                                <div className="space-y-2">
                                  {/* Team Logo */}
                                  <div className="flex justify-center">
                                    <div className="w-8 h-8 bg-white dark:bg-gray-700 rounded-full flex items-center justify-center border border-gray-200 dark:border-gray-600">
                                      <img 
                                        src={getTeamLogo(player.team)} 
                                        alt={`${player.team} logo`}
                                        className="w-6 h-6"
                                        onError={(e) => {
                                          const target = e.target as HTMLImageElement;
                                          target.src = '/logos/fallback.svg';
                                        }}
                                      />
                                    </div>
                                  </div>
                                  
                                  {/* Player Name with Duplicate Indicator */}
                                  <div className="font-semibold text-gray-900 dark:text-white text-sm leading-tight">
                                    <div className="flex items-center justify-center space-x-1">
                                      <span>{player.name}</span>
                                      {selectedPlayers.filter(p => p.name === player.name).length > 1 && (
                                        <span className="text-xs bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-200 px-1.5 py-0.5 rounded">
                                          #{index + 1}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  
                                  {/* Team Name */}
                                  <div className="text-xs text-gray-500 dark:text-gray-400">
                                    {player.team}
                                  </div>
                                  
                                  {/* Position Badge */}
                                  <div className="flex justify-center">
                                    <span className={`inline-flex px-2.5 py-1 text-xs font-medium rounded-full ${
                                      player.position === 'DEF' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200' :
                                      player.position === 'MID' ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200' :
                                      player.position === 'FWD' ? 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200' :
                                      player.position === 'RUC' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200' :
                                      'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                                    }`}>
                                      {player.position}
                                    </span>
                                  </div>
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {categoryStats.map((stat, index) => {
                            const bestValue = getBestValue(stat.key);
                            return (
                              <tr key={stat.key} className={`${index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-900'} hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors`}>
                                <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700">
                                  <div className="flex items-center space-x-2" title={stat.description}>
                                    <span>{stat.label}</span>
                                    <ArrowUpDown className="w-3 h-3 text-gray-400" />
                                  </div>
                                </td>
                                {selectedPlayers.map((player) => {
                                  const value = stat.accessor(player);
                                  const rank = getPlayerStatRank(player, stat.key);
                                  const isBest = value === bestValue && value !== undefined && value !== null;
                                  const colorClass = value !== undefined && value !== null && player.position 
                                    ? getStatColor(stat.key, value, player.position)
                                    : 'text-gray-500 dark:text-gray-400';
                                  
                                  return (
                                    <td key={player.id} className="px-4 py-4 text-center border-b border-gray-200 dark:border-gray-700">
                                      <div className="flex flex-col items-center space-y-1">
                                        <div className={`text-lg font-semibold ${colorClass} ${isBest ? 'text-yellow-600 dark:text-yellow-400' : ''} flex items-center`}>
                                          {value !== undefined && value !== null 
                                            ? stat.format ? stat.format(value) : value.toString()
                                            : '-'
                                          }
                                          {isBest && selectedPlayers.length > 1 && (
                                            <Award className="w-4 h-4 ml-1 text-yellow-500" />
                                          )}
                                        </div>
                                        {rank <= 3 && value !== undefined && value !== null && selectedPlayers.length > 2 && (
                                          <div className={`inline-flex items-center justify-center w-6 h-5 text-xs font-medium rounded-full ${
                                            rank === 1 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300' :
                                            rank === 2 ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300' :
                                            'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300'
                                          }`}>
                                            {rank}
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
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
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
