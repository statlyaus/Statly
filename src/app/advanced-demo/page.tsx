/**
 * Advanced Real-time Features Demo Page
 * 
 * This page demonstrates all the advanced real-time features that rival ESPN and Yahoo:
 * - Advanced Live Scoring Dashboard
 * - Real-time Draft Analytics
 * - Live Trades & Waivers System
 * - Performance Monitoring
 */

'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import AdvancedLiveScoringDashboard from '@/components/advanced/AdvancedLiveScoringDashboard';
import useAdvancedLiveScoring from '@/hooks/useAdvancedLiveScoring';
import useAdvancedDraftAnalytics from '@/hooks/useAdvancedDraftAnalytics';
import useRealtimeTradesWaivers from '@/hooks/useRealtimeTradesWaivers';

export default function AdvancedDemoPage() {
  const [activeTab, setActiveTab] = useState<'live-scoring' | 'draft' | 'trades' | 'performance'>('live-scoring');

  // Mock configuration
  const mockConfig = {
    leagueId: 'demo_league_123',
    userId: 'demo_user_456',
    weekId: 'week_18_2025',
  };

  // Advanced real-time hooks
  const liveScoring = useAdvancedLiveScoring({
    ...mockConfig,
    enableNotifications: true,
    updateInterval: 10000,
    alertThresholds: {
      bigPlay: 20,
      milestone: 100,
      goalAlert: true,
    },
  });

  const draftAnalytics = useAdvancedDraftAnalytics({
    draftId: 'demo_draft_789',
    userId: mockConfig.userId,
    leagueSettings: {
      scoringSystem: 'standard',
      startingLineup: { MID: 8, DEF: 6, FWD: 6, RUC: 2 },
      benchSlots: 4,
      totalRounds: 22,
    },
    enableRecommendations: true,
    enableInsights: true,
    updateInterval: 5000,
  });

  const tradesWaivers = useRealtimeTradesWaivers({
    ...mockConfig,
    enableNotifications: true,
    updateInterval: 15000,
  });

  const tabs = [
    { id: 'live-scoring', label: 'Live Scoring', emoji: '📊' },
    { id: 'draft', label: 'Draft Analytics', emoji: '🎯' },
    { id: 'trades', label: 'Trades & Waivers', emoji: '🔄' },
    { id: 'performance', label: 'Performance', emoji: '⚡' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900">
      {/* Header */}
      <div className="bg-white/10 backdrop-blur-md border-b border-white/20">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-white mb-2">
              Advanced Real-time Fantasy Features
            </h1>
            <p className="text-xl text-white/80 mb-6">
              ESPN & Yahoo Level Real-time Features for Statly
            </p>

            {/* Feature Status Indicators */}
            <div className="flex justify-center space-x-8 mb-8">
              {[
                { label: 'Live Scoring', connected: liveScoring.connected },
                { label: 'Draft Analytics', connected: draftAnalytics.connected },
                { label: 'Trades/Waivers', connected: tradesWaivers.connected },
              ].map((feature, index) => (
                <div key={index} className="text-center">
                  <div className={`w-3 h-3 rounded-full mx-auto mb-1 ${
                    feature.connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'
                  }`} />
                  <p className="text-white/60 text-xs">{feature.label}</p>
                </div>
              ))}
            </div>

            {/* Navigation Tabs */}
            <div className="flex justify-center space-x-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-6 py-3 rounded-lg font-medium transition-all flex items-center space-x-2 ${
                    activeTab === tab.id
                      ? 'bg-white text-blue-900'
                      : 'text-white/80 hover:bg-white/10'
                  }`}
                >
                  <span>{tab.emoji}</span>
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <AnimatePresence mode="wait">
          {activeTab === 'live-scoring' && (
            <motion.div
              key="live-scoring"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <AdvancedLiveScoringDashboard {...mockConfig} />
            </motion.div>
          )}

          {activeTab === 'draft' && (
            <motion.div
              key="draft"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <DraftAnalyticsDemo analytics={draftAnalytics} />
            </motion.div>
          )}

          {activeTab === 'trades' && (
            <motion.div
              key="trades"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <TradesWaiversDemo tradesWaivers={tradesWaivers} />
            </motion.div>
          )}

          {activeTab === 'performance' && (
            <motion.div
              key="performance"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <PerformanceDemo />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// Draft Analytics Demo Component
function DraftAnalyticsDemo({ analytics }: { analytics: ReturnType<typeof useAdvancedDraftAnalytics> }) {
  const {
    recommendations,
    insights,
    positionScarcity,
    timer,
    lastPickAnalysis,
    draftStats,
  } = analytics;

  return (
    <div className="space-y-8">
      <h2 className="text-3xl font-bold text-white mb-6">Draft Analytics Dashboard</h2>

      {/* Draft Timer */}
      <div className="bg-white/10 backdrop-blur-md rounded-lg border border-white/20 p-6">
        <div className="text-center">
          <h3 className="text-xl font-semibold text-white mb-4">Draft Timer</h3>
          <div className={`text-6xl font-bold mb-2 ${
            timer.timeRemaining <= timer.criticalThreshold ? 'text-red-400' :
            timer.timeRemaining <= timer.warningThreshold ? 'text-yellow-400' : 'text-white'
          }`}>
            {Math.floor(timer.timeRemaining / 60)}:{(timer.timeRemaining % 60).toString().padStart(2, '0')}
          </div>
          <div className="flex justify-center space-x-4 text-sm text-white/60">
            <span>Status: {timer.isActive ? 'Active' : 'Paused'}</span>
            <span>Auto-pick: {timer.autoPickEnabled ? 'ON' : 'OFF'}</span>
            <span>Pauses: {timer.pausesUsed}/{timer.maxPauses}</span>
          </div>
        </div>
      </div>

      {/* Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recommendations */}
        <div className="bg-white/10 backdrop-blur-md rounded-lg border border-white/20 p-6">
          <h3 className="text-xl font-semibold text-white mb-4">Pick Recommendations</h3>
          <div className="space-y-4">
            {recommendations.slice(0, 3).map((rec, index) => (
              <div key={rec.playerId} className="p-4 bg-white/5 rounded-lg">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-medium text-white">{rec.playerName}</h4>
                    <p className="text-sm text-white/60">{rec.team} - {rec.position}</p>
                    <p className="text-xs text-white/80 mt-1">{rec.analysis}</p>
                  </div>
                  <div className="text-right">
                    <div className={`px-2 py-1 rounded text-xs font-medium ${
                      rec.confidence > 90 ? 'bg-green-100 text-green-800' :
                      rec.confidence > 70 ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {rec.confidence}% confidence
                    </div>
                    <p className="text-sm text-white/60 mt-1">
                      {rec.projectedPoints} pts
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {rec.tags.map(tag => (
                    <span key={tag} className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Position Scarcity */}
        <div className="bg-white/10 backdrop-blur-md rounded-lg border border-white/20 p-6">
          <h3 className="text-xl font-semibold text-white mb-4">Position Scarcity</h3>
          <div className="space-y-3">
            {positionScarcity.map(pos => (
              <div key={pos.position} className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                <div>
                  <span className="font-medium text-white">{pos.position}</span>
                  <p className="text-sm text-white/60">
                    {pos.qualityAvailable} quality left
                  </p>
                </div>
                <div className="text-right">
                  <div className={`px-2 py-1 rounded text-xs ${
                    pos.scarcityScore > 80 ? 'bg-red-100 text-red-800' :
                    pos.scarcityScore > 50 ? 'bg-yellow-100 text-yellow-800' :
                    'bg-green-100 text-green-800'
                  }`}>
                    {pos.scarcityScore}% scarce
                  </div>
                  <p className={`text-sm mt-1 ${
                    pos.recommendation === 'draft_now' ? 'text-red-400' :
                    pos.recommendation === 'consider' ? 'text-yellow-400' :
                    'text-green-400'
                  }`}>
                    {pos.recommendation.replace('_', ' ')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Draft Stats */}
      <div className="bg-white/10 backdrop-blur-md rounded-lg border border-white/20 p-6">
        <h3 className="text-xl font-semibold text-white mb-4">Draft Statistics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Picks', value: draftStats.totalPicks },
            { label: 'Completed', value: draftStats.completedPicks },
            { label: 'Avg Pick Time', value: `${draftStats.averagePickTime}s` },
            { label: 'Surprise Picks', value: draftStats.surprisePickCount },
          ].map((stat, index) => (
            <div key={index} className="text-center">
              <p className="text-2xl font-bold text-white">{stat.value}</p>
              <p className="text-sm text-white/60">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Trades & Waivers Demo Component
function TradesWaiversDemo({ tradesWaivers }: { tradesWaivers: ReturnType<typeof useRealtimeTradesWaivers> }) {
  const {
    incomingTrades,
    myWaiverClaims,
    recentActivity,
    waiverProcessTime,
    myWaiverPriority,
  } = tradesWaivers;

  return (
    <div className="space-y-8">
      <h2 className="text-3xl font-bold text-white mb-6">Trades & Waivers Dashboard</h2>

      {/* Status Bar */}
      <div className="bg-white/10 backdrop-blur-md rounded-lg border border-white/20 p-4">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-white font-medium">Waiver Processing</p>
            <p className="text-white/60 text-sm">{waiverProcessTime}</p>
          </div>
          <div>
            <p className="text-white font-medium">My Priority</p>
            <p className="text-white/60 text-sm">#{myWaiverPriority}</p>
          </div>
          <div>
            <p className="text-white font-medium">Active Trades</p>
            <p className="text-white/60 text-sm">{incomingTrades.length}</p>
          </div>
        </div>
      </div>

      {/* Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Incoming Trades */}
        <div className="bg-white/10 backdrop-blur-md rounded-lg border border-white/20 p-6">
          <h3 className="text-xl font-semibold text-white mb-4">Incoming Trade Offers</h3>
          {incomingTrades.length === 0 ? (
            <p className="text-white/60 text-center py-8">No pending trade offers</p>
          ) : (
            <div className="space-y-4">
              {incomingTrades.map(trade => (
                <div key={trade.id} className="p-4 bg-white/5 rounded-lg">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h4 className="font-medium text-white">From: {trade.fromUserName}</h4>
                      <p className="text-sm text-white/60">
                        Expires: {new Date(trade.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className={`px-2 py-1 rounded text-xs ${
                      trade.analysis.recommendation === 'accept' ? 'bg-green-100 text-green-800' :
                      trade.analysis.recommendation === 'reject' ? 'bg-red-100 text-red-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>
                      {trade.analysis.recommendation}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-white/60 mb-1">You Give:</p>
                      {trade.requestedPlayers.map(player => (
                        <p key={player.playerId} className="text-white">
                          {player.playerName}
                        </p>
                      ))}
                    </div>
                    <div>
                      <p className="text-white/60 mb-1">You Get:</p>
                      {trade.offeredPlayers.map(player => (
                        <p key={player.playerId} className="text-white">
                          {player.playerName}
                        </p>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 flex space-x-2">
                    <button className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700">
                      Accept
                    </button>
                    <button className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700">
                      Reject
                    </button>
                    <button className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
                      Counter
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* My Waiver Claims */}
        <div className="bg-white/10 backdrop-blur-md rounded-lg border border-white/20 p-6">
          <h3 className="text-xl font-semibold text-white mb-4">My Waiver Claims</h3>
          {myWaiverClaims.length === 0 ? (
            <p className="text-white/60 text-center py-8">No active waiver claims</p>
          ) : (
            <div className="space-y-4">
              {myWaiverClaims.map(claim => (
                <div key={claim.id} className="p-4 bg-white/5 rounded-lg">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium text-white">{claim.playerName}</h4>
                      <p className="text-sm text-white/60">
                        {claim.team} - {claim.position}
                      </p>
                      {claim.dropPlayerName && (
                        <p className="text-sm text-white/60">
                          Drop: {claim.dropPlayerName}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <div className={`px-2 py-1 rounded text-xs ${
                        claim.status === 'successful' ? 'bg-green-100 text-green-800' :
                        claim.status === 'failed' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {claim.status}
                      </div>
                      <p className="text-sm text-white/60 mt-1">
                        Priority: {claim.waiverPriority}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white/10 backdrop-blur-md rounded-lg border border-white/20 p-6">
        <h3 className="text-xl font-semibold text-white mb-4">League Activity Feed</h3>
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {recentActivity.slice(0, 10).map(activity => (
            <div key={activity.id} className="flex items-start space-x-3 p-3 bg-white/5 rounded-lg">
              <div className={`w-2 h-2 rounded-full mt-2 ${
                activity.priority === 'high' ? 'bg-red-400' :
                activity.priority === 'medium' ? 'bg-yellow-400' :
                'bg-green-400'
              }`} />
              <div className="flex-1">
                <p className="text-white text-sm">{activity.message}</p>
                <p className="text-white/60 text-xs">
                  {new Date(activity.timestamp).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Performance Monitoring Demo Component
function PerformanceDemo() {
  const performanceMetrics = {
    socketConnections: {
      liveScoring: { latency: 45, status: 'connected', uptime: 99.8 },
      draft: { latency: 32, status: 'connected', uptime: 99.9 },
      trades: { latency: 28, status: 'connected', uptime: 100 },
    },
    realTimeFeatures: {
      liveDataUpdates: 847,
      draftPicks: 156,
      tradeNotifications: 23,
      waiverClaims: 67,
    },
    userExperience: {
      averageResponseTime: 340, // ms
      errorRate: 0.02, // %
      userSatisfaction: 4.8, // out of 5
    },
  };

  return (
    <div className="space-y-8">
      <h2 className="text-3xl font-bold text-white mb-6">Real-time Performance Monitoring</h2>

      {/* Connection Health */}
      <div className="bg-white/10 backdrop-blur-md rounded-lg border border-white/20 p-6">
        <h3 className="text-xl font-semibold text-white mb-4">Socket Connection Health</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {Object.entries(performanceMetrics.socketConnections).map(([key, metrics]) => (
            <div key={key} className="text-center">
              <div className={`w-4 h-4 rounded-full mx-auto mb-2 ${
                metrics.status === 'connected' ? 'bg-green-400' : 'bg-red-400'
              }`} />
              <h4 className="font-medium text-white capitalize">{key.replace(/([A-Z])/g, ' $1')}</h4>
              <p className="text-2xl font-bold text-white">{metrics.latency}ms</p>
              <p className="text-sm text-white/60">{metrics.uptime}% uptime</p>
            </div>
          ))}
        </div>
      </div>

      {/* Real-time Activity */}
      <div className="bg-white/10 backdrop-blur-md rounded-lg border border-white/20 p-6">
        <h3 className="text-xl font-semibold text-white mb-4">Real-time Activity (Last 24h)</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(performanceMetrics.realTimeFeatures).map(([key, value]) => (
            <div key={key} className="text-center p-4 bg-white/5 rounded-lg">
              <p className="text-2xl font-bold text-white">{value.toLocaleString()}</p>
              <p className="text-sm text-white/60 capitalize">
                {key.replace(/([A-Z])/g, ' $1')}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* User Experience Metrics */}
      <div className="bg-white/10 backdrop-blur-md rounded-lg border border-white/20 p-6">
        <h3 className="text-xl font-semibold text-white mb-4">User Experience</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center">
            <p className="text-3xl font-bold text-white">
              {performanceMetrics.userExperience.averageResponseTime}ms
            </p>
            <p className="text-sm text-white/60">Average Response Time</p>
            <div className="w-full bg-white/10 rounded-full h-2 mt-2">
              <div 
                className="bg-green-400 h-2 rounded-full" 
                style={{ width: `${Math.max(0, 100 - (performanceMetrics.userExperience.averageResponseTime / 10))}%` }}
              />
            </div>
          </div>
          
          <div className="text-center">
            <p className="text-3xl font-bold text-white">
              {performanceMetrics.userExperience.errorRate}%
            </p>
            <p className="text-sm text-white/60">Error Rate</p>
            <div className="w-full bg-white/10 rounded-full h-2 mt-2">
              <div 
                className="bg-green-400 h-2 rounded-full" 
                style={{ width: `${100 - (performanceMetrics.userExperience.errorRate * 50)}%` }}
              />
            </div>
          </div>
          
          <div className="text-center">
            <p className="text-3xl font-bold text-white">
              {performanceMetrics.userExperience.userSatisfaction}/5
            </p>
            <p className="text-sm text-white/60">User Satisfaction</p>
            <div className="w-full bg-white/10 rounded-full h-2 mt-2">
              <div 
                className="bg-green-400 h-2 rounded-full" 
                style={{ width: `${(performanceMetrics.userExperience.userSatisfaction / 5) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}