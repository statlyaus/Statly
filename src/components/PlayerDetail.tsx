'use client';

import { useEffect, useState } from 'react';
import type { Player } from '@/types/players';
import { fetchApi } from '@/lib/api';
import { LoadingSpinner } from './ui';
import {
  ChartBarIcon,
  TrophyIcon,
  FireIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
} from '@heroicons/react/24/outline';

type PlayerDetailProps = {
  player: Player;
};

interface MatchData {
  id: string;
  round: number;
  date: string;
  venue: string;
  team: string;
  opposition: string;
  fantasyScore: number;
  totalValue: number;
  disposals: number;
  kicks: number;
  handballs: number;
  marks: number;
  goals: number;
  behinds: number;
  tackles: number;
  hitouts: number;
  inside50s: number;
  rebound50s: number;
  clangers: number;
  contestedPossessions: number;
  uncontestePossessions: number;
  effectiveDisposals: number;
  disposalEfficiency: number;
  contestedMarks: number;
  intercepts: number;
}

interface PlayerStats {
  player: {
    name: string;
    team: string;
    position: string;
  };
  season: {
    totals: Record<string, number>;
    averages: Record<string, number>;
    disposalEfficiency: number;
  };
  recentForm: {
    games: number;
    matches: Array<{
      round: number;
      supercoachScore: number;
      playerValue: number;
      opposition: string;
    }>;
    averages: {
      supercoachScore: number;
      playerValue: number;
    };
  };
  performance: {
    highestScore: number;
    lowestScore: number;
    mostGoals: number;
    mostDisposals: number;
    consistency: number;
  };
}

export const PlayerDetail = ({ player }: PlayerDetailProps) => {
  const [matchLogs, setMatchLogs] = useState<MatchData[]>([]);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'matches' | 'stats'>('overview');

  useEffect(() => {
    if (!player || (!player.name && !player.id)) {
      setLoading(false);
      return;
    }

    const fetchPlayerData = async () => {
      try {
        setLoading(true);
        
        // Use player name if available, otherwise use id
        const identifier = player.name || player.id;
        
        // Fetch both matches and stats
        const [matchesResponse, statsResponse] = await Promise.all([
          fetchApi(`players/${encodeURIComponent(identifier)}/matches`),
          fetchApi(`players/${encodeURIComponent(identifier)}/stats`)
        ]);

        setMatchLogs(matchesResponse.matches || []);
        setStats(statsResponse);
      } catch (err: unknown) {
        setError('Failed to load player data.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchPlayerData();
  }, [player]);

  if (!player) {
    return <p>No player data available.</p>;
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center p-8">
        <p className="text-red-500 mb-4">{error}</p>
        <button 
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Player Header */}
      <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-xl font-bold">
              {player.name.split(' ').map(n => n[0]).join('')}
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{player.name}</h1>
              <p className="text-gray-600 text-lg">
                {stats?.player.team || player.team} • {stats?.player.position || player.position || 'Unknown Position'}
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-blue-600">
              {stats?.season.averages.supercoachScore || 0}
            </div>
            <div className="text-sm text-gray-500">Avg SuperCoach</div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-white rounded-xl shadow-lg mb-6">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6">
            {[
              { key: 'overview', label: 'Overview', icon: ChartBarIcon },
              { key: 'matches', label: 'Match Log', icon: TrophyIcon },
              { key: 'stats', label: 'Season Stats', icon: FireIcon },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key as typeof activeTab)}
                className={`flex items-center space-x-2 py-4 border-b-2 font-medium transition-colors ${
                  activeTab === key
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab stats={stats} matchLogs={matchLogs} />}
      {activeTab === 'matches' && <MatchLogTab matchLogs={matchLogs} />}
      {activeTab === 'stats' && <StatsTab stats={stats} />}
    </div>
  );
};

// Overview Tab Component
function OverviewTab({ stats, matchLogs }: { stats: PlayerStats | null; matchLogs: MatchData[] }) {
  if (!stats) {
    return <div className="text-center py-8">No statistics available</div>;
  }

  return (
    <div className="space-y-6">
      {/* Quick Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Games Played"
          value={stats.season.totals.games}
          icon={TrophyIcon}
          className="bg-blue-50 border-blue-200"
        />
        <StatCard
          title="Avg SuperCoach"
          value={stats.season.averages.supercoachScore}
          icon={FireIcon}
          className="bg-orange-50 border-orange-200"
        />
        <StatCard
          title="Total Goals"
          value={stats.season.totals.goals}
          icon={TrophyIcon}
          className="bg-green-50 border-green-200"
        />
        <StatCard
          title="Consistency"
          value={`${stats.performance.consistency}%`}
          icon={ArrowTrendingUpIcon}
          className="bg-purple-50 border-purple-200"
        />
      </div>

      {/* Recent Form */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h3 className="text-xl font-semibold mb-4">Recent Form (Last 5 Games)</h3>
        <div className="space-y-3">
          {stats.recentForm.matches.map((match, index) => (
            <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center space-x-3">
                <span className="text-sm font-medium text-gray-600">R{match.round}</span>
                <span className="text-sm text-gray-500">vs {match.opposition}</span>
              </div>
              <div className="flex items-center space-x-4">
                <span className="text-lg font-semibold">{match.supercoachScore}</span>
                <span className="text-sm text-gray-500">${match.playerValue}k</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Performance Chart Preview */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h3 className="text-xl font-semibold mb-4">Performance Trends</h3>
        <PerformanceChart matchLogs={matchLogs.slice(0, 10)} />
      </div>
    </div>
  );
}

// Match Log Tab Component
function MatchLogTab({ matchLogs }: { matchLogs: MatchData[] }) {
  const [sortBy, setSortBy] = useState<keyof MatchData>('round');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const sortedMatches = [...matchLogs].sort((a, b) => {
    const aVal = a[sortBy];
    const bVal = b[sortBy];
    const multiplier = sortDirection === 'asc' ? 1 : -1;
    
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return (aVal - bVal) * multiplier;
    }
    return String(aVal).localeCompare(String(bVal)) * multiplier;
  });

  const handleSort = (column: keyof MatchData) => {
    if (sortBy === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortDirection('desc');
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-lg">
      <div className="p-6 border-b border-gray-200">
        <h3 className="text-xl font-semibold">2025 Season Match Log</h3>
        <p className="text-gray-600">Complete game-by-game performance</p>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              {[
                { key: 'round', label: 'Round' },
                { key: 'date', label: 'Date' },
                { key: 'opposition', label: 'Opposition' },
                { key: 'venue', label: 'Venue' },
                { key: 'fantasyScore', label: 'SC Score' },
                { key: 'totalValue', label: 'Value' },
                { key: 'disposals', label: 'Disposals' },
                { key: 'goals', label: 'Goals' },
                { key: 'marks', label: 'Marks' },
                { key: 'tackles', label: 'Tackles' },
              ].map(({ key, label }) => (
                <th
                  key={key}
                  onClick={() => handleSort(key as keyof MatchData)}
                  className="px-4 py-3 text-left text-sm font-medium text-gray-900 cursor-pointer hover:bg-gray-100"
                >
                  {label}
                  {sortBy === key && (
                    <span className="ml-1">
                      {sortDirection === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {sortedMatches.map((match) => (
              <tr key={match.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium">{match.round}</td>
                <td className="px-4 py-3 text-sm">{new Date(match.date).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-sm">{match.opposition}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{match.venue}</td>
                <td className="px-4 py-3 text-sm font-semibold">{match.fantasyScore}</td>
                <td className="px-4 py-3 text-sm">${match.totalValue}k</td>
                <td className="px-4 py-3 text-sm">{match.disposals}</td>
                <td className="px-4 py-3 text-sm">{match.goals}</td>
                <td className="px-4 py-3 text-sm">{match.marks}</td>
                <td className="px-4 py-3 text-sm">{match.tackles}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Season Stats Tab Component
function StatsTab({ stats }: { stats: PlayerStats | null }) {
  if (!stats) {
    return <div className="text-center py-8">No statistics available</div>;
  }

  const statCategories = [
    {
      title: 'Scoring',
      stats: [
        { label: 'Goals', total: stats.season.totals.goals, average: stats.season.averages.goals },
        { label: 'Behinds', total: stats.season.totals.behinds, average: stats.season.averages.behinds },
        { label: 'SuperCoach Score', total: stats.season.totals.supercoachScore, average: stats.season.averages.supercoachScore },
      ]
    },
    {
      title: 'Ball Movement',
      stats: [
        { label: 'Disposals', total: stats.season.totals.disposals, average: stats.season.averages.disposals },
        { label: 'Kicks', total: stats.season.totals.kicks, average: stats.season.averages.kicks },
        { label: 'Handballs', total: stats.season.totals.handballs, average: stats.season.averages.handballs },
        { label: 'Effective Disposals', total: stats.season.totals.effectiveDisposals, average: stats.season.averages.effectiveDisposals },
      ]
    },
    {
      title: 'Contested',
      stats: [
        { label: 'Contested Possessions', total: stats.season.totals.contestedPossessions, average: stats.season.averages.contestedPossessions },
        { label: 'Contested Marks', total: stats.season.totals.contestedMarks, average: stats.season.averages.contestedMarks },
        { label: 'Tackles', total: stats.season.totals.tackles, average: stats.season.averages.tackles },
        { label: 'Hitouts', total: stats.season.totals.hitouts, average: stats.season.averages.hitouts },
      ]
    }
  ];

  return (
    <div className="space-y-6">
      {/* Performance Highlights */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h3 className="text-xl font-semibold mb-4">Season Highlights</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-4 bg-blue-50 rounded-lg">
            <div className="text-2xl font-bold text-blue-600">{stats.performance.highestScore}</div>
            <div className="text-sm text-gray-600">Highest Score</div>
          </div>
          <div className="text-center p-4 bg-green-50 rounded-lg">
            <div className="text-2xl font-bold text-green-600">{stats.performance.mostGoals}</div>
            <div className="text-sm text-gray-600">Most Goals</div>
          </div>
          <div className="text-center p-4 bg-purple-50 rounded-lg">
            <div className="text-2xl font-bold text-purple-600">{stats.performance.mostDisposals}</div>
            <div className="text-sm text-gray-600">Most Disposals</div>
          </div>
          <div className="text-center p-4 bg-orange-50 rounded-lg">
            <div className="text-2xl font-bold text-orange-600">{stats.season.disposalEfficiency}%</div>
            <div className="text-sm text-gray-600">Disposal Efficiency</div>
          </div>
        </div>
      </div>

      {/* Detailed Statistics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {statCategories.map((category) => (
          <div key={category.title} className="bg-white rounded-xl shadow-lg p-6">
            <h4 className="text-lg font-semibold mb-4 text-gray-900">{category.title}</h4>
            <div className="space-y-3">
              {category.stats.map((stat) => (
                <div key={stat.label} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-b-0">
                  <span className="text-sm text-gray-600">{stat.label}</span>
                  <div className="text-right">
                    <div className="text-sm font-semibold">{stat.average}</div>
                    <div className="text-xs text-gray-500">{stat.total} total</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Stat Card Component
function StatCard({ 
  title, 
  value, 
  icon: Icon, 
  className = '' 
}: { 
  title: string; 
  value: string | number; 
  icon: React.ComponentType<{ className?: string }>; 
  className?: string;
}) {
  return (
    <div className={`p-4 rounded-lg border-2 ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600 mb-1">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
        <Icon className="w-8 h-8 text-gray-400" />
      </div>
    </div>
  );
}

// Performance Chart Component
function PerformanceChart({ matchLogs }: { matchLogs: MatchData[] }) {
  const maxScore = Math.max(...matchLogs.map(m => m.fantasyScore));
  
  return (
    <div className="h-48 flex items-end space-x-2">
      {matchLogs.map((match) => (
        <div key={match.id} className="flex-1 flex flex-col items-center">
          <div 
            className="bg-blue-500 rounded-t w-full min-h-1"
            style={{ height: `${(match.fantasyScore / maxScore) * 100}%` }}
            title={`Round ${match.round}: ${match.fantasyScore} points vs ${match.opposition}`}
          />
          <span className="text-xs text-gray-500 mt-1">R{match.round}</span>
        </div>
      ))}
    </div>
  );
}