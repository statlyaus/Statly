import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { fetchFromAPI } from '../lib/api';
import type { Player } from '../types';

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
  const [currentRound, setCurrentRound] = useState(19);

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
        <nav className="space-x-6 text-sm font-semibold text-white">
          <Link to="/" className="hover:underline">
            Home
          </Link>
          <Link to="/myteam" className="hover:underline">
            My Team
          </Link>
          <Link to="/stats" className="hover:underline">
            Player Stats
          </Link>
          <Link to="/draft" className="hover:underline">
            Draft
          </Link>
          <Link to="/tradecentre" className="hover:underline">
            Trade Centre
          </Link>
          <Link to="/leaderboard" className="hover:underline">
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
          to="/myteam"
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
          to="/draft"
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
          to="/tradecentre"
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
          to="/stats"
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
          to="/leaderboard"
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
          to="/matchups"
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

      {/* This Week's Matchup - Enhanced */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6 border border-gray-200">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-800">This Week's Matchup</h3>
          <span className="text-sm text-gray-500">Round {currentRound} • 2 days left</span>
        </div>

        <div className="flex justify-between items-center text-sm text-gray-800 mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 text-blue-700 font-bold py-2 px-4 rounded-full">
              Your Team
            </div>
            <span className="text-2xl text-gray-400">vs</span>
            <div className="bg-red-100 text-red-700 font-bold py-2 px-4 rounded-full">
              Bambang's Best Team
            </div>
          </div>
          <div className="text-right">
            <div className="font-bold text-lg">5-4-1</div>
            <div className="text-xs text-gray-500">Current Record</div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-gray-700 border border-gray-200 rounded">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-3 px-4 font-semibold">Category</th>
                <th className="text-center py-3 px-4 font-semibold">You</th>
                <th className="text-center py-3 px-4 font-semibold">Opponent</th>
                <th className="text-center py-3 px-4 font-semibold">Result</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Kicks', 128, 110, 'Win'],
                ['Handballs', 92, 100, 'Loss'],
                ['Marks', 65, 54, 'Win'],
                ['Tackles', 48, 48, 'Draw'],
                ['Goals', 15, 18, 'Loss'],
                ['Hitouts', 39, 33, 'Win'],
                ['Clearances', 31, 28, 'Win'],
                ['Inside 50s', 42, 37, 'Win'],
                ['Rebound 50s', 26, 29, 'Loss'],
                ['Contested Possessions', 58, 60, 'Loss'],
              ].map(([category, you, opp, result]) => (
                <tr key={category} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-4 font-medium">{category}</td>
                  <td className="text-center py-3 px-4">{you}</td>
                  <td className="text-center py-3 px-4">{opp}</td>
                  <td
                    className={`text-center py-3 px-4 font-semibold ${
                      result === 'Win'
                        ? 'text-green-600'
                        : result === 'Loss'
                          ? 'text-red-600'
                          : 'text-yellow-600'
                    }`}
                  >
                    {result}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 text-sm text-gray-700 font-medium text-right">
          Weekly Record: <span className="text-blue-600">5 Wins – 4 Losses – 1 Draw</span>
        </div>
      </div>

      {/* Top Performers This Week */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">🔥 Top Performers This Week</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {topPlayers.map((player, index) => (
            <Link
              key={player.id}
              to={`/players/${player.id}`}
              className="bg-gray-50 p-4 rounded-lg hover:bg-gray-100 transition"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg font-bold text-blue-600">#{index + 1}</span>
                <span className="text-sm font-medium text-gray-600">{player.position}</span>
              </div>
              <h4 className="font-semibold text-gray-800 truncate">{player.name}</h4>
              <p className="text-sm text-gray-600">{player.team}</p>
              <p className="text-lg font-bold text-green-600">
                {player.stats?.fantasyPoints || 0} pts
              </p>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent Activity & Player News - Enhanced */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        {/* Recent Activity */}
        <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Recent Activity</h3>
            <Link to="/activity" className="text-blue-600 hover:underline text-sm">
              View All
            </Link>
          </div>
          <div className="space-y-3">
            {recentActivity.map((activity, index) => (
              <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="flex-shrink-0">
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${getActivityTypeColor(activity.type)} bg-gray-100`}
                  >
                    {activity.type}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800">
                    <span className="font-medium">{activity.team}</span>{' '}
                    {activity.type.toLowerCase()}{' '}
                    <span className="font-medium text-blue-600">{activity.player}</span>
                  </p>
                  {activity.details && <p className="text-xs text-gray-500">{activity.details}</p>}
                </div>
                <div className="text-xs text-gray-400">{activity.date}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Player News */}
        <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Player News</h3>
            <Link to="/news" className="text-blue-600 hover:underline text-sm">
              More News
            </Link>
          </div>
          <div className="space-y-3">
            {playerNews.map((news, index) => (
              <div key={index} className="p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <Link
                    to={`/players/${news.player.toLowerCase().replace(/\s+/g, '-')}`}
                    className="font-medium text-blue-600 hover:underline"
                  >
                    {news.player}
                  </Link>
                  <span
                    className={`text-xs px-2 py-1 rounded ${getSeverityColor(news.severity)} bg-gray-100`}
                  >
                    {news.severity}
                  </span>
                </div>
                <p className="text-sm text-gray-700">{news.news}</p>
                <p className="text-xs text-gray-500 mt-1">{news.date}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* League Standings - Enhanced */}
      <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-800">League Standings</h3>
          <Link to="/leaderboard" className="text-blue-600 hover:underline text-sm">
            Full Standings
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-gray-800 border border-gray-300 rounded">
            <thead className="bg-gray-100 text-left">
              <tr>
                <th className="p-3 border-b border-gray-300">Rank</th>
                <th className="p-3 border-b border-gray-300">Team</th>
                <th className="p-3 border-b border-gray-300 text-center">W</th>
                <th className="p-3 border-b border-gray-300 text-center">L</th>
                <th className="p-3 border-b border-gray-300 text-center">T</th>
                <th className="p-3 border-b border-gray-300 text-center">PCT</th>
                <th className="p-3 border-b border-gray-300 text-center">GB</th>
              </tr>
            </thead>
            <tbody>
              {standings.slice(0, 6).map((team) => (
                <tr
                  key={team.rank}
                  className={`border-t border-gray-200 hover:bg-gray-50 ${team.userId === user?.uid ? 'bg-blue-50' : ''}`}
                >
                  <td className="p-3 text-gray-600 font-medium">{team.rank}</td>
                  <td className="p-3">
                    <span
                      className={`${team.userId === user?.uid ? 'text-blue-700 font-semibold' : 'text-blue-600'} hover:underline truncate max-w-[160px] block`}
                    >
                      {team.teamName} {team.userId === user?.uid && '(You)'}
                    </span>
                  </td>
                  <td className="p-3 text-center">{team.wins}</td>
                  <td className="p-3 text-center">{team.losses}</td>
                  <td className="p-3 text-center">{team.ties}</td>
                  <td className="p-3 text-center">{team.percentage.toFixed(3)}</td>
                  <td className="p-3 text-center">{team.gamesBehind}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Home;
