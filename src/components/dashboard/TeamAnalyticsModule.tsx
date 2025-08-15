import React from 'react';
import {
  ChartBarIcon,
  TrophyIcon,
  FireIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';

interface TeamAnalyticsModuleProps {
  refreshTrigger: number;
}

export default function TeamAnalyticsModule({
  refreshTrigger: _refreshTrigger,
}: TeamAnalyticsModuleProps) {
  // Mock team data
  const teamData = {
    weeklyScore: 2156,
    projectedScore: 2189,
    rank: 15847,
    teamValue: 8450000,
    risingStars: 3,
    formConcerns: 2,
    injuryConcerns: 1,
    captainScore: 178, // Double points included
    topPerformers: [
      { name: 'M. Bontempelli', score: 142, position: 'MID' },
      { name: 'Max Gawn', score: 125, position: 'RUC' },
      { name: 'D. Martin', score: 115, position: 'FWD' },
    ],
  };

  const getPositionColor = (position: string) => {
    switch (position) {
      case 'FWD':
        return 'bg-red-100 text-red-800';
      case 'MID':
        return 'bg-green-100 text-green-800';
      case 'DEF':
        return 'bg-blue-100 text-blue-800';
      case 'RUC':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-4">
      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-blue-50 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-blue-600 uppercase tracking-wide">
                Weekly Score
              </p>
              <p className="text-lg font-bold text-blue-900">
                {teamData.weeklyScore.toLocaleString()}
              </p>
            </div>
            <ChartBarIcon className="w-6 h-6 text-blue-600" />
          </div>
          <div className="mt-1">
            <span className="text-xs text-blue-700">
              +{teamData.projectedScore - teamData.weeklyScore} projected
            </span>
          </div>
        </div>

        <div className="bg-green-50 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-green-600 uppercase tracking-wide">
                Team Rank
              </p>
              <p className="text-lg font-bold text-green-900">#{teamData.rank.toLocaleString()}</p>
            </div>
            <TrophyIcon className="w-6 h-6 text-green-600" />
          </div>
          <div className="mt-1">
            <span className="text-xs text-green-700">
              ${(teamData.teamValue / 1000000).toFixed(2)}M value
            </span>
          </div>
        </div>
      </div>

      {/* Team Insights */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-gray-900">Team Insights</h4>

        <div className="flex items-center justify-between py-1">
          <div className="flex items-center gap-2">
            <ArrowTrendingUpIcon className="w-4 h-4 text-green-500" />
            <span className="text-sm text-gray-700">Rising Stars</span>
          </div>
          <span className="text-sm font-medium text-gray-900">{teamData.risingStars}</span>
        </div>

        <div className="flex items-center justify-between py-1">
          <div className="flex items-center gap-2">
            <ArrowTrendingDownIcon className="w-4 h-4 text-red-500" />
            <span className="text-sm text-gray-700">Form Concerns</span>
          </div>
          <span className="text-sm font-medium text-gray-900">{teamData.formConcerns}</span>
        </div>

        <div className="flex items-center justify-between py-1">
          <div className="flex items-center gap-2">
            <FireIcon className="w-4 h-4 text-orange-500" />
            <span className="text-sm text-gray-700">Injury Watch</span>
          </div>
          <span className="text-sm font-medium text-gray-900">{teamData.injuryConcerns}</span>
        </div>
      </div>

      {/* Top Performers */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-gray-900">Top Performers</h4>
        {teamData.topPerformers.slice(0, 3).map((player, index) => (
          <div key={index} className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <span
                className={`px-1.5 py-0.5 rounded text-xs font-medium ${getPositionColor(player.position)}`}
              >
                {player.position}
              </span>
              <span className="text-sm text-gray-700 truncate">{player.name}</span>
            </div>
            <span className="text-sm font-medium text-gray-900">{player.score}</span>
          </div>
        ))}
      </div>

      {/* Action Button */}
      <Link
        href="/team-analytics"
        className="block w-full text-center bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
      >
        View Full Analytics
      </Link>
    </div>
  );
}
