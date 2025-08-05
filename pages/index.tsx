/* eslint-disable react/no-unescaped-entities */
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/AuthContext';
import { fetchFromAPI } from '../src/lib/api';
import type { Player } from '../src/types';

// Types for enhanced features
interface LeagueStanding {
  rank: number;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  percentage: number;
  gamesBehind: string;
  userId?: string;
}

interface RecentActivity {
  date: string;
  type: 'Added' | 'Dropped' | 'Trade' | 'Waiver';
  team: string;
  player: string;
  details?: string;
}

interface PlayerNews {
  player: string;
  news: string;
  severity: 'low' | 'medium' | 'high';
  date: string;
}

const Home = () => {
  const { user } = useAuth();
  const [topPlayers, setTopPlayers] = useState<Player[]>([]);
  const [standings, setStandings] = useState<LeagueStanding[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [playerNews, setPlayerNews] = useState<PlayerNews[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentRound] = useState(19);

  // Mock data for demonstration - replace with real API calls
  useEffect(() => {
    const loadDashboardData = async () => {
      try {
        setLoading(true);

        // Load top performing players this week
        const players = await fetchFromAPI<Player[]>('/api/players?limit=5&sortBy=fantasyPoints');
        setTopPlayers(players);

        // Mock standings - replace with real API
        setStandings([
          {
            rank: 1,
            teamName: "Matthew's Monstrous Team",
            wins: 14,
            losses: 3,
            ties: 1,
            percentage: 0.806,
            gamesBehind: '--',
          },
          {
            rank: 2,
            teamName: "Ronnie's Rowdy Team",
            wins: 13,
            losses: 5,
            ties: 0,
            percentage: 0.722,
            gamesBehind: '1.5',
          },
          {
            rank: 3,
            teamName: "Bambang's Best Team",
            wins: 11,
            losses: 6,
            ties: 1,
            percentage: 0.639,
            gamesBehind: '3.0',
          },
          {
            rank: 4,
            teamName: "Michael's Magnificent Team",
            wins: 10,
            losses: 8,
            ties: 0,
            percentage: 0.556,
            gamesBehind: '4.5',
          },
          {
            rank: 5,
            teamName: 'Your Team',
            wins: 9,
            losses: 8,
            ties: 1,
            percentage: 0.528,
            gamesBehind: '5.0',
            userId: user?.uid,
          },
        ]);

        // Mock recent activity
        setRecentActivity([
          {
            date: 'Wed Jul 24',
            type: 'Added',
            team: "Matthew's Team",
            player: 'Nick Daicos',
            details: 'Waiver claim',
          },
          {
            date: 'Tue Jul 23',
            type: 'Trade',
            team: "Ronnie's Team",
            player: 'Marcus Bontempelli',
            details: 'for Max Gawn + picks',
          },
          {
            date: 'Tue Jul 23',
            type: 'Dropped',
            team: "Michael's Team",
            player: 'Tom Hawkins',
            details: 'Injury concerns',
          },
        ]);

        // Mock player news
        setPlayerNews([
          {
            player: 'Nick Daicos',
            news: 'Expected to return after minor calf tightness. Will undergo fitness test Friday.',
            severity: 'medium',
            date: 'Jul 24',
          },
          {
            player: 'Marcus Bontempelli',
            news: 'Dominated in training and is likely to play more midfield minutes.',
            severity: 'low',
            date: 'Jul 24',
          },
          {
            player: 'Max Gawn',
            news: 'Managing workload after minor soreness, expected to play Round 19.',
            severity: 'medium',
            date: 'Jul 23',
          },
        ]);
      } catch (error) {
        console.error('Error loading dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDashboardData();
  }, [user]);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high':
        return 'text-red-600';
      case 'medium':
        return 'text-yellow-600';
      default:
        return 'text-green-600';
    }
  };

  const getActivityTypeColor = (type: string) => {
    switch (type) {
      case 'Added':
        return 'text-green-600';
      case 'Dropped':
        return 'text-red-600';
      case 'Trade':
        return 'text-blue-600';
      default:
        return 'text-gray-600';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-blue-900 shadow-md p-4 flex justify-between items-center mb-6 rounded-lg">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-white font-espn">Statly AFL</h1>
          <span className="text-blue-200 text-sm">Round {currentRound}</span>
        </div>
        <nav className="space-x-8 text-base font-medium text-blue-100">
          <Link href="/" className="hover:underline">
            Home
          </Link>
          <Link href="/myteam" className="hover:underline">
            My Team
          </Link>
          <Link href="/stats" className="hover:underline">
            Player Stats
          </Link>
          <Link href="/draft" className="hover:underline">
            Draft
          </Link>
          <Link href="/tradecentre" className="hover:underline">
            Trade Centre
          </Link>
          <Link href="/leaderboard" className="hover:underline">
            Leaderboard
          </Link>
          {user && <span className="text-blue-200">Welcome, {user.displayName || user.email}</span>}
        </nav>
      </div>

      {/* Welcome Message */}
      {user && (
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg p-6 mb-6">
          <h2 className="text-2xl font-bold mb-2">
            Welcome back, {user.displayName || 'Champion'}!
          </h2>
          <p className="text-blue-100">
            Your team is currently ranked #
            {standings.find((s) => s.userId === user.uid)?.rank || 'N/A'} in the league.
          </p>
        </div>
      )}

      {/* Quick Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg shadow-md border-l-4 border-blue-500">
          <h3 className="text-sm font-medium text-gray-600">Current Rank</h3>
          <p className="text-2xl font-bold text-blue-600">
            #{standings.find((s) => s.userId === user?.uid)?.rank || 'N/A'}
          </p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-md border-l-4 border-green-500">
          <h3 className="text-sm font-medium text-gray-600">Weekly Record</h3>
          <p className="text-2xl font-bold text-green-600">5-4-1</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-md border-l-4 border-purple-500">
          <h3 className="text-sm font-medium text-gray-600">Total Points</h3>
          <p className="text-2xl font-bold text-purple-600">1,847</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-md border-l-4 border-yellow-500">
          <h3 className="text-sm font-medium text-gray-600">Trades Left</h3>
          <p className="text-2xl font-bold text-yellow-600">5</p>
        </div>
      </div>

      {/* Main Navigation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
        <Link
          href="/myteam"
          className="bg-white p-6 rounded-lg shadow-md border border-gray-200 hover:shadow-lg transition transform hover:-translate-y-1 hover:bg-blue-50 group"
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-800">📋 My Team</h2>
            <span className="text-blue-600 group-hover:translate-x-1 transition-transform">→</span>
          </div>
          <p className="mb-4 text-gray-600">Manage your lineup and check player performance.</p>
          <div className="text-sm text-gray-500">
            <p>• Set your starting lineup</p>
            <p>• View player stats</p>
            <p>• Check injury updates</p>
          </div>
        </Link>

        <Link
          href="/draft"
          className="bg-white p-6 rounded-lg shadow-md border border-gray-200 hover:shadow-lg transition transform hover:-translate-y-1 hover:bg-green-50 group"
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-800">📝 Draft Board</h2>
            <span className="text-green-600 group-hover:translate-x-1 transition-transform">→</span>
          </div>
          <p className="mb-4 text-gray-600">Live draft interface with real-time updates.</p>
          <div className="text-sm text-gray-500">
            <p>• Watch live picks</p>
            <p>• Track your queue</p>
            <p>• Get pick recommendations</p>
          </div>
        </Link>

        <Link
          href="/tradecentre"
          className="bg-white p-6 rounded-lg shadow-md border border-gray-200 hover:shadow-lg transition transform hover:-translate-y-1 hover:bg-purple-50 group"
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-800">🔁 Trade Centre</h2>
            <span className="text-purple-600 group-hover:translate-x-1 transition-transform">
              →
            </span>
          </div>
          <p className="mb-4 text-gray-600">Analyze trades and optimize your roster.</p>
          <div className="text-sm text-gray-500">
            <p>• Compare player values</p>
            <p>• Track trade deadlines</p>
            <p>• Get trade suggestions</p>
          </div>
        </Link>

        <Link
          href="/stats"
          className="bg-white p-6 rounded-lg shadow-md border border-gray-200 hover:shadow-lg transition transform hover:-translate-y-1 hover:bg-yellow-50 group"
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-800">📊 Player Stats</h2>
            <span className="text-yellow-600 group-hover:translate-x-1 transition-transform">
              →
            </span>
          </div>
          <p className="mb-4 text-gray-600">Deep dive into player performance data.</p>
          <div className="text-sm text-gray-500">
            <p>• Advanced statistics</p>
            <p>• Trend analysis</p>
            <p>• Comparison tools</p>
          </div>
        </Link>

        <Link
          href="/leaderboard"
          className="bg-white p-6 rounded-lg shadow-md border border-gray-200 hover:shadow-lg transition transform hover:-translate-y-1 hover:bg-red-50 group"
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-800">🏆 Leaderboard</h2>
            <span className="text-red-600 group-hover:translate-x-1 transition-transform">→</span>
          </div>
          <p className="mb-4 text-gray-600">Track league standings and achievements.</p>
          <div className="text-sm text-gray-500">
            <p>• League rankings</p>
            <p>• Weekly scores</p>
            <p>• Achievement badges</p>
          </div>
        </Link>

        <Link
          href="/matchups"
          className="bg-white p-6 rounded-lg shadow-md border border-gray-200 hover:shadow-lg transition transform hover:-translate-y-1 hover:bg-indigo-50 group"
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-800">⚔️ Matchups</h2>
            <span className="text-indigo-600 group-hover:translate-x-1 transition-transform">
              →
            </span>
          </div>
          <p className="mb-4 text-gray-600">View head-to-head matchup details.</p>
          <div className="text-sm text-gray-500">
            <p>• Current week matchup</p>
            <p>• Historical records</p>
            <p>• Predictions</p>
          </div>
        </Link>
      </div>
    </div>
  );
}

export default Home;
