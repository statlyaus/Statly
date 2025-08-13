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
  { key: 'all', label: 'All Stats', icon: BarChart3, description: 'View all statistics together', count: COMPARISON_STATS.length },
  { key: 'general', label: 'General', icon: BarChart3, description: 'Basic possession and disposal stats', count: COMPARISON_STATS.filter(s => s.category === 'general').length },
  { key: 'scoring', label: 'Scoring', icon: Award, description: 'Goals and attacking statistics', count: COMPARISON_STATS.filter(s => s.category === 'scoring').length },
  { key: 'defensive', label: 'Defensive', icon: TrendingUp, description: 'Defensive actions and rebounds', count: COMPARISON_STATS.filter(s => s.category === 'defensive').length },
  { key: 'advanced', label: 'Advanced', icon: BarChart3, description: 'Specialized and positional stats', count: COMPARISON_STATS.filter(s => s.category === 'advanced').length },
];

// Enhanced performance legend with better accessibility
const PERFORMANCE_LEGEND = [
  { 
    color: 'text-green-600 dark:text-green-400', 
    bg: 'bg-green-100 dark:bg-green-900/50', 
    border: 'border-green-300 dark:border-green-700',
    label: 'Excellent', 
    description: 'Top 10% performance',
    symbol: '●'
  },
  { 
    color: 'text-blue-600 dark:text-blue-400', 
    bg: 'bg-blue-100 dark:bg-blue-900/50', 
    border: 'border-blue-300 dark:border-blue-700',
    label: 'Good', 
    description: 'Above average',
    symbol: '▲'
  },
  { 
    color: 'text-gray-600 dark:text-gray-400', 
    bg: 'bg-gray-100 dark:bg-gray-700', 
    border: 'border-gray-300 dark:border-gray-600',
    label: 'Average', 
    description: 'League average',
    symbol: '■'
  },
  { 
    color: 'text-red-600 dark:text-red-400', 
    bg: 'bg-red-100 dark:bg-red-900/50', 
    border: 'border-red-300 dark:border-red-700',
    label: 'Below Average', 
    description: 'Needs improvement',
    symbol: '▼'
  },
];

export default function PlayerComparison({ players, isOpen, onClose, initialPlayers = [] }: PlayerComparisonProps) {
  const [selectedPlayers, setSelectedPlayers] = useState<Player[]>(initialPlayers.slice(0, 4));
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showLegend, setShowLegend] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [viewMode, setViewMode] = useState<'condensed' | 'expanded'>('expanded');
  const [sortByStat, setSortByStat] = useState<string>('');
  const [recentPlayers, setRecentPlayers] = useState<Player[]>([]);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Track recently compared players
  useEffect(() => {
    if (selectedPlayers.length > 0) {
      const recent = selectedPlayers.slice(0, 2);
      setRecentPlayers(recent);
    }
  }, [selectedPlayers]);

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

  // Helper function to highlight search matches
  const highlightSearchMatch = (text: string, searchTerm: string) => {
    if (!searchTerm) return text;
    const parts = text.split(new RegExp(`(${searchTerm})`, 'gi'));
    return parts.map((part, index) => 
      part.toLowerCase() === searchTerm.toLowerCase() ? 
        <mark key={index} className="bg-yellow-200 dark:bg-yellow-800 px-1 rounded">{part}</mark> : 
        part
    );
  };

  // Get statistical differences for highlighting
  const getStatDifference = (player: Player, statKey: string) => {
    const stat = COMPARISON_STATS.find(s => s.key === statKey);
    if (!stat || selectedPlayers.length < 2) return null;
    
    const playerValue = stat.accessor(player);
    if (playerValue === undefined || playerValue === null) return null;
    
    const otherValues = selectedPlayers
      .filter(p => p.id !== player.id)
      .map(p => stat.accessor(p))
      .filter(val => val !== undefined && val !== null) as number[];
    
    if (otherValues.length === 0) return null;
    
    const avgOthers = otherValues.reduce((sum, val) => sum + val, 0) / otherValues.length;
    const difference = playerValue - avgOthers;
    const percentDiff = Math.abs(difference) / avgOthers * 100;
    
    return {
      difference,
      percentDiff,
      isSignificant: percentDiff > 15 // 15% difference is considered significant
    };
  };

  // Get performance indicator with accessibility
  const getPerformanceIndicator = (statKey: string, value: number, position: string) => {
    const colorClass = getStatColor(statKey, value, position);
    const legend = PERFORMANCE_LEGEND.find(item => 
      colorClass.includes(item.color.split(' ')[0].replace('text-', ''))
    );
    
    return {
      colorClass,
      symbol: legend?.symbol || '■',
      description: legend?.description || 'Performance indicator'
    };
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

          <div className="flex-1 overflow-y-auto max-h-[calc(95vh-100px)] relative">
            {/* Sticky Performance Legend - Top Right */}
            <div className="fixed top-20 right-8 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 max-w-xs">
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Performance Guide</div>
              <div className="space-y-1">
                {PERFORMANCE_LEGEND.map((item, index) => (
                  <div key={index} className="flex items-center space-x-2 text-xs">
                    <span className={`font-mono ${item.color}`} title={item.description}>
                      {item.symbol}
                    </span>
                    <span className="text-gray-600 dark:text-gray-400">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Toggle-able Legend Section */}
            <div className="p-6 pb-4 border-b border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setShowLegend(!showLegend)}
                className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                <Info className="w-4 h-4" />
                <span>Detailed Performance Guide</span>
                {showLegend ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {/* Detailed Performance Legend */}
              {showLegend && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {PERFORMANCE_LEGEND.map((item, index) => (
                      <div key={index} className="flex items-center space-x-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                        <div className={`w-8 h-8 rounded-full border-2 ${item.bg} ${item.border} flex items-center justify-center`}>
                          <span className={`font-mono text-lg ${item.color}`}>{item.symbol}</span>
                        </div>
                        <div>
                          <div className={`text-sm font-medium ${item.color}`}>{item.label}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{item.description}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700">
                    <div className="text-sm text-blue-800 dark:text-blue-200">
                      <strong>Accessibility:</strong> Each performance level uses both color and symbols for better accessibility.
                      Significant differences ({'>'}15%) are highlighted with additional indicators.
                    </div>
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

                {/* Enhanced Search Results with Highlighting and Suggestions */}
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
                              <div className="font-medium text-gray-900 dark:text-white">
                                {highlightSearchMatch(player.name, searchTerm)}
                              </div>
                              <div className="text-sm text-gray-500 dark:text-gray-400">
                                {highlightSearchMatch(player.team || '', searchTerm)}
                              </div>
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

                {/* Recent Players Suggestions */}
                {!searchTerm && selectedPlayers.length < 4 && recentPlayers.length > 0 && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-700">
                    <div className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
                      Recently Compared Players
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {recentPlayers.slice(0, 3).map((player) => (
                        <button
                          key={player.id}
                          onClick={() => addPlayer(player)}
                          className="text-xs bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200 px-2 py-1 rounded-full hover:bg-blue-200 dark:hover:bg-blue-700 transition-colors"
                        >
                          + {player.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {selectedPlayers.length >= 2 && (
                <>
                  {/* Enhanced Navigation with View Toggle */}
                  <div className="mb-6 sticky top-0 bg-white dark:bg-gray-800 z-10 border-b border-gray-200 dark:border-gray-700 pb-4">
                    <div className="flex flex-col space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Statistics Categories
                        </h3>
                        
                        {/* View Mode Toggle */}
                        <div className="flex items-center space-x-2">
                          <span className="text-xs text-gray-500 dark:text-gray-400">View:</span>
                          <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                            <button
                              onClick={() => setViewMode('condensed')}
                              className={`px-3 py-1 text-xs rounded transition-colors ${
                                viewMode === 'condensed'
                                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                              }`}
                            >
                              Condensed
                            </button>
                            <button
                              onClick={() => setViewMode('expanded')}
                              className={`px-3 py-1 text-xs rounded transition-colors ${
                                viewMode === 'expanded'
                                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                              }`}
                            >
                              Detailed
                            </button>
                          </div>
                        </div>
                      </div>
                      
                      {/* Category Navigation with Counts */}
                      <div className="flex flex-wrap gap-2">
                        {STAT_CATEGORIES.map((category) => {
                          const Icon = category.icon;
                          const isActive = selectedCategory === category.key;
                          const statCount = category.key === 'all' ? categoryStats.length : category.count;
                          
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
                              <span className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
                                isActive 
                                  ? 'bg-blue-500 text-blue-100'
                                  : 'bg-gray-200 text-gray-600 dark:bg-gray-600 dark:text-gray-300'
                              }`}>
                                {statCount}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {selectedCategory === 'all' ? 'Showing all statistics' : `Showing ${categoryStats.length} ${selectedCategory} statistics`}
                          {viewMode === 'condensed' && ' • Key metrics only'}
                        </div>
                        
                        {!isMobile && (
                          <div className="flex items-center space-x-4">
                            <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
                              <ArrowUpDown className="w-4 h-4" />
                              <span>Click stat to sort by difference</span>
                            </div>
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

                          {/* Enhanced Mobile Stats Grid */}
                          <div className="p-4">
                            <div className={viewMode === 'condensed' ? 'grid grid-cols-3 gap-3' : 'grid grid-cols-2 gap-4'}>
                              {(viewMode === 'condensed' ? categoryStats.filter(s => s.priority === 'high') : categoryStats).map((stat) => {
                                const value = stat.accessor(player);
                                const rank = getPlayerStatRank(player, stat.key);
                                const isBest = value === getBestValue(stat.key) && value !== undefined && value !== null;
                                const difference = getStatDifference(player, stat.key);
                                const performance = value !== undefined && value !== null && player.position 
                                  ? getPerformanceIndicator(stat.key, value, player.position)
                                  : null;
                                
                                return (
                                  <div key={stat.key} className="text-center relative">
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1" title={stat.description}>
                                      {stat.label}
                                    </div>
                                    
                                    <div className="flex items-center justify-center space-x-1">
                                      {/* Performance Symbol */}
                                      {performance && (
                                        <span 
                                          className={`text-sm ${performance.colorClass}`}
                                          title={performance.description}
                                        >
                                          {performance.symbol}
                                        </span>
                                      )}
                                      
                                      {/* Value with Highlighting */}
                                      <div className={`text-lg font-semibold ${
                                        performance?.colorClass || 'text-gray-500 dark:text-gray-400'
                                      } ${isBest ? 'text-yellow-600 dark:text-yellow-400' : ''} ${
                                        difference?.isSignificant ? 'ring-2 ring-orange-300 dark:ring-orange-600 rounded px-1' : ''
                                      }`}>
                                        {value !== undefined && value !== null 
                                          ? stat.format ? stat.format(value) : value.toString()
                                          : '-'
                                        }
                                      </div>
                                      
                                      {/* Best Performance Award */}
                                      {isBest && selectedPlayers.length > 1 && (
                                        <Award className="w-4 h-4 text-yellow-500" />
                                      )}
                                    </div>
                                    
                                    {/* Rank Indicator */}
                                    {rank <= 3 && value !== undefined && value !== null && selectedPlayers.length > 2 && (
                                      <div className={`inline-flex items-center justify-center w-5 h-5 text-xs font-medium rounded-full mt-1 ${
                                        rank === 1 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300' :
                                        rank === 2 ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300' :
                                        'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300'
                                      }`}>
                                        {rank}
                                      </div>
                                    )}
                                    
                                    {/* Difference Indicator */}
                                    {difference?.isSignificant && (
                                      <div className="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full border-2 border-white dark:border-gray-800" 
                                           title={`${difference.percentDiff.toFixed(1)}% difference from others`} />
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
                    /* Enhanced Desktop Table Layout */
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
                          {(viewMode === 'condensed' ? categoryStats.filter(s => s.priority === 'high') : categoryStats).map((stat, index) => {
                            const bestValue = getBestValue(stat.key);
                            const isClickable = selectedPlayers.length > 1;
                            
                            return (
                              <tr 
                                key={stat.key} 
                                className={`${
                                  index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50/50 dark:bg-gray-900/50'
                                } hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors border-b border-gray-100 dark:border-gray-700`}
                              >
                                <td 
                                  className={`px-6 py-4 text-sm font-medium text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 ${
                                    isClickable ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700' : ''
                                  }`}
                                  onClick={() => isClickable && setSortByStat(stat.key)}
                                >
                                  <div className="flex items-center justify-between" title={stat.description}>
                                    <span>{stat.label}</span>
                                    <div className="flex items-center space-x-1">
                                      {sortByStat === stat.key && (
                                        <div className="w-2 h-2 bg-blue-500 rounded-full" />
                                      )}
                                      <ArrowUpDown className="w-3 h-3 text-gray-400" />
                                    </div>
                                  </div>
                                </td>
                                {selectedPlayers.map((player) => {
                                  const value = stat.accessor(player);
                                  const rank = getPlayerStatRank(player, stat.key);
                                  const isBest = value === bestValue && value !== undefined && value !== null;
                                  const difference = getStatDifference(player, stat.key);
                                  const performance = value !== undefined && value !== null && player.position 
                                    ? getPerformanceIndicator(stat.key, value, player.position)
                                    : null;
                                  
                                  return (
                                    <td key={player.id} className="px-4 py-4 text-center border-b border-gray-200 dark:border-gray-700 relative">
                                      <div className="flex flex-col items-center space-y-1">
                                        {/* Main Value with Performance Indicator */}
                                        <div className="flex items-center space-x-1">
                                          {performance && (
                                            <span 
                                              className={`text-sm ${performance.colorClass}`}
                                              title={performance.description}
                                            >
                                              {performance.symbol}
                                            </span>
                                          )}
                                          <div className={`text-lg font-semibold ${
                                            performance?.colorClass || 'text-gray-500 dark:text-gray-400'
                                          } ${isBest ? 'text-yellow-600 dark:text-yellow-400' : ''} ${
                                            difference?.isSignificant ? 'ring-2 ring-orange-300 dark:ring-orange-600 rounded px-2' : ''
                                          }`}>
                                            {value !== undefined && value !== null 
                                              ? stat.format ? stat.format(value) : value.toString()
                                              : '-'
                                            }
                                          </div>
                                          {isBest && selectedPlayers.length > 1 && (
                                            <Award className="w-4 h-4 text-yellow-500" />
                                          )}
                                        </div>
                                        
                                        {/* Rank and Difference Indicators */}
                                        <div className="flex items-center space-x-2">
                                          {rank <= 3 && value !== undefined && value !== null && selectedPlayers.length > 2 && (
                                            <div className={`inline-flex items-center justify-center w-6 h-5 text-xs font-medium rounded-full ${
                                              rank === 1 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300' :
                                              rank === 2 ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300' :
                                              'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300'
                                            }`}>
                                              {rank}
                                            </div>
                                          )}
                                          
                                          {difference?.isSignificant && (
                                            <div className="text-xs text-orange-600 dark:text-orange-400 font-medium" 
                                                 title={`${difference.percentDiff.toFixed(1)}% ${difference.difference > 0 ? 'above' : 'below'} others`}>
                                              {difference.difference > 0 ? '+' : ''}{difference.percentDiff.toFixed(0)}%
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      
                                      {/* Significant Difference Corner Indicator */}
                                      {difference?.isSignificant && (
                                        <div className="absolute top-1 right-1 w-2 h-2 bg-orange-500 rounded-full" 
                                             title="Significant difference from others" />
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
