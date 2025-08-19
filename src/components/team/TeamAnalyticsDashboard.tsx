'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrophyIcon,
  ChartBarIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  FireIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  ChevronDownIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '@/AuthContext';

// Enhanced Types for Multi-League Support
interface Player {
  id: string;
  name: string;
  position: string;
  team: string;
  averageScore: number;
  lastGameScore: number;
  projectedScore: number;
  form: number[];
  injuryStatus?: 'healthy' | 'questionable' | 'injured';
  priceChange: number;
  ownership: number;
  captain?: boolean;
  viceCaptain?: boolean;
  pickNumber?: number;
  draftRound?: number;
}

interface League {
  id: string;
  name: string;
  teamName: string;
  status: 'active' | 'completed' | 'draft_pending';
  draftCompleted: boolean;
  memberCount: number;
  maxTeams: number;
}

interface TeamStats {
  totalValue: number;
  weeklyScore: number;
  projectedScore: number;
  rank: number;
  totalPlayers: number;
  averageAge: number;
  teamBalance: {
    forwards: number;
    mids: number;
    defenders: number;
    rucks: number;
  };
}

interface TeamAnalyticsDashboardProps {
  teamPlayers?: Player[];
  teamStats?: TeamStats;
  weeklyMatchup?: {
    opponent: string;
    projectedScore: number;
    opponentProjected: number;
  };
}

// Mock data for demo
const mockTeamPlayers: Player[] = [
  {
    id: '1',
    name: 'Marcus Bontempelli',
    position: 'MID',
    team: 'Western Bulldogs',
    averageScore: 118,
    lastGameScore: 142,
    projectedScore: 115,
    form: [142, 98, 135, 110, 128],
    injuryStatus: 'healthy',
    priceChange: 12000,
    ownership: 67,
    captain: true,
  },
  {
    id: '2',
    name: 'Max Gawn',
    position: 'RUC',
    team: 'Melbourne',
    averageScore: 108,
    lastGameScore: 89,
    projectedScore: 105,
    form: [89, 125, 92, 118, 102],
    injuryStatus: 'healthy',
    priceChange: -8000,
    ownership: 45,
  },
  {
    id: '3',
    name: 'Dustin Martin',
    position: 'FWD',
    team: 'Richmond',
    averageScore: 95,
    lastGameScore: 145,
    projectedScore: 98,
    form: [145, 78, 102, 88, 115],
    injuryStatus: 'questionable',
    priceChange: 5000,
    ownership: 23,
    viceCaptain: true,
  },
];

const mockTeamStats: TeamStats = {
  totalValue: 8450000,
  weeklyScore: 2156,
  projectedScore: 2189,
  rank: 15847,
  totalPlayers: 30,
  averageAge: 25.8,
  teamBalance: {
    forwards: 8,
    mids: 10,
    defenders: 8,
    rucks: 4,
  },
};

interface WeeklyMatchup {
  opponent: string;
  difficulty: number;
}

interface DraftPick {
  playerId: string;
  playerName: string;
  position: string;
  team: string;
  averageScore?: number;
  lastGameScore?: number;
  projectedScore?: number;
  form?: number[];
  injuryStatus?: string;
  priceChange?: number;
  ownership?: number;
  pickNumber?: number;
  round?: number;
}

export default function TeamAnalyticsDashboard({
  teamPlayers: propTeamPlayers,
  teamStats: propTeamStats,
  weeklyMatchup,
}: TeamAnalyticsDashboardProps) {
  const { user: authUser } = useAuth();
  
  // For development, simulate a logged-in test user to demonstrate multi-league functionality
  const user = useMemo(() => {
    return authUser || (process.env.NODE_ENV === 'development' ? {
      uid: '2qlfdHSCFTPlxoKFSUfNLSlCDRe2',
      email: 'test@example.com',
      displayName: 'Test User'
    } : null);
  }, [authUser]);
  
  const [selectedLeague, setSelectedLeague] = useState<string | null>(null);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [teamPlayers, setTeamPlayers] = useState<Player[]>(propTeamPlayers || mockTeamPlayers);
  const [teamStats, setTeamStats] = useState<TeamStats>(propTeamStats || mockTeamStats);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'players' | 'analytics' | 'trades'>(
    'overview'
  );
  const [sortBy, setSortBy] = useState<'score' | 'form' | 'price' | 'projected'>('score');

  // Fetch user leagues and team data
  useEffect(() => {
    const fetchUserData = async () => {
      if (!user) return;
      
      try {
        setLoading(true);
        
        // Fetch user leagues
        const response = await fetch(`/api/leagues/user/${user.uid}`);
        if (!response.ok) throw new Error('Failed to fetch leagues');
        
        const userLeagues = await response.json();
        setLeagues(userLeagues);
        
        // Auto-select first league if none selected
        if (!selectedLeague && userLeagues.length > 0) {
          setSelectedLeague(userLeagues[0].id);
        }
        
      } catch (err) {
        console.error('Error fetching user data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    if (user && !propTeamPlayers) {
      fetchUserData();
    }
  }, [user, propTeamPlayers, selectedLeague]);

  // Fetch team roster for selected league
  useEffect(() => {
    const fetchTeamData = async () => {
      if (!selectedLeague || !user || propTeamPlayers) return;
      
      try {
        setLoading(true);
        
        // Fetch roster data from both Prisma (draft) and Firebase (league management)
        const draftResponse = await fetch(`/api/draft/${selectedLeague}/roster/${user.uid}`).catch(() => null);
        const rosterResponse = await fetch(`/api/leagues/${selectedLeague}/roster/${user.uid}`).catch(() => null);
        
        let playerData: Player[] = [];
        
        // Try to get data from Firebase first (ongoing league)
        if (rosterResponse?.ok) {
          const rosterData = await rosterResponse.json();
          playerData = rosterData.players || [];
        } 
        // Fallback to Prisma draft data if Firebase data not available
        else if (draftResponse?.ok) {
          const draftData = await draftResponse.json();
          playerData = draftData.picks?.map((pick: DraftPick, index: number) => ({
            id: pick.playerId || `player-${index}`,
            name: pick.playerName || 'Unknown Player',
            position: pick.position || 'Unknown',
            team: pick.team || 'AFL',
            averageScore: pick.averageScore || 75,
            lastGameScore: pick.lastGameScore || 0,
            projectedScore: pick.projectedScore || 80,
            form: pick.form || [70, 75, 80, 85, 90],
            injuryStatus: (pick.injuryStatus as 'healthy' | 'questionable' | 'injured') || 'healthy',
            priceChange: pick.priceChange || 0,
            ownership: pick.ownership || 15,
            pickNumber: pick.pickNumber || index + 1,
            draftRound: pick.round || Math.floor(index / 22) + 1
          })) || [];
        }
        
        setTeamPlayers(playerData.length > 0 ? playerData : mockTeamPlayers);
        
        // Update team stats based on real data
        if (playerData.length > 0) {
          const calculatedStats = calculateTeamStats(playerData);
          setTeamStats(calculatedStats);
        }
        
      } catch (err) {
        console.error('Error fetching team data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load team data');
        setTeamPlayers(mockTeamPlayers);
      } finally {
        setLoading(false);
      }
    };

    fetchTeamData();
  }, [selectedLeague, user, propTeamPlayers]);

  // Calculate team stats from player data
  const calculateTeamStats = (players: Player[]): TeamStats => {
    const totalPlayers = players.length;
    const totalScore = players.reduce((sum, p) => sum + p.lastGameScore, 0);
    const projectedScore = players.reduce((sum, p) => sum + p.projectedScore, 0);
    
    const positions = players.reduce((acc, p) => {
      const pos = p.position.toLowerCase();
      if (pos.includes('fwd')) acc.forwards++;
      else if (pos.includes('mid')) acc.mids++;
      else if (pos.includes('def')) acc.defenders++;
      else if (pos.includes('ruc')) acc.rucks++;
      return acc;
    }, { forwards: 0, mids: 0, defenders: 0, rucks: 0 });

    return {
      totalValue: players.reduce((sum, p) => sum + (p.priceChange + 500000), 0), // Estimate
      weeklyScore: totalScore,
      projectedScore,
      rank: 1, // Would need league context
      totalPlayers,
      averageAge: 24, // Would need player age data
      teamBalance: positions,
    };
  };

  // Calculate team insights
  const teamInsights = useMemo(() => {
    const injured = teamPlayers.filter(
      (p) => p.injuryStatus === 'injured' || p.injuryStatus === 'questionable'
    ).length;
    const risingStars = teamPlayers.filter((p) => p.priceChange > 10000).length;
    const concerns = teamPlayers.filter((p) => {
      const recentForm = p.form.slice(-3).reduce((a, b) => a + b, 0) / 3;
      return recentForm < p.averageScore * 0.85;
    }).length;

    return { injured, risingStars, concerns };
  }, [teamPlayers]);

  // Sort players
  const sortedPlayers = useMemo(() => {
    return [...teamPlayers].sort((a, b) => {
      switch (sortBy) {
        case 'score':
          return b.averageScore - a.averageScore;
        case 'form': {
          const aForm = a.form.slice(-3).reduce((acc, val) => acc + val, 0) / 3;
          const bForm = b.form.slice(-3).reduce((acc, val) => acc + val, 0) / 3;
          return bForm - aForm;
        }
        case 'price':
          return b.priceChange - a.priceChange;
        case 'projected':
          return b.projectedScore - a.projectedScore;
        default:
          return 0;
      }
    });
  }, [teamPlayers, sortBy]);

  const getFormTrend = (form: number[]) => {
    if (form.length < 3) return 'stable';
    const recent = form.slice(-3).reduce((a, b) => a + b, 0) / 3;
    const previous = form.slice(0, -3).reduce((a, b) => a + b, 0) / (form.length - 3);
    if (recent > previous * 1.1) return 'rising';
    if (recent < previous * 0.9) return 'falling';
    return 'stable';
  };

  const getInjuryIcon = (status?: string) => {
    switch (status) {
      case 'injured':
        return <ExclamationTriangleIcon className="w-4 h-4 text-red-500" />;
      case 'questionable':
        return <ClockIcon className="w-4 h-4 text-yellow-500" />;
      default:
        return <ShieldCheckIcon className="w-4 h-4 text-green-500" />;
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* League Selector - Multi-League Support */}
      {user && !propTeamPlayers && leagues.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">League Selection</h2>
              <p className="text-sm text-gray-600">Switch between your different league teams</p>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={selectedLeague || ''}
                onChange={(e) => setSelectedLeague(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select a league...</option>
                {leagues.map((league) => (
                  <option key={league.id} value={league.id}>
                    {league.name} - {league.teamName || 'My Team'}
                    {league.draftCompleted ? ' (Draft Complete)' : ' (Draft Pending)'}
                  </option>
                ))}
              </select>
              {loading && (
                <ArrowPathIcon className="w-5 h-5 text-blue-500 animate-spin" />
              )}
            </div>
          </div>
          
          {error && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
          
          {selectedLeague && (
            <div className="mt-3 text-sm text-gray-600">
              Showing team for: <span className="font-medium text-gray-900">
                {leagues.find(l => l.id === selectedLeague)?.name}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">My Team</h1>
          <p className="text-gray-600 mt-1">
            {selectedLeague 
              ? `Team analytics for ${leagues.find(l => l.id === selectedLeague)?.name || 'Selected League'}`
              : 'Comprehensive team overview and analytics'
            }
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-2xl font-bold text-green-600">
              ${(teamStats.totalValue / 1000000).toFixed(2)}M
            </div>
            <div className="text-sm text-gray-500">Team Value</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-blue-600">
              #{teamStats.rank.toLocaleString()}
            </div>
            <div className="text-sm text-gray-500">Overall Rank</div>
          </div>
        </div>
      </div>

      {/* Quick Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-blue-500"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Weekly Score</p>
              <p className="text-2xl font-bold text-gray-900">{teamStats.weeklyScore}</p>
              <p className="text-sm text-green-600">
                ↗ +{teamStats.projectedScore - teamStats.weeklyScore} projected
              </p>
            </div>
            <ChartBarIcon className="w-8 h-8 text-blue-500" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-green-500"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Rising Stars</p>
              <p className="text-2xl font-bold text-gray-900">{teamInsights.risingStars}</p>
              <p className="text-sm text-gray-500">Players increasing in value</p>
            </div>
            <ArrowTrendingUpIcon className="w-8 h-8 text-green-500" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-yellow-500"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Injury Concerns</p>
              <p className="text-2xl font-bold text-gray-900">{teamInsights.injured}</p>
              <p className="text-sm text-gray-500">Players with injury status</p>
            </div>
            <ExclamationTriangleIcon className="w-8 h-8 text-yellow-500" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-red-500"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Form Concerns</p>
              <p className="text-2xl font-bold text-gray-900">{teamInsights.concerns}</p>
              <p className="text-sm text-gray-500">Players below average</p>
            </div>
            <ArrowTrendingDownIcon className="w-8 h-8 text-red-500" />
          </div>
        </motion.div>
      </div>

      {/* Weekly Matchup */}
      {weeklyMatchup && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl p-6 border border-purple-200"
        >
          <h3 className="text-lg font-semibold text-gray-900 mb-4">This Week&apos;s Matchup</h3>
          <div className="flex items-center justify-between">
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {weeklyMatchup.projectedScore}
              </div>
              <div className="text-sm text-gray-600">Your Projected</div>
            </div>
            <div className="text-center">
              <div className="text-lg text-gray-500">VS</div>
              <div className="text-sm text-gray-600">{weeklyMatchup.opponent}</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {weeklyMatchup.opponentProjected}
              </div>
              <div className="text-sm text-gray-600">Opponent Projected</div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Tabs */}
      <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
        {[
          { id: 'overview', label: 'Team Overview' },
          { id: 'players', label: 'Player Analysis' },
          { id: 'analytics', label: 'Performance Analytics' },
          { id: 'trades', label: 'Trade Opportunities' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`flex-1 px-4 py-2 rounded-md font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'players' && (
          <motion.div
            key="players"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-4"
          >
            {/* Sort Controls */}
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-700">Sort by:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="score">Average Score</option>
                <option value="form">Recent Form</option>
                <option value="price">Price Change</option>
                <option value="projected">Projected Score</option>
              </select>
            </div>

            {/* Players List */}
            <div className="bg-white rounded-xl shadow-lg overflow-hidden">
              <div className="grid grid-cols-12 gap-4 p-4 bg-gray-50 text-sm font-medium text-gray-600">
                <div className="col-span-3">Player</div>
                <div className="col-span-2">Position</div>
                <div className="col-span-2">Avg Score</div>
                <div className="col-span-2">Form</div>
                <div className="col-span-2">Price Change</div>
                <div className="col-span-1">Status</div>
              </div>

              {sortedPlayers.map((player, index) => {
                const formTrend = getFormTrend(player.form);
                const recentForm = player.form.slice(-3).reduce((a, b) => a + b, 0) / 3;

                return (
                  <motion.div
                    key={player.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="grid grid-cols-12 gap-4 p-4 border-b border-gray-100 hover:bg-gray-50"
                  >
                    <div className="col-span-3">
                      <div className="flex items-center gap-2">
                        {player.captain && (
                          <TrophyIcon className="w-4 h-4 text-yellow-500" title="Captain" />
                        )}
                        {player.viceCaptain && (
                          <FireIcon className="w-4 h-4 text-orange-500" title="Vice Captain" />
                        )}
                        <div>
                          <div className="font-medium text-gray-900">{player.name}</div>
                          <div className="text-sm text-gray-500">{player.team}</div>
                        </div>
                      </div>
                    </div>

                    <div className="col-span-2">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          player.position === 'FWD'
                            ? 'bg-red-100 text-red-800'
                            : player.position === 'MID'
                              ? 'bg-green-100 text-green-800'
                              : player.position === 'DEF'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-purple-100 text-purple-800'
                        }`}
                      >
                        {player.position}
                      </span>
                    </div>

                    <div className="col-span-2">
                      <div className="font-medium text-gray-900">{player.averageScore}</div>
                      <div className="text-sm text-gray-500">Last: {player.lastGameScore}</div>
                    </div>

                    <div className="col-span-2">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-gray-900">{recentForm.toFixed(1)}</div>
                        {formTrend === 'rising' && (
                          <ArrowTrendingUpIcon className="w-4 h-4 text-green-500" />
                        )}
                        {formTrend === 'falling' && (
                          <ArrowTrendingDownIcon className="w-4 h-4 text-red-500" />
                        )}
                      </div>
                    </div>

                    <div className="col-span-2">
                      <div
                        className={`font-medium ${
                          player.priceChange > 0
                            ? 'text-green-600'
                            : player.priceChange < 0
                              ? 'text-red-600'
                              : 'text-gray-600'
                        }`}
                      >
                        {player.priceChange > 0 ? '+' : ''}${(player.priceChange / 1000).toFixed(0)}
                        k
                      </div>
                    </div>

                    <div className="col-span-1">{getInjuryIcon(player.injuryStatus)}</div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}

        {activeTab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-6"
          >
            {/* Team Balance */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Team Balance</h3>
              <div className="space-y-4">
                {Object.entries(teamStats.teamBalance).map(([position, count]) => (
                  <div key={position} className="flex items-center justify-between">
                    <span className="text-gray-600 capitalize">{position}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full"
                          style={{ width: `${(count / 10) * 100}%` }}
                        />
                      </div>
                      <span className="font-medium text-gray-900">{count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
              <div className="grid grid-cols-1 gap-3">
                <button className="flex items-center justify-between p-3 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">
                  <span className="font-medium text-blue-900">Set Captain & Vice</span>
                  <TrophyIcon className="w-5 h-5 text-blue-600" />
                </button>
                <button className="flex items-center justify-between p-3 bg-green-50 hover:bg-green-100 rounded-lg transition-colors">
                  <span className="font-medium text-green-900">Make Trades</span>
                  <ArrowTrendingUpIcon className="w-5 h-5 text-green-600" />
                </button>
                <button className="flex items-center justify-between p-3 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors">
                  <span className="font-medium text-purple-900">View Projections</span>
                  <ChartBarIcon className="w-5 h-5 text-purple-600" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
