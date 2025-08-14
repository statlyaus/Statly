'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  PlayIcon,
  PauseIcon,
  TrophyIcon,
  ArrowPathIcon,
  FireIcon
} from '@heroicons/react/24/outline';

// Types
interface Player {
  id: string;
  name: string;
  position: string;
  team: string;
  liveScore: number;
  projectedScore: number;
  gameStatus: 'not_started' | 'live' | 'finished';
  gameTime?: string;
  isPlaying: boolean;
  captain?: boolean;
  viceCaptain?: boolean;
  stats?: {
    disposals: number;
    kicks: number;
    handballs: number;
    marks: number;
    tackles: number;
    goals: number;
    behinds: number;
  };
}

interface TeamLineup {
  teamName: string;
  totalScore: number;
  projectedTotal: number;
  players: Player[];
  captainMultiplier: number;
  viceCaptainMultiplier: number;
}

interface MatchupData {
  week: number;
  status: 'upcoming' | 'live' | 'completed';
  userTeam: TeamLineup;
  opponentTeam: TeamLineup;
  gameProgress: {
    quarter: number;
    timeRemaining: string;
    gamesInProgress: number;
    gamesCompleted: number;
    totalGames: number;
  };
}

interface LiveScoringMatchupProps {
  matchupData: MatchupData;
  onRefresh?: () => void;
  isLive?: boolean;
}

// Mock data
const mockMatchupData: MatchupData = {
  week: 12,
  status: 'live',
  userTeam: {
    teamName: 'The Bulldogs',
    totalScore: 1847,
    projectedTotal: 2156,
    captainMultiplier: 2,
    viceCaptainMultiplier: 1.5,
    players: [
      {
        id: '1',
        name: 'Marcus Bontempelli',
        position: 'MID',
        team: 'WBD',
        liveScore: 89,
        projectedScore: 115,
        gameStatus: 'live',
        gameTime: 'Q3 8:42',
        isPlaying: true,
        captain: true,
        stats: {
          disposals: 23,
          kicks: 15,
          handballs: 8,
          marks: 7,
          tackles: 4,
          goals: 1,
          behinds: 1
        }
      },
      {
        id: '2',
        name: 'Max Gawn',
        position: 'RUC',
        team: 'MEL',
        liveScore: 65,
        projectedScore: 108,
        gameStatus: 'finished',
        isPlaying: false,
        viceCaptain: true,
        stats: {
          disposals: 18,
          kicks: 12,
          handballs: 6,
          marks: 9,
          tackles: 3,
          goals: 0,
          behinds: 1
        }
      }
    ]
  },
  opponentTeam: {
    teamName: 'Tigers Elite',
    totalScore: 1923,
    projectedTotal: 2089,
    captainMultiplier: 2,
    viceCaptainMultiplier: 1.5,
    players: []
  },
  gameProgress: {
    quarter: 3,
    timeRemaining: '8:42',
    gamesInProgress: 4,
    gamesCompleted: 5,
    totalGames: 9
  }
};

export default function LiveScoringMatchup({
  matchupData = mockMatchupData,
  onRefresh,
  isLive = true
}: LiveScoringMatchupProps) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

  // Auto refresh every 30 seconds when live
  useEffect(() => {
    if (!isLive || !autoRefresh) return;

    const interval = setInterval(() => {
      onRefresh?.();
      setLastRefresh(new Date());
    }, 30000);

    return () => clearInterval(interval);
  }, [isLive, autoRefresh, onRefresh]);

  // Calculate team scores with multipliers
  const calculateTeamScore = (team: TeamLineup) => {
    let total = 0;
    team.players.forEach(player => {
      let score = player.liveScore || 0;
      if (player.captain) score *= team.captainMultiplier;
      else if (player.viceCaptain) score *= team.viceCaptainMultiplier;
      total += score;
    });
    return total;
  };

  const userScore = calculateTeamScore(matchupData.userTeam);
  const opponentScore = calculateTeamScore(matchupData.opponentTeam);
  const scoreDifference = userScore - opponentScore;

  // Progress percentage for games
  const progressPercentage = (matchupData.gameProgress.gamesCompleted / matchupData.gameProgress.totalGames) * 100;

  const getGameStatusColor = (status: string) => {
    switch (status) {
      case 'live': return 'text-green-600 bg-green-100';
      case 'finished': return 'text-gray-600 bg-gray-100';
      default: return 'text-blue-600 bg-blue-100';
    }
  };

  const getPositionColor = (position: string) => {
    switch (position) {
      case 'FWD': return 'bg-red-100 text-red-800';
      case 'MID': return 'bg-green-100 text-green-800';
      case 'DEF': return 'bg-blue-100 text-blue-800';
      case 'RUC': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Week {matchupData.week} Matchup</h1>
          <p className="text-gray-600 mt-1">Live scoring and projections</p>
        </div>
        
        <div className="flex items-center gap-4">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              autoRefresh 
                ? 'bg-green-100 text-green-700 hover:bg-green-200' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {autoRefresh ? <PlayIcon className="w-4 h-4" /> : <PauseIcon className="w-4 h-4" />}
            Auto Refresh
          </button>
          
          <button
            onClick={() => {
              onRefresh?.();
              setLastRefresh(new Date());
            }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-lg transition-colors"
          >
            <ArrowPathIcon className="w-4 h-4" />
            Refresh Now
          </button>
        </div>
      </div>

      {/* Live Status */}
      {isLive && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-green-50 to-blue-50 rounded-xl p-6 border border-green-200"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                <span className="font-semibold text-green-700">LIVE</span>
              </div>
              <div className="text-gray-600">
                Q{matchupData.gameProgress.quarter} - {matchupData.gameProgress.timeRemaining}
              </div>
            </div>
            
            <div className="flex items-center gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">
                  {matchupData.gameProgress.gamesInProgress}
                </div>
                <div className="text-sm text-gray-600">Games Live</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">
                  {matchupData.gameProgress.gamesCompleted}
                </div>
                <div className="text-sm text-gray-600">Games Complete</div>
              </div>
              <div className="w-32">
                <div className="flex justify-between text-sm text-gray-600 mb-1">
                  <span>Progress</span>
                  <span>{progressPercentage.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${progressPercentage}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Score Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-xl shadow-lg p-6 text-center"
        >
          <h3 className="text-lg font-semibold text-gray-900 mb-2">{matchupData.userTeam.teamName}</h3>
          <div className="text-4xl font-bold text-blue-600">{userScore}</div>
          <div className="text-sm text-gray-500 mt-1">
            Projected: {matchupData.userTeam.projectedTotal}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-xl shadow-lg p-6 flex items-center justify-center"
        >
          <div className="text-center">
            <div className={`text-2xl font-bold mb-2 ${
              scoreDifference > 0 ? 'text-green-600' : 
              scoreDifference < 0 ? 'text-red-600' : 'text-gray-600'
            }`}>
              {scoreDifference > 0 ? '+' : ''}{scoreDifference}
            </div>
            <div className="text-sm text-gray-500">Point Difference</div>
            {scoreDifference > 0 && <div className="text-xs text-green-600 mt-1">You&apos;re ahead!</div>}
            {scoreDifference < 0 && <div className="text-xs text-red-600 mt-1">You&apos;re behind</div>}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-xl shadow-lg p-6 text-center"
        >
          <h3 className="text-lg font-semibold text-gray-900 mb-2">{matchupData.opponentTeam.teamName}</h3>
          <div className="text-4xl font-bold text-red-600">{opponentScore}</div>
          <div className="text-sm text-gray-500 mt-1">
            Projected: {matchupData.opponentTeam.projectedTotal}
          </div>
        </motion.div>
      </div>

      {/* Player Performance */}
      <div className="bg-white rounded-xl shadow-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Your Players</h3>
          <p className="text-sm text-gray-600">Live scores and statistics</p>
        </div>

        <div className="divide-y divide-gray-100">
          {matchupData.userTeam.players.map((player, index) => (
            <motion.div
              key={player.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="p-6 hover:bg-gray-50 cursor-pointer"
              onClick={() => setSelectedPlayer(player)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    {player.captain && <TrophyIcon className="w-5 h-5 text-yellow-500" title="Captain" />}
                    {player.viceCaptain && <FireIcon className="w-5 h-5 text-orange-500" title="Vice Captain" />}
                    <div>
                      <div className="font-semibold text-gray-900">{player.name}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${getPositionColor(player.position)}`}>
                          {player.position}
                        </span>
                        <span className="text-sm text-gray-600">{player.team}</span>
                        {player.gameTime && (
                          <span className={`px-2 py-1 rounded text-xs font-medium ${getGameStatusColor(player.gameStatus)}`}>
                            {player.gameTime}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-900">
                      {player.liveScore}
                      {player.captain && <span className="text-sm text-yellow-600 ml-1">×2</span>}
                      {player.viceCaptain && <span className="text-sm text-orange-600 ml-1">×1.5</span>}
                    </div>
                    <div className="text-sm text-gray-500">
                      Proj: {player.projectedScore}
                    </div>
                  </div>

                  <div className="text-center">
                    <div className={`w-3 h-3 rounded-full ${
                      player.isPlaying ? 'bg-green-500' : 'bg-gray-400'
                    }`} />
                    <div className="text-xs text-gray-500 mt-1">
                      {player.isPlaying ? 'Playing' : 'Finished'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Player Stats Preview */}
              {player.stats && (
                <div className="mt-4 grid grid-cols-4 md:grid-cols-7 gap-4">
                  <div className="text-center">
                    <div className="text-lg font-semibold text-gray-900">{player.stats.disposals}</div>
                    <div className="text-xs text-gray-500">Disposals</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-semibold text-gray-900">{player.stats.marks}</div>
                    <div className="text-xs text-gray-500">Marks</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-semibold text-gray-900">{player.stats.tackles}</div>
                    <div className="text-xs text-gray-500">Tackles</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-semibold text-gray-900">{player.stats.goals}</div>
                    <div className="text-xs text-gray-500">Goals</div>
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>

      {/* Player Detail Modal */}
      <AnimatePresence>
        {selectedPlayer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
            onClick={() => setSelectedPlayer(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900">{selectedPlayer.name}</h3>
                <button
                  onClick={() => setSelectedPlayer(null)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ×
                </button>
              </div>

              {selectedPlayer.stats && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-gray-900">{selectedPlayer.stats.disposals}</div>
                    <div className="text-sm text-gray-600">Disposals</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-gray-900">{selectedPlayer.stats.marks}</div>
                    <div className="text-sm text-gray-600">Marks</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-gray-900">{selectedPlayer.stats.tackles}</div>
                    <div className="text-sm text-gray-600">Tackles</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-gray-900">{selectedPlayer.stats.goals}</div>
                    <div className="text-sm text-gray-600">Goals</div>
                  </div>
                </div>
              )}

              <div className="mt-4 text-center">
                <div className="text-3xl font-bold text-blue-600">{selectedPlayer.liveScore}</div>
                <div className="text-sm text-gray-500">Live Score</div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Last Updated */}
      <div className="text-center text-sm text-gray-500">
        Last updated: {lastRefresh.toLocaleTimeString()}
      </div>
    </div>
  );
}
