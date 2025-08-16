'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { fetchApi } from '@/lib/api';
import { AppLayout } from '@/components/navigation';
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
  { value: 'overall', label: 'Overall Ranking' },
  { value: 'goals', label: 'Goals' },
  { value: 'goal_assists', label: 'Goal Assists' },
  { value: 'tackles', label: 'Tackles' },
  { value: 'clearances', label: 'Clearances' },
  { value: 'inside_50s', label: 'Inside 50s' },
  { value: 'rebound_50s', label: 'Rebound 50s' },
  { value: 'hitouts', label: 'Hitouts' },
  { value: 'intercepts', label: 'Intercepts' },
  { value: 'marks', label: 'Marks' },
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

// Z-score bar component for mini visualizations
interface ZScoreBarProps {
  zScore: number;
  category: RankingCategory;
  perGame: number;
}

function ZScoreBar({ zScore, category, perGame }: ZScoreBarProps) {
  const normalizedWidth = Math.min(100, Math.max(0, ((zScore + 3) / 6) * 100));
  const color =
    zScore > 1
      ? 'bg-green-500'
      : zScore > 0
        ? 'bg-blue-500'
        : zScore > -1
          ? 'bg-yellow-500'
          : 'bg-red-500';

  return (
    <div
      className="relative h-6 bg-gray-100 rounded-sm overflow-hidden"
      title={`${CATEGORY_LABELS[category].full}: ${perGame.toFixed(1)} per game (z-score: ${zScore.toFixed(2)})`}
    >
      <div
        className={`h-full ${color} transition-all duration-200`}
        style={{ width: `${normalizedWidth}%` }}
        aria-label={`${CATEGORY_LABELS[category].full} z-score ${zScore.toFixed(2)}`}
      />
      <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-700">
        {CATEGORY_LABELS[category].short}
      </span>
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
                <h4 className="font-semibold text-gray-900">{player.playerName}</h4>
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

                {/* Category mini-bars */}
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
                      <ZScoreBar
                        zScore={player.categories[cat].zScore}
                        category={cat}
                        perGame={player.categories[cat].perGame}
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
  const [error, setError] = useState<string | null>(null);

  // Filter states
  const [period, setPeriod] = useState('season');
  const [position, setPosition] = useState('ALL');
  const [ownership, setOwnership] = useState('');
  const [sortBy, setSortBy] = useState('overall');
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Comparison states
  const [comparisonMode, setComparisonMode] = useState(false);
  const [selectedPlayers, setSelectedPlayers] = useState<Set<string>>(new Set());

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchText);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchText]);

  // Fetch rankings data
  const fetchRankings = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        season: '2025',
        period,
        sortBy,
        limit: '200',
      });

      if (position !== 'ALL') params.append('position', position);
      if (ownership) params.append('ownership', ownership);
      if (debouncedSearch) params.append('search', debouncedSearch);

      const response = await fetchApi(`rankings?${params}`);
      setRankings(response.data?.players || response.players || response);
    } catch (err) {
      setError('Failed to load rankings');
      console.error('Rankings fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [period, position, ownership, sortBy, debouncedSearch]);

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

  if (loading) {
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
              <h1 className="text-3xl font-bold text-gray-900 mb-2">9-Category Player Rankings</h1>
              <p className="text-gray-600">
                Comprehensive rankings based on 9 key AFL statistics with Z-score normalization
              </p>
            </div>
            <div className="flex items-center space-x-4">
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
        </div>

        {/* Controls Section */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6 space-y-4">
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
              <select
                id="sortBy"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
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
          <div className="overflow-x-auto">
            <table className="w-full" role="table">
              <caption className="sr-only">
                Player rankings based on 9 AFL statistical categories
              </caption>
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  {comparisonMode && (
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Select
                    </th>
                  )}
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Rank
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Player
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Games
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Overall
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
                    >
                      {CATEGORY_LABELS[cat].short}
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
              <tbody className="bg-white divide-y divide-gray-200">
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
                        <Link
                          href={`/players/${player.playerId}`}
                          className="text-lg font-semibold text-gray-900 hover:text-blue-600 transition-colors"
                        >
                          {player.playerName}
                        </Link>
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
                        <ZScoreBar
                          zScore={player.categories[cat].zScore}
                          category={cat}
                          perGame={player.categories[cat].perGame}
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
          Showing {displayedRankings.length} player{displayedRankings.length !== 1 ? 's' : ''} •
          Rankings updated every 5 minutes • Z-scores normalize for fair comparison across
          categories
        </div>
      </main>
    </AppLayout>
  );
}
