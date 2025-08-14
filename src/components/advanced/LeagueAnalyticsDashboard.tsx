'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from '@/components/ui';

// Types
interface LeagueAnalytics {
  totalManagers: number;
  averageScore: number;
  highestScore: number;
  lowestScore: number;
  mostOwnedPlayer: {
    name: string;
    ownership: number;
  };
  leastOwnedGoodPlayer: {
    name: string;
    ownership: number;
    averageScore: number;
  };
  tradesUsed: {
    week: number;
    count: number;
  }[];
  captaincyTrends: {
    player: string;
    percentage: number;
    avgScore: number;
  }[];
}

interface TeamComparison {
  rank: number;
  teamName: string;
  totalScore: number;
  averageScore: number;
  trades: number;
  hits: number;
  form: number[];
  differential: number;
}

interface LeagueAnalyticsDashboardProps {
  leagueId?: string;
  userTeamId?: string;
}

// Mock data
const mockAnalytics: LeagueAnalytics = {
  totalManagers: 12,
  averageScore: 2156,
  highestScore: 2487,
  lowestScore: 1823,
  mostOwnedPlayer: {
    name: 'Marcus Bontempelli',
    ownership: 83
  },
  leastOwnedGoodPlayer: {
    name: 'Touk Miller',
    ownership: 17,
    averageScore: 112
  },
  tradesUsed: [
    { week: 1, count: 24 },
    { week: 2, count: 18 },
    { week: 3, count: 32 },
    { week: 4, count: 28 }
  ],
  captaincyTrends: [
    { player: 'Marcus Bontempelli', percentage: 33, avgScore: 118 },
    { player: 'Lachie Neale', percentage: 25, avgScore: 115 },
    { player: 'Clayton Oliver', percentage: 17, avgScore: 108 },
    { player: 'Tim English', percentage: 25, avgScore: 102 }
  ]
};

const mockTeamComparisons: TeamComparison[] = [
  {
    rank: 1,
    teamName: 'The Dominators',
    totalScore: 2487,
    averageScore: 124.4,
    trades: 2,
    hits: 0,
    form: [145, 132, 118, 142, 128],
    differential: 0
  },
  {
    rank: 2,
    teamName: 'Your Team',
    totalScore: 2431,
    averageScore: 121.6,
    trades: 3,
    hits: 1,
    form: [138, 128, 115, 135, 124],
    differential: -56
  },
  {
    rank: 3,
    teamName: 'Fantasy Legends',
    totalScore: 2398,
    averageScore: 119.9,
    trades: 1,
    hits: 0,
    form: [142, 125, 108, 128, 131],
    differential: -89
  }
];

export default function LeagueAnalyticsDashboard({
  leagueId: _leagueId,
  userTeamId: _userTeamId
}: LeagueAnalyticsDashboardProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'ownership' | 'performance' | 'insights'>('overview');
  const [timeframe, setTimeframe] = useState<'week' | 'month' | 'season'>('week');

  const renderMetricCard = (title: string, value: string | number, subtitle?: string, trend?: 'up' | 'down' | 'neutral') => (
    <motion.div
      layout
      className="bg-white rounded-lg border border-gray-200 p-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-gray-600">{title}</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
          {subtitle && (
            <div className="text-sm text-gray-500 mt-1">{subtitle}</div>
          )}
        </div>
        {trend && (
          <div className={`p-2 rounded-full ${
            trend === 'up' ? 'bg-green-100 text-green-600' :
            trend === 'down' ? 'bg-red-100 text-red-600' :
            'bg-gray-100 text-gray-600'
          }`}>
            {trend === 'up' ? '📈' : trend === 'down' ? '📉' : '➡️'}
          </div>
        )}
      </div>
    </motion.div>
  );

  const renderTeamRow = (team: TeamComparison, isUserTeam: boolean = false) => (
    <motion.div
      key={team.teamName}
      layout
      className={`grid grid-cols-7 gap-4 items-center p-4 rounded-lg border transition-colors ${
        isUserTeam 
          ? 'bg-blue-50 border-blue-200' 
          : 'bg-white border-gray-200 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
          team.rank === 1 ? 'bg-yellow-100 text-yellow-800' :
          team.rank === 2 ? 'bg-gray-100 text-gray-700' :
          team.rank === 3 ? 'bg-orange-100 text-orange-700' :
          'bg-gray-50 text-gray-600'
        }`}>
          {team.rank}
        </div>
        <div>
          <div className={`font-semibold ${isUserTeam ? 'text-blue-900' : 'text-gray-900'}`}>
            {team.teamName}
          </div>
          {isUserTeam && (
            <Badge variant="info" size="sm">You</Badge>
          )}
        </div>
      </div>
      
      <div className="text-right">
        <div className="font-semibold text-gray-900">{team.totalScore.toLocaleString()}</div>
        <div className="text-xs text-gray-500">Total</div>
      </div>
      
      <div className="text-right">
        <div className="font-medium text-gray-900">{team.averageScore}</div>
        <div className="text-xs text-gray-500">Avg</div>
      </div>
      
      <div className="text-center">
        <div className="font-medium text-gray-900">{team.trades}</div>
        <div className="text-xs text-gray-500">Trades</div>
      </div>
      
      <div className="text-center">
        <div className={`font-medium ${team.hits > 0 ? 'text-red-600' : 'text-green-600'}`}>
          {team.hits}
        </div>
        <div className="text-xs text-gray-500">Hits</div>
      </div>
      
      <div className="flex -space-x-1">
        {team.form.map((score, idx) => (
          <div
            key={idx}
            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium border-2 border-white ${
              score >= 130 ? 'bg-green-100 text-green-700' :
              score >= 110 ? 'bg-yellow-100 text-yellow-700' :
              'bg-red-100 text-red-700'
            }`}
            title={`Round ${idx + 1}: ${score} points`}
          >
            {score}
          </div>
        ))}
      </div>
      
      <div className="text-right">
        <div className={`font-semibold ${
          team.differential > 0 ? 'text-green-600' :
          team.differential < 0 ? 'text-red-600' :
          'text-gray-600'
        }`}>
          {team.differential > 0 ? '+' : ''}{team.differential}
        </div>
        <div className="text-xs text-gray-500">Behind</div>
      </div>
    </motion.div>
  );

  const renderCaptaincyChart = () => (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Captaincy Trends</h3>
      <div className="space-y-4">
        {mockAnalytics.captaincyTrends.map((trend, idx) => (
          <div key={idx} className="flex items-center gap-4">
            <div className="w-24 text-sm font-medium text-gray-900 truncate">
              {trend.player}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${trend.percentage}%` }}
                  />
                </div>
                <div className="text-sm font-medium text-gray-900 w-8">
                  {trend.percentage}%
                </div>
              </div>
            </div>
            <div className="text-sm text-gray-600 w-16 text-right">
              {trend.avgScore} avg
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">League Analytics</h1>
          <p className="text-gray-600 mt-1">Comprehensive insights and performance analysis</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
            {[
              { id: 'week', label: 'This Week' },
              { id: 'month', label: 'This Month' },
              { id: 'season', label: 'Season' }
            ].map((option) => (
              <button
                key={option.id}
                onClick={() => setTimeframe(option.id as typeof timeframe)}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  timeframe === option.id
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg mb-6">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'ownership', label: 'Ownership' },
          { id: 'performance', label: 'Performance' },
          { id: 'insights', label: 'Insights' }
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

      {/* Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {renderMetricCard('Total Managers', mockAnalytics.totalManagers)}
              {renderMetricCard('Average Score', mockAnalytics.averageScore.toLocaleString())}
              {renderMetricCard('Highest Score', mockAnalytics.highestScore.toLocaleString(), undefined, 'up')}
              {renderMetricCard('Score Range', `${mockAnalytics.highestScore - mockAnalytics.lowestScore}`, 'points')}
            </div>

            {/* League Standings */}
            <div className="bg-white rounded-lg border border-gray-200">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">League Standings</h2>
                <p className="text-gray-600 mt-1">Top teams and current form</p>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-7 gap-4 text-sm font-medium text-gray-500 mb-4 px-4">
                  <div>Team</div>
                  <div className="text-right">Total</div>
                  <div className="text-right">Average</div>
                  <div className="text-center">Trades</div>
                  <div className="text-center">Hits</div>
                  <div>Form (Last 5)</div>
                  <div className="text-right">Behind Leader</div>
                </div>
                <div className="space-y-2">
                  {mockTeamComparisons.map(team => 
                    renderTeamRow(team, team.teamName === 'Your Team')
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'ownership' && (
          <motion.div
            key="ownership"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            {/* Ownership Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {renderMetricCard(
                'Most Owned Player', 
                mockAnalytics.mostOwnedPlayer.name, 
                `${mockAnalytics.mostOwnedPlayer.ownership}% ownership`
              )}
              {renderMetricCard(
                'Hidden Gem', 
                mockAnalytics.leastOwnedGoodPlayer.name, 
                `${mockAnalytics.leastOwnedGoodPlayer.ownership}% ownership, ${mockAnalytics.leastOwnedGoodPlayer.averageScore} avg`
              )}
            </div>

            {/* Captaincy Trends */}
            {renderCaptaincyChart()}
          </motion.div>
        )}

        {activeTab === 'performance' && (
          <motion.div
            key="performance"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="text-center py-12"
          >
            <div className="text-gray-400 text-lg mb-2">Performance Analysis</div>
            <div className="text-gray-500">Detailed performance metrics and trends</div>
          </motion.div>
        )}

        {activeTab === 'insights' && (
          <motion.div
            key="insights"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="text-center py-12"
          >
            <div className="text-gray-400 text-lg mb-2">AI Insights</div>
            <div className="text-gray-500">Machine learning powered league insights and recommendations</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
