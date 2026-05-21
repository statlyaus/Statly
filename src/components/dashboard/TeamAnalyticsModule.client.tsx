'use client';

import React from 'react';

import Link from 'next/link';

import {
  BarChart3 as ChartBarIcon,
  Trophy as TrophyIcon,
  Flame as FireIcon,
  TrendingUp as ArrowTrendingUpIcon,
  TrendingDown as ArrowTrendingDownIcon,
} from 'lucide-react';

interface TeamAnalyticsModuleProps {
  refreshTrigger: number;
}

export default function TeamAnalyticsModuleClient({
  refreshTrigger: _refreshTrigger,
}: TeamAnalyticsModuleProps) {
  const teamData = {
    weeklyScore: 2156,
    projectedScore: 2189,
    rank: 15847,
    teamValue: 8450000,
    risingStars: 3,
    formConcerns: 2,
    injuryConcerns: 1,
    captainScore: 178,
    topPerformers: [
      { name: 'M. Bontempelli', score: 142, position: 'MID' },
      { name: 'Max Gawn', score: 125, position: 'RUC' },
      { name: 'D. Martin', score: 115, position: 'FWD' },
    ],
  };

  // Compute safe delta and format sign
  const delta = (teamData.projectedScore ?? 0) - (teamData.weeklyScore ?? 0);
  const deltaDisplay = delta > 0 ? `+${delta}` : `${delta}`;

  const getPositionColor = (position: string) => {
    switch (position) {
      case 'FWD':
        return 'bg-destructive/10 text-destructive';
      case 'MID':
        return 'bg-success/10 text-success';
      case 'DEF':
        return 'bg-info/10 text-info';
      case 'RUC':
        return 'bg-primary/10 text-primary';
      default:
        return 'bg-muted text-foreground';
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-info/10 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-info uppercase tracking-wide">Weekly Score</p>
              <p className="text-lg font-bold text-info">{teamData.weeklyScore.toLocaleString()}</p>
            </div>
            <ChartBarIcon className="w-6 h-6 text-info" />
          </div>
          <div className="mt-1">
            <span className="text-xs text-info">{deltaDisplay} projected</span>
          </div>
        </div>

        <div className="bg-success/10 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-success uppercase tracking-wide">Team Rank</p>
              <p className="text-lg font-bold text-success">#{teamData.rank.toLocaleString()}</p>
            </div>
            <TrophyIcon className="w-6 h-6 text-success" />
          </div>
          <div className="mt-1">
            <span className="text-xs text-success">
              ${(teamData.teamValue / 1000000).toFixed(2)}M value
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-foreground">Team Insights</h4>

        <div className="flex items-center justify-between py-1">
          <div className="flex items-center gap-2">
            <ArrowTrendingUpIcon className="w-4 h-4 text-success" />
            <span className="text-sm text-foreground">Rising Stars</span>
          </div>
          <span className="text-sm font-medium text-foreground">{teamData.risingStars}</span>
        </div>

        <div className="flex items-center justify-between py-1">
          <div className="flex items-center gap-2">
            <ArrowTrendingDownIcon className="w-4 h-4 text-destructive" />
            <span className="text-sm text-foreground">Form Concerns</span>
          </div>
          <span className="text-sm font-medium text-foreground">{teamData.formConcerns}</span>
        </div>

        <div className="flex items-center justify-between py-1">
          <div className="flex items-center gap-2">
            <FireIcon className="w-4 h-4 text-warning" />
            <span className="text-sm text-foreground">Injury Watch</span>
          </div>
          <span className="text-sm font-medium text-foreground">{teamData.injuryConcerns}</span>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-foreground">Top Performers</h4>
        {teamData.topPerformers.map((player) => (
          <div key={player.name} className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <span
                className={`px-1.5 py-0.5 rounded text-xs font-medium ${getPositionColor(player.position)}`}
              >
                {player.position}
              </span>
              <span className="text-sm text-foreground truncate">{player.name}</span>
            </div>
            <span className="text-sm font-medium text-foreground">{player.score}</span>
          </div>
        ))}
      </div>

      <Link
        href="/team-analytics"
        className="block w-full text-center bg-info hover:bg-info text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
      >
        View Full Analytics
      </Link>
    </div>
  );
}
