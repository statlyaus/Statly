'use client';

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, BarChart3, TrendingUp, Award, ChevronDown, Info, ArrowUpDown, Search, GripVertical, Eye, EyeOff } from 'lucide-react';
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
  const [_showLegend, _setShowLegend] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [viewMode, setViewMode] = useState<'condensed' | 'expanded'>('expanded');
  const [_sortByStat, _setSortByStat] = useState<string>('');
  const [_recentPlayers, setRecentPlayers] = useState<Player[]>([]);
  
  // New enhanced UX state
  const [statSearchTerm, setStatSearchTerm] = useState('');
  const [_colorblindMode, _setColorblindMode] = useState(false);
  const [savedComparisons, setSavedComparisons] = useState<{name: string, players: Player[]}[]>([]);
  const [draggedPlayer, setDraggedPlayer] = useState<number | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [navLayout, setNavLayout] = useState<'horizontal' | 'vertical'>('vertical'); // Default to vertical layout

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

  // Enhanced drag and drop functionality
  const handleDragStart = (index: number) => {
    setDraggedPlayer(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedPlayer === null) return;
    
    const newPlayers = [...selectedPlayers];
    const draggedPlayerData = newPlayers[draggedPlayer];
    newPlayers.splice(draggedPlayer, 1);
    newPlayers.splice(dropIndex, 0, draggedPlayerData);
    
    setSelectedPlayers(newPlayers);
    setDraggedPlayer(null);
  };

  // Save comparison functionality
  const _saveComparison = () => {
    const name = `Comparison ${new Date().toLocaleDateString()}`;
    const newComparison = { name, players: selectedPlayers };
    setSavedComparisons([...savedComparisons, newComparison]);
  };

  // Enhanced colorblind-friendly highlighting
  const getEnhancedPerformanceStyle = (statKey: string, value: number, position: string, isBest: boolean) => {
    if (value === null || value === undefined) return 'bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400';
    
    // Simple binary styling - either best performer or normal
    if (isBest && selectedPlayers.length > 1) {
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200 font-semibold';
    }
    
    return 'bg-white text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  };

  const getBestValue = (statKey: string) => {
    const stat = COMPARISON_STATS.find(s => s.key === statKey);
    if (!stat) return null;
    
    const values = selectedPlayers
      .map(player => stat.accessor(player))
      .filter(val => val !== undefined && val !== null) as number[];
    
    return values.length > 0 ? Math.max(...values) : null;
  };

  const _getPlayerStatRank = (player: Player, statKey: string) => {
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
  const _getStatDifference = (player: Player, statKey: string) => {
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
  const _getPerformanceIndicator = (statKey: string, value: number, position: string) => {
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
            
            {/* Simple Header */}
            <div className="flex items-center space-x-4">
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/50 dark:hover:bg-gray-700 rounded-full transition-colors"
              >
                <X className="w-6 h-6 text-gray-500 dark:text-gray-400" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[calc(95vh-100px)] relative">
            {/* Simple explanation */}
            <div className="p-6 pb-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                <Info className="w-4 h-4" />
                <span>Green highlighting shows the best performer for each stat</span>
              </div>
            </div>

            <div className="p-6">
              {/* Enhanced Player Card Selection Area */}
              <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-medium text-gray-900 dark:text-white">
                    Selected Players ({selectedPlayers.length}/4)
                  </h3>
                  {selectedPlayers.length > 0 && (
                    <button
                      onClick={() => setSelectedPlayers([])}
                      className="text-sm text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-colors"
                    >
                      Clear All
                    </button>
                  )}
                </div>

                {/* Enhanced Player Cards with Drag & Drop */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  {Array.from({ length: 4 }).map((_, index) => {
                    const player = selectedPlayers[index];
                    
                    if (!player) {
                      return (
                        <div
                          key={`empty-${index}`}
                          className="aspect-[4/3] border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-800/50"
                        >
                          <Plus className="w-6 h-6 text-gray-400 mb-2" />
                          <span className="text-xs text-gray-400">Search above</span>
                        </div>
                      );
                    }

                    return (
                      <motion.div
                        key={player.id}
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.2 }}
                        draggable
                        onDragStart={() => handleDragStart(index)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, index)}
                        className={`relative aspect-[4/3] bg-gradient-to-br from-white to-gray-50 dark:from-gray-800 dark:to-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm hover:shadow-md transition-all cursor-move ${
                          draggedPlayer === index ? 'scale-105 shadow-lg' : ''
                        }`}
                      >
                        {/* Drag Handle */}
                        <div className="absolute top-2 left-2">
                          <GripVertical className="w-4 h-4 text-gray-400" />
                        </div>
                        
                        {/* Remove Button */}
                        <button
                          onClick={() => removePlayer(player.id)}
                          className="absolute top-2 right-2 w-8 h-8 bg-red-100 hover:bg-red-200 dark:bg-red-900/50 dark:hover:bg-red-800 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>

                        {/* Team Logo & Colors */}
                        <div className="flex flex-col items-center space-y-2">
                          <div className="w-12 h-12 bg-white dark:bg-gray-700 rounded-full flex items-center justify-center border-2 border-gray-200 dark:border-gray-600 shadow-sm">
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
                          
                          {/* Player Info */}
                          <div className="text-center">
                            <div className="font-semibold text-gray-900 dark:text-white text-sm leading-tight">
                              {player.name}
                              {selectedPlayers.filter(p => p.name === player.name).length > 1 && (
                                <span className="ml-1 text-xs bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-200 px-1.5 py-0.5 rounded">
                                  #{index + 1}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {player.team}
                            </div>
                            <span className={`inline-flex mt-2 px-2 py-1 text-xs font-medium rounded-full ${
                              player.position === 'DEF' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200' :
                              player.position === 'MID' ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200' :
                              player.position === 'FWD' ? 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200' :
                              player.position === 'RUC' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200' :
                              'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                            }`}>
                              {player.position}
                            </span>
                          </div>
                          
                          {/* Quick Stats Preview */}
                          <div className="text-xs text-center">
                            <div className="font-medium text-gray-900 dark:text-white">
                              {player.avg?.toFixed(1) || 'N/A'} avg
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                {/* Enhanced Search Section */}
                <div className="space-y-4">
                  {selectedPlayers.length < 4 && (
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search players by name or team..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white shadow-sm"
                      />
                    </div>
                  )}

                  {/* Enhanced Search Results */}
                  {searchTerm && availablePlayers.length > 0 && selectedPlayers.length < 4 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-48 overflow-y-auto">
                      {availablePlayers.map((player) => (
                        <button
                          key={player.id}
                          onClick={() => addPlayer(player)}
                          className="flex items-center space-x-3 p-3 bg-gray-50 dark:bg-gray-800 hover:bg-white dark:hover:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-700 transition-all hover:shadow-sm text-left"
                        >
                          <div className="w-8 h-8 bg-white dark:bg-gray-600 rounded-full flex items-center justify-center border border-gray-200 dark:border-gray-500">
                            <img 
                              src={getTeamLogo(player.team)} 
                              alt={`${player.team} logo`}
                              className="w-5 h-5"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.src = '/logos/fallback.svg';
                              }}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 dark:text-white text-sm truncate">
                              {highlightSearchMatch(player.name, searchTerm)}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {highlightSearchMatch(player.team || '', searchTerm)} • {player.position}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Saved Comparisons */}
                  {savedComparisons.length > 0 && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-700">
                      <div className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-3">
                        Saved Comparisons
                      </div>
                      <div className="space-y-2">
                        {savedComparisons.slice(-3).map((comparison, index) => (
                          <button
                            key={index}
                            onClick={() => setSelectedPlayers(comparison.players)}
                            className="w-full text-left p-2 bg-blue-100 dark:bg-blue-800 hover:bg-blue-200 dark:hover:bg-blue-700 rounded text-xs text-blue-800 dark:text-blue-200 transition-colors"
                          >
                            {comparison.name} ({comparison.players.length} players)
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {selectedPlayers.length >= 2 && (
                <>
                  {/* Redesigned Navigation Layout */}
                  <div className={`mb-6 ${navLayout === 'vertical' ? 'flex gap-6' : ''}`}>
                    {/* Vertical Sidebar Navigation */}
                    {navLayout === 'vertical' && !isMobile && (
                      <div className="w-64 flex-shrink-0">
                        <div className="sticky top-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                          {/* Layout Toggle */}
                          <div className="flex items-center justify-between mb-4">
                            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Navigation</h4>
                            <button
                              onClick={() => setNavLayout('horizontal')}
                              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200"
                            >
                              Switch to Horizontal
                            </button>
                          </div>
                          
                          {/* Stat Search */}
                          <div className="relative mb-4">
                            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <input
                              type="text"
                              placeholder="Search stats..."
                              value={statSearchTerm}
                              onChange={(e) => setStatSearchTerm(e.target.value)}
                              className="w-full pl-7 pr-3 py-2 text-xs border border-gray-300 dark:border-gray-600 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                            />
                          </div>
                          
                          {/* Vertical Category Navigation */}
                          <div className="space-y-2">
                            {STAT_CATEGORIES.map((category) => {
                              const Icon = category.icon;
                              const isActive = selectedCategory === category.key;
                              const statCount = category.key === 'all' ? categoryStats.length : category.count;
                              const isCollapsed = collapsedCategories.has(category.key);
                              
                              return (
                                <div key={category.key}>
                                  <button
                                    onClick={() => {
                                      setSelectedCategory(category.key);
                                      if (category.key !== 'all') {
                                        const newCollapsed = new Set(collapsedCategories);
                                        if (isCollapsed) {
                                          newCollapsed.delete(category.key);
                                        } else {
                                          newCollapsed.add(category.key);
                                        }
                                        setCollapsedCategories(newCollapsed);
                                      }
                                    }}
                                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                                      isActive
                                        ? 'bg-blue-600 text-white shadow-md'
                                        : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                                    }`}
                                    title={category.description}
                                  >
                                    <div className="flex items-center space-x-2">
                                      <Icon className="w-4 h-4" />
                                      <span>{category.label}</span>
                                    </div>
                                    <div className="flex items-center space-x-1">
                                      <span className={`px-2 py-0.5 text-xs rounded-full ${
                                        isActive 
                                          ? 'bg-blue-500 text-blue-100'
                                          : 'bg-gray-200 text-gray-600 dark:bg-gray-600 dark:text-gray-300'
                                      }`}>
                                        {statCount}
                                      </span>
                                      {category.key !== 'all' && (
                                        <ChevronDown className={`w-3 h-3 transition-transform ${isCollapsed ? '' : 'rotate-180'}`} />
                                      )}
                                    </div>
                                  </button>
                                  
                                  {/* Collapsible Stat List */}
                                  {category.key !== 'all' && isActive && !isCollapsed && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      className="mt-2 ml-4 space-y-1"
                                    >
                                      {COMPARISON_STATS
                                        .filter(stat => stat.category === category.key)
                                        .filter(stat => !statSearchTerm || stat.label.toLowerCase().includes(statSearchTerm.toLowerCase()))
                                        .map((stat) => (
                                          <div
                                            key={stat.key}
                                            className="text-xs text-gray-600 dark:text-gray-400 py-1 px-2 rounded hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer"
                                            title={stat.description}
                                          >
                                            {stat.label}
                                          </div>
                                        ))
                                      }
                                    </motion.div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          
                          {/* View Options */}
                          <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-gray-600 dark:text-gray-400">View Mode</span>
                                <div className="flex bg-gray-100 dark:bg-gray-700 rounded p-1">
                                  <button
                                    onClick={() => setViewMode('condensed')}
                                    className={`px-2 py-1 text-xs rounded transition-colors ${
                                      viewMode === 'condensed'
                                        ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                                        : 'text-gray-600 dark:text-gray-400'
                                    }`}
                                  >
                                    <Eye className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={() => setViewMode('expanded')}
                                    className={`px-2 py-1 text-xs rounded transition-colors ${
                                      viewMode === 'expanded'
                                        ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                                        : 'text-gray-600 dark:text-gray-400'
                                    }`}
                                  >
                                    <EyeOff className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Main Content Area */}
                    <div className={`${navLayout === 'vertical' && !isMobile ? 'flex-1' : 'w-full'}`}>
                      {/* Horizontal Navigation (when not in vertical mode) */}
                      {(navLayout === 'horizontal' || isMobile) && (
                        <div className="sticky top-0 bg-white dark:bg-gray-800 z-10 border-b border-gray-200 dark:border-gray-700 pb-4 mb-6">
                          <div className="flex flex-col space-y-4">
                            <div className="flex items-center justify-between">
                              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Statistics Categories
                              </h3>
                              
                              {!isMobile && (
                                <button
                                  onClick={() => setNavLayout('vertical')}
                                  className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200"
                                >
                                  Switch to Sidebar
                                </button>
                              )}
                            </div>
                            
                            {/* Horizontal Categories */}
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

                            {/* Horizontal View Controls */}
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
                      )}

                      {/* Enhanced Table Layout */}
                      {isMobile ? (
                        /* Mobile: Stat-by-Stat View with Swipe Gestures */
                        <div className="space-y-6">
                          {selectedPlayers.map((player, playerIndex) => (
                            <motion.div
                              key={player.id}
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: playerIndex * 0.1 }}
                              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm"
                            >
                              {/* Enhanced Mobile Player Header */}
                              <div className="bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                                <div className="flex items-center space-x-4">
                                  <div className="w-12 h-12 bg-white dark:bg-gray-700 rounded-full flex items-center justify-center border-2 border-gray-200 dark:border-gray-600 shadow-sm">
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
                                      <h3 className="text-lg font-bold text-gray-900 dark:text-white">{player.name}</h3>
                                      {selectedPlayers.filter(p => p.name === player.name).length > 1 && (
                                        <span className="text-xs bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200 px-2 py-1 rounded">
                                          #{playerIndex + 1}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center space-x-3 mt-1">
                                      <span className="text-sm text-gray-600 dark:text-gray-400">{player.team}</span>
                                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
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
                              <div className="p-6">
                                <div className={viewMode === 'condensed' ? 'grid grid-cols-3 gap-4' : 'grid grid-cols-2 gap-4'}>
                                  {(viewMode === 'condensed' ? categoryStats.filter(s => s.priority === 'high') : categoryStats).map((stat) => {
                                    const value = stat.accessor(player);
                                    const isBest = value === getBestValue(stat.key) && value !== undefined && value !== null;
                                    
                                    return (
                                      <div key={stat.key} className="text-center">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-2 font-medium" title={stat.description}>
                                          {stat.label}
                                        </div>
                                        
                                        <div className={`text-lg font-semibold rounded-lg py-2 px-3 ${
                                          getEnhancedPerformanceStyle(stat.key, value || 0, player.position || '', isBest)
                                        }`}>
                                          {value !== undefined && value !== null 
                                            ? stat.format ? stat.format(value) : value.toString()
                                            : '-'
                                          }
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      ) : (
                        /* Desktop: Enhanced Table Layout with Sticky Headers */
                        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg">
                          <table className="w-full">
                            {/* Super Sticky Header Row */}
                            <thead className="sticky top-0 bg-white dark:bg-gray-900 z-20 shadow-sm">
                              <tr>
                                <th className="px-4 py-3 text-left text-sm font-medium text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 min-w-32 bg-white dark:bg-gray-900">
                                  Statistic
                                </th>
                                {selectedPlayers.map((player, index) => (
                                  <th 
                                    key={player.id} 
                                    className="px-4 py-3 text-center text-sm font-medium text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 min-w-28 bg-white dark:bg-gray-900"
                                    style={{ position: 'sticky', top: 0 }}
                                  >
                                    <div className="space-y-1">
                                      {/* Compact Team Logo */}
                                      <div className="flex justify-center">
                                        <div className="w-6 h-6 bg-gray-50 dark:bg-gray-800 rounded-full flex items-center justify-center">
                                          <img 
                                            src={getTeamLogo(player.team)} 
                                            alt={`${player.team} logo`}
                                            className="w-4 h-4"
                                            onError={(e) => {
                                              const target = e.target as HTMLImageElement;
                                              target.src = '/logos/fallback.svg';
                                            }}
                                          />
                                        </div>
                                      </div>
                                      
                                      {/* Compact Player Name */}
                                      <div className="text-xs font-medium text-gray-900 dark:text-white">
                                        <div className="flex items-center justify-center space-x-1">
                                          <span className="truncate max-w-20">{player.name.split(' ').slice(-1)[0]}</span>
                                          {selectedPlayers.filter(p => p.name === player.name).length > 1 && (
                                            <span className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 px-1 rounded">
                                              {index + 1}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      
                                      {/* Compact Position */}
                                      <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {player.position}
                                      </div>
                                    </div>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                              {(viewMode === 'condensed' ? categoryStats.filter(s => s.priority === 'high') : categoryStats).map((stat, index) => {
                                
                                return (
                                  <tr 
                                    key={stat.key} 
                                    className={`${
                                      index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-900/50'
                                    } hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors`}
                                  >
                                    <td 
                                      className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white sticky left-0 bg-inherit"
                                    >
                                      <span className="text-sm">{stat.label}</span>
                                    </td>
                                    {selectedPlayers.map((player) => {
                                      const value = stat.accessor(player);
                                      const isBest = value === getBestValue(stat.key) && value !== undefined && value !== null;
                                      
                                      return (
                                        <td key={player.id} className="px-4 py-3 text-center">
                                          <div className={`text-sm font-medium rounded py-1 px-2 ${
                                            getEnhancedPerformanceStyle(stat.key, value || 0, player.position || '', isBest)
                                          }`}>
                                            {value !== undefined && value !== null 
                                              ? stat.format ? stat.format(value) : value.toString()
                                              : '-'
                                            }
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
                    </div>
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
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
