import React from 'react';

import Link from 'next/link';

import { PlayIcon, TrophyIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

interface LiveScoringModuleProps {
  refreshTrigger: number;
}

export default function LiveScoringModule({
  refreshTrigger: _refreshTrigger,
}: LiveScoringModuleProps) {
  // Mock live scoring data
  const liveData = {
    userScore: 1847,
    opponentScore: 1923,
    scoreDifference: -76,
    gamesLive: 4,
    gamesCompleted: 5,
    totalGames: 9,
    nextPlayer: {
      name: 'M. Bontempelli',
      team: 'WBD',
      currentScore: 89,
      projectedScore: 115,
      gameTime: 'Q3 8:42',
      isCaptain: true,
    },
    recentScores: [
      { player: 'Max Gawn', score: 65, status: 'finished' },
      { player: 'D. Martin', score: 45, status: 'live' },
      { player: 'T. Mitchell', score: 32, status: 'live' },
    ],
  };

  const progressPercentage = (liveData.gamesCompleted / liveData.totalGames) * 100;

  return (
    <div className="space-y-4">
      {/* Live Status */}
      <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-lg p-3 border border-green-200">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-sm font-semibold text-green-700">LIVE</span>
          </div>
          <span className="text-xs text-gray-600">{liveData.gamesLive} games active</span>
        </div>

        <div className="flex justify-between text-xs text-gray-600 mb-1">
          <span>Round Progress</span>
          <span>{progressPercentage.toFixed(0)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-1.5">
          <div
            className="bg-blue-600 h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
      </div>

      {/* Score Comparison */}
      <div className="grid grid-cols-3 gap-2">
        <div className="text-center">
          <div className="text-lg font-bold text-blue-600">{liveData.userScore}</div>
          <div className="text-xs text-gray-500">You</div>
        </div>

        <div className="text-center">
          <div
            className={`text-sm font-bold ${
              liveData.scoreDifference > 0
                ? 'text-green-600'
                : liveData.scoreDifference < 0
                  ? 'text-red-600'
                  : 'text-gray-600'
            }`}
          >
            {liveData.scoreDifference > 0 ? '+' : ''}
            {liveData.scoreDifference}
          </div>
          <div className="text-xs text-gray-500">
            {liveData.scoreDifference > 0
              ? 'Ahead'
              : liveData.scoreDifference < 0
                ? 'Behind'
                : 'Tied'}
          </div>
        </div>

        <div className="text-center">
          <div className="text-lg font-bold text-red-600">{liveData.opponentScore}</div>
          <div className="text-xs text-gray-500">Opponent</div>
        </div>
      </div>

      {/* Key Player */}
      <div className="bg-blue-50 rounded-lg p-3">
        <div className="flex items-center gap-2 mb-2">
          {liveData.nextPlayer.isCaptain && <TrophyIcon className="w-4 h-4 text-yellow-500" />}
          <span className="text-sm font-semibold text-blue-900">{liveData.nextPlayer.name}</span>
          <span className="text-xs bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">
            {liveData.nextPlayer.team}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-bold text-blue-900">
              {liveData.nextPlayer.currentScore}
              {liveData.nextPlayer.isCaptain && (
                <span className="text-sm text-yellow-600 ml-1">×2</span>
              )}
            </div>
            <div className="text-xs text-blue-700">Proj: {liveData.nextPlayer.projectedScore}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-blue-700">{liveData.nextPlayer.gameTime}</div>
            <div className="flex items-center gap-1">
              <PlayIcon className="w-3 h-3 text-green-500" />
              <span className="text-xs text-green-600">Playing</span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Scores */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-gray-900">Recent Scores</h4>
        {liveData.recentScores.slice(0, 3).map((score, index) => (
          <div key={index} className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  score.status === 'live' ? 'bg-green-500' : 'bg-gray-400'
                }`}
              />
              <span className="text-sm text-gray-700 truncate">{score.player}</span>
            </div>
            <span className="text-sm font-medium text-gray-900">{score.score}</span>
          </div>
        ))}
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-2">
        <Link
          href="/live-scoring"
          className="bg-green-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-green-700 transition-colors text-center"
        >
          <PlayIcon className="w-3 h-3 inline mr-1" />
          Watch Live
        </Link>
        <button className="bg-slate-100 text-slate-700 px-3 py-2 rounded-lg text-xs font-medium hover:bg-slate-200 transition-colors flex items-center justify-center gap-1">
          <ArrowPathIcon className="w-3 h-3" />
          Refresh
        </button>
      </div>
    </div>
  );
}
