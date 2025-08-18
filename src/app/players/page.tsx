'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { fetchApi } from '@/lib/api';
import { AppLayout } from '@/components/navigation';
import PlayerSearch from '@/components/PlayerSearch';
import PlayerLink from '@/components/PlayerLink';
import type {
  RankingCategory,
  PlayerRanking,
  OwnershipStatus,
} from '@/app/api/rankings/route';

// Period options for dropdown
const PERIOD_OPTIONS = [
  { value: 'season', label: 'Season' },
  { value: 'last3', label: 'Last 3 Games' },
  { value: 'last5', label: 'Last 5 Games' },
  { value: 'last10', label: 'Last 10 Games' },
  { value: 'round=1', label: 'Round 1' },
  { value: 'round=2', label: 'Round 2' },
  { value: 'round=3', label: 'Round 3' },
  { value: 'since=2025-08-01', label: 'Since Aug 1' },
];

// Position options
const POSITION_OPTIONS = [
  { value: 'ALL', label: 'All Positions' },
  { value: 'DEF', label: 'Defenders' },
  { value: 'MID', label: 'Midfielders' },
  { value: 'RUC', label: 'Rucks' },
  { value: 'FWD', label: 'Forwards' },
];

// Sort options
const SORT_OPTIONS = [
  { value: 'overall', label: 'Overall Ranking', group: 'General' },
  { value: 'name', label: 'Player Name', group: 'General' },
  { value: 'team', label: 'Team', group: 'General' },
  { value: 'position', label: 'Position', group: 'General' },
  { value: 'goals', label: 'Goals', group: 'Scoring' },
  { value: 'goal_assists', label: 'Goal Assists', group: 'Scoring' },
  { value: 'tackles', label: 'Tackles', group: 'Defensive' },
  { value: 'intercepts', label: 'Intercepts', group: 'Defensive' },
  { value: 'clearances', label: 'Clearances', group: 'Ball Movement' },
  { value: 'inside_50s', label: 'Inside 50s', group: 'Ball Movement' },
  { value: 'rebound_50s', label: 'Rebound 50s', group: 'Ball Movement' },
  { value: 'hitouts', label: 'Hitouts', group: 'Ruck' },
  { value: 'marks', label: 'Marks', group: 'Possession' },
];

// Category labels for display
const CATEGORY_LABELS: Record<RankingCategory, { short: string; full: string }> = {
  goals: { short: 'G', full: 'Goals' },
  goal_assists: { short: 'GA', full: 'Goal Assists' },
  tackles: { short: 'T', full: 'Tackles' },
  clearances: { short: 'CL', full: 'Clearances' },
  inside_50s: { short: 'I50', full: 'Inside 50s' },
  rebound_50s: { short: 'R50', full: 'Rebound 50s' },
  hitouts: { short: 'HO', full: 'Hitouts' },
  intercepts: { short: 'I', full: 'Intercepts' },
  marks: { short: 'M', full: 'Marks' },
};

// Numerical stat display component - shows actual numbers instead of bars
interface StatCellProps {
  perGame: number;
  zScore: number;
  category: RankingCategory;
}

function StatCell({ perGame, zScore, category: _ }: StatCellProps) {
  // Color based on performance level
  const getPerformanceColor = (z: number) => {
    if (z > 1.5) return 'text-green-600 bg-green-50';
    if (z > 0.5) return 'text-blue-600 bg-blue-50';
    if (z > -0.5) return 'text-gray-600 bg-gray-50';
    if (z > -1.5) return 'text-orange-600 bg-orange-50';
    return 'text-red-600 bg-red-50';
  };

  const performanceClass = getPerformanceColor(zScore);

  return (
    <div className={`px-2 py-1 rounded text-center ${performanceClass}`}>
      <div className="font-bold text-sm">{perGame.toFixed(1)}</div>
      <div className="text-xs opacity-75">z: {zScore.toFixed(1)}</div>
    </div>
  );
}

// Ownership badge component
interface OwnershipBadgeProps {
  ownership: OwnershipStatus;
}

function OwnershipBadge({ ownership }: OwnershipBadgeProps) {
  const styles = {
    OWNED: 'bg-red-100 text-red-800',
    WAIVER: 'bg-yellow-100 text-yellow-800',
    AVAILABLE: 'bg-green-100 text-green-800',
  };

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[ownership]}`}>
      {ownership === 'AVAILABLE' ? 'FA' : ownership}
    </span>
  );
}

// Action button component
interface ActionButtonProps {
  player: PlayerRanking;
}

function ActionButton({ player }: ActionButtonProps) {
  const handleAction = () => {
    // TODO: Implement actual add/claim/view actions
    console.log(`Action for ${player.playerName} (${player.ownership})`);
  };

  const buttonText = {
    OWNED: 'View',
    WAIVER: 'Claim',
    AVAILABLE: 'Add',
  };

  const buttonStyle = {
    OWNED: 'bg-blue-600 hover:bg-blue-700',
    WAIVER: 'bg-yellow-600 hover:bg-yellow-700',
    AVAILABLE: 'bg-green-600 hover:bg-green-700',
  };

  return (
    <button
      onClick={handleAction}
      className={`px-3 py-1 text-white text-sm rounded-md transition-colors ${buttonStyle[player.ownership]}`}
    >
      {buttonText[player.ownership]}
    </button>
  );
}

// Player comparison panel component
interface ComparisonPanelProps {
  players: PlayerRanking[];
  onClearSelection: () => void;
}

function ComparisonPanel({ players, onClearSelection }: ComparisonPanelProps) {
  if (players.length === 0) return null;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-blue-900">
          Player Comparison ({players.length}/5)
        </h3>
        <button
          onClick={onClearSelection}
          className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          Clear All
        </button>
      </div>

      <div className="overflow-x-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {players.map((player) => (
            <div key={player.playerId} className="bg-white rounded-lg p-4 shadow-sm border">
              <div className="text-center mb-3">
                <PlayerLink
                  playerName={player.playerName}
                  className="font-semibold text-gray-900 hover:text-blue-600"
                  showTooltip
                />
                <p className="text-sm text-gray-500">
                  {player.team} - {player.position}
                </p>
                <p className="text-lg font-bold text-blue-600">#{player.rank}</p>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Overall:</span>
                  <span className="font-semibold">{player.overall.toFixed(1)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Games:</span>
                  <span className="font-semibold">{player.games}</span>
                </div>

                {/* Category mini-stats with actual numbers */}
                <div className="grid grid-cols-3 gap-1 mt-3">
                  {(
                    [
                      'goals',
                      'goal_assists',
                      'tackles',
                      'clearances',
                      'inside_50s',
                      'rebound_50s',
                      'hitouts',
                      'intercepts',
                      'marks',
                    ] as RankingCategory[]
                  ).map((cat) => (
                    <div key={cat} className="text-center">
                      <div className="text-xs text-gray-500 mb-1">{CATEGORY_LABELS[cat].short}</div>
                      <StatCell
                        perGame={player.categories[cat].perGame}
                        zScore={player.categories[cat].zScore}
                        category={cat}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {players.length >= 2 && (
        <div className="mt-4 text-center">
          <p className="text-sm text-blue-700">
            Select up to 5 players to compare their stats side by side
          </p>
        </div>
      )}
    </div>
  );
}

export default function PlayersPage() {
  const [rankings, setRankings] = useState<PlayerRanking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter states
  const [period, setPeriod] = useState('season');
  const [position, setPosition] = useState('ALL');
  const [ownership, setOwnership] = useState('');
  const [sortBy, setSortBy] = useState('overall');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Comparison states
  const [comparisonMode, setComparisonMode] = useState(false);
  const [selectedPlayers, setSelectedPlayers] = useState<Set<string>>(new Set());

  // Sort handling function
  const handleSortChange = (newSortBy: string) => {
    if (newSortBy === sortBy) {
      // Toggle direction if same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New column, use appropriate default direction
      setSortBy(newSortBy);
      // Overall ranking should be ascending (1st, 2nd, 3rd), stats should be descending (highest first)
      setSortDirection(newSortBy === 'overall' || newSortBy === 'name' ? 'asc' : 'desc');
    }
  };

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchText);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchText]);

  // Fetch rankings data
  const fetchRankings = useCallback(async () => {
    // Use different loading states for initial vs subsequent loads
    if (rankings.length === 0) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);

    try {
      const params = new URLSearchParams({
        season: '2025',
        period,
        sortBy,
        sortDirection,
        // Remove limit to get all players
      });

      if (position !== 'ALL') params.append('position', position);
      if (ownership) params.append('ownership', ownership);
      if (debouncedSearch) params.append('search', debouncedSearch);

      const response = await fetchApi(`rankings?${params}`);
      setRankings(response.data?.players || response.players || response);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load rankings';
      setError(errorMessage);
      console.error('Rankings fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period, position, ownership, sortBy, sortDirection, debouncedSearch, rankings.length]);

  useEffect(() => {
    fetchRankings();
  }, [fetchRankings]);

  // Memoized filtered data for performance
  const displayedRankings = useMemo(() => rankings, [rankings]);

  // Comparison handlers
  const togglePlayerSelection = (playerId: string) => {
    setSelectedPlayers((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(playerId)) {
        newSet.delete(playerId);
      } else if (newSet.size < 5) {
        // Limit to 5 players for comparison
        newSet.add(playerId);
      }
      return newSet;
    });
  };

  const clearSelection = () => {
    setSelectedPlayers(new Set());
  };

  const toggleComparisonMode = () => {
    setComparisonMode(!comparisonMode);
    if (!comparisonMode) {
      clearSelection();
    }
  };

  const getSelectedPlayersData = (): PlayerRanking[] => {
    return rankings.filter((player) => selectedPlayers.has(player.playerId));
  };

  if (loading && rankings.length === 0) {
    return (
      <AppLayout>
        <div className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-1/4"></div>
            <div className="h-16 bg-gray-200 rounded"></div>
            <div className="space-y-2">
              {[...Array(10)].map((_, i) => (
                <div key={i} className="h-16 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <h2 className="text-red-800 font-semibold">Error Loading Rankings</h2>
            <p className="text-red-600">{error}</p>
            <button
              onClick={fetchRankings}
              className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <main className="p-6 max-w-7xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Player Performance Rankings</h1>
              <p className="text-gray-600">
                Detailed statistics and performance metrics • Numbers show per-game averages with Z-scores
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right text-sm text-gray-500">
                <p>📊 Per-game averages</p>
                <p>📈 Z-score performance ratings</p>
              </div>
              <button
                onClick={toggleComparisonMode}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  comparisonMode
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {comparisonMode ? (
                  <>Exit Comparison {selectedPlayers.size > 0 && `(${selectedPlayers.size})`}</>
                ) : (
                  'Compare Players'
                )}
              </button>
            </div>
          </div>

          {/* Quick Player Search */}
          <div className="mt-4">
            <PlayerSearch 
              placeholder="Quick search for any player..."
              variant="detailed"
              size="lg"
              className="max-w-md"
            />
          </div>
        </div>

        {/* Data Legend */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">📊 How to Read the Data</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-blue-800">
            <div>
              <strong>Per-game averages:</strong> The larger number shows average performance per game
            </div>
            <div>
              <strong>Z-scores:</strong> The smaller number (z: X.X) shows how much above/below average (+2.0 = excellent, 0.0 = average, -2.0 = poor)
            </div>
            <div>
              <strong>Colors:</strong> 
              <span className="text-green-600">Green = Excellent</span>, 
              <span className="text-blue-600 ml-1">Blue = Good</span>, 
              <span className="text-gray-600 ml-1">Gray = Average</span>, 
              <span className="text-orange-600 ml-1">Orange = Below</span>, 
              <span className="text-red-600 ml-1">Red = Poor</span>
            </div>
          </div>
        </div>

        {/* Controls Section */}
        <div className={`bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6 space-y-4 transition-opacity ${
          refreshing ? 'opacity-75' : ''
        }`}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Period Selector */}
            <div>
              <label htmlFor="period" className="block text-sm font-medium text-gray-700 mb-1">
                Period
              </label>
              <select
                id="period"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {PERIOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Position Filter */}
            <div>
              <label htmlFor="position" className="block text-sm font-medium text-gray-700 mb-1">
                Position
              </label>
              <select
                id="position"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {POSITION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Ownership Filter */}
            <div>
              <label htmlFor="ownership" className="block text-sm font-medium text-gray-700 mb-1">
                Ownership
              </label>
              <select
                id="ownership"
                value={ownership}
                onChange={(e) => setOwnership(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Players</option>
                <option value="owned">Owned</option>
                <option value="available">Available</option>
                <option value="waiver">On Waivers</option>
              </select>
            </div>

            {/* Sort By */}
            <div>
              <label htmlFor="sortBy" className="block text-sm font-medium text-gray-700 mb-1">
                Sort By
              </label>
              <div className="flex gap-2">
                <select
                  id="sortBy"
                  value={sortBy}
                  onChange={(e) => handleSortChange(e.target.value)}
                  disabled={refreshing}
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <optgroup label="General">
                    {SORT_OPTIONS.filter(opt => opt.group === 'General').map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Scoring">
                    {SORT_OPTIONS.filter(opt => opt.group === 'Scoring').map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Defensive">
                    {SORT_OPTIONS.filter(opt => opt.group === 'Defensive').map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Ball Movement">
                    {SORT_OPTIONS.filter(opt => opt.group === 'Ball Movement').map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Ruck">
                    {SORT_OPTIONS.filter(opt => opt.group === 'Ruck').map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Possession">
                    {SORT_OPTIONS.filter(opt => opt.group === 'Possession').map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <button
                  type="button"
                  onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                  disabled={refreshing}
                  className="px-3 py-2 border border-gray-300 rounded-md bg-white hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                  title={`Currently: ${sortDirection === 'asc' ? 'Ascending' : 'Descending'}`}
                >
                  {sortDirection === 'asc' ? '↑' : '↓'}
                </button>
              </div>
            </div>
          </div>

          {/* Search Input */}
          <div>
            <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">
              Search Players
            </label>
            <input
              id="search"
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search by player name or team..."
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Quick Sort Buttons */}
          <div>
            <div className="block text-sm font-medium text-gray-700 mb-2">
              Quick Sort
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleSortChange('overall')}
                disabled={refreshing}
                className={`px-3 py-1 text-xs rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  sortBy === 'overall'
                    ? 'bg-blue-100 border-blue-300 text-blue-700'
                    : 'bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100'
                }`}
              >
                Overall {sortBy === 'overall' && (sortDirection === 'asc' ? '↑' : '↓')}
              </button>
              <button
                onClick={() => handleSortChange('goals')}
                disabled={refreshing}
                className={`px-3 py-1 text-xs rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  sortBy === 'goals'
                    ? 'bg-blue-100 border-blue-300 text-blue-700'
                    : 'bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100'
                }`}
              >
                Goals {sortBy === 'goals' && (sortDirection === 'asc' ? '↑' : '↓')}
              </button>
              <button
                onClick={() => handleSortChange('tackles')}
                disabled={refreshing}
                className={`px-3 py-1 text-xs rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  sortBy === 'tackles'
                    ? 'bg-blue-100 border-blue-300 text-blue-700'
                    : 'bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100'
                }`}
              >
                Tackles {sortBy === 'tackles' && (sortDirection === 'asc' ? '↑' : '↓')}
              </button>
              <button
                onClick={() => handleSortChange('marks')}
                disabled={refreshing}
                className={`px-3 py-1 text-xs rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  sortBy === 'marks'
                    ? 'bg-blue-100 border-blue-300 text-blue-700'
                    : 'bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100'
                }`}
              >
                Marks {sortBy === 'marks' && (sortDirection === 'asc' ? '↑' : '↓')}
              </button>
              <button
                onClick={() => handleSortChange('hitouts')}
                disabled={refreshing}
                className={`px-3 py-1 text-xs rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  sortBy === 'hitouts'
                    ? 'bg-blue-100 border-blue-300 text-blue-700'
                    : 'bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100'
                }`}
              >
                Hitouts {sortBy === 'hitouts' && (sortDirection === 'asc' ? '↑' : '↓')}
              </button>
            </div>
          </div>
        </div>

        {/* Comparison Panel */}
        {comparisonMode && (
          <>
            {selectedPlayers.size === 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <div className="text-center">
                  <h3 className="text-lg font-semibold text-blue-900 mb-2">
                    Player Comparison Mode
                  </h3>
                  <p className="text-blue-700">
                    Select up to 5 players from the table below to compare their stats side by side
                  </p>
                </div>
              </div>
            )}

            <ComparisonPanel players={getSelectedPlayersData()} onClearSelection={clearSelection} />
          </>
        )}

        {/* Rankings Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-600 flex items-center justify-between">
            <span>
              💡 <strong>Tip:</strong> Click column headers to sort by different stats
            </span>
            {refreshing && (
              <span className="flex items-center gap-2 text-blue-600">
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Updating...
              </span>
            )}
          </div>
          <div className="relative overflow-auto max-h-[80vh]">
            {refreshing && (
              <div className="absolute inset-0 bg-white bg-opacity-75 backdrop-blur-sm z-10 flex items-center justify-center">
                <div className="flex items-center gap-3 text-gray-600">
                  <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span className="font-medium">Updating rankings...</span>
                </div>
              </div>
            )}
            <table className="w-full" role="table">
              <caption className="sr-only">
                Player rankings based on 9 AFL statistical categories
              </caption>
              <thead className="bg-gray-50 sticky top-0 z-50 shadow-sm">
                <tr>
                  {comparisonMode && (
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 sticky top-0"
                    >
                      Select
                    </th>
                  )}
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 sticky top-0"
                  >
                    <button
                      onClick={() => handleSortChange('overall')}
                      disabled={refreshing}
                      className="flex items-center gap-1 hover:text-gray-700 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Sort by overall ranking"
                    >
                      Rank
                      {sortBy === 'overall' && (
                        <span className="text-blue-600">
                          {sortDirection === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </button>
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 sticky top-0"
                  >
                    <button
                      onClick={() => handleSortChange('name')}
                      disabled={refreshing}
                      className="flex items-center gap-1 hover:text-gray-700 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Sort by player name"
                    >
                      Player
                      {sortBy === 'name' && (
                        <span className="text-blue-600">
                          {sortDirection === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </button>
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 sticky top-0"
                  >
                    Games
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 sticky top-0"
                  >
                    <button
                      onClick={() => handleSortChange('overall')}
                      disabled={refreshing}
                      className="flex items-center gap-1 hover:text-gray-700 focus:outline-none mx-auto disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Sort by overall ranking"
                    >
                      Overall
                      {sortBy === 'overall' && (
                        <span className="text-blue-600">
                          {sortDirection === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </button>
                  </th>
                  {(
                    [
                      'goals',
                      'goal_assists',
                      'tackles',
                      'clearances',
                      'inside_50s',
                      'rebound_50s',
                      'hitouts',
                      'intercepts',
                      'marks',
                    ] as RankingCategory[]
                  ).map((cat) => (
                    <th
                      key={cat}
                      scope="col"
                      className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider"
                      title={`${CATEGORY_LABELS[cat].full} - Per game average & Z-score`}
                    >
                      <button
                        onClick={() => handleSortChange(cat)}
                        disabled={refreshing}
                        className="flex flex-col items-center gap-0 hover:text-gray-700 focus:outline-none w-full disabled:opacity-50 disabled:cursor-not-allowed"
                        title={`Sort by ${CATEGORY_LABELS[cat].full}`}
                      >
                        <div className="flex items-center gap-1">
                          {CATEGORY_LABELS[cat].short}
                          {sortBy === cat && (
                            <span className="text-blue-600 text-xs">
                              {sortDirection === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] normal-case font-normal opacity-75">avg/z</div>
                      </button>
                    </th>
                  ))}
                  <th
                    scope="col"
                    className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className={`bg-white divide-y divide-gray-200 transition-opacity ${
                refreshing ? 'opacity-60' : ''
              }`}>
                {displayedRankings.map((player) => (
                  <tr key={player.playerId} className="hover:bg-gray-50 transition-colors">
                    {comparisonMode && (
                      <td className="px-4 py-4 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={selectedPlayers.has(player.playerId)}
                          onChange={() => togglePlayerSelection(player.playerId)}
                          disabled={
                            !selectedPlayers.has(player.playerId) && selectedPlayers.size >= 5
                          }
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                      </td>
                    )}
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="text-lg font-bold text-gray-900">#{player.rank}</div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div>
                        <PlayerLink
                          playerName={player.playerName}
                          className="text-lg font-semibold text-gray-900 hover:text-blue-600 transition-colors"
                          showTooltip
                        />
                        <div className="text-sm text-gray-500">
                          {player.team} — {player.position}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-center">
                      <span className="text-sm font-medium text-gray-900">{player.games}</span>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-center">
                      <span className="text-lg font-bold text-blue-600">
                        {player.overall.toFixed(1)}
                      </span>
                    </td>
                    {(
                      [
                        'goals',
                        'goal_assists',
                        'tackles',
                        'clearances',
                        'inside_50s',
                        'rebound_50s',
                        'hitouts',
                        'intercepts',
                        'marks',
                      ] as RankingCategory[]
                    ).map((cat) => (
                      <td key={cat} className="px-2 py-4 whitespace-nowrap">
                        <StatCell
                          perGame={player.categories[cat].perGame}
                          zScore={player.categories[cat].zScore}
                          category={cat}
                        />
                      </td>
                    ))}
                    <td className="px-4 py-4 whitespace-nowrap text-center">
                      <OwnershipBadge ownership={player.ownership} />
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-center">
                      <ActionButton player={player} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {displayedRankings.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-500">No players found matching your criteria.</p>
            </div>
          )}
        </div>

        {/* Summary Stats */}
        <div className="mt-6 text-sm text-gray-600 text-center">
          Showing all {displayedRankings.length} player{displayedRankings.length !== 1 ? 's' : ''} •
          Rankings updated every 5 minutes • Z-scores normalize for fair comparison across
          categories
        </div>
      </main>
    </AppLayout>
  );
}
