'use client';

import type React from 'react';
import { useState, useEffect, useMemo } from 'react';


import { fetchApi } from '@/lib/api';
import { logger } from '@/lib/logger';
import type { Player } from '@/types/players';

// Module Components
import LeaderboardModule from './dashboard/LeaderboardModule';
import LeagueManagementModule from './dashboard/LeagueManagementModule';
import LinkedInjuryFeed from './dashboard/LinkedInjuryFeed';
import LiveDraftModule from './dashboard/LiveDraftModule';
import LiveScoringModule from './dashboard/LiveScoringModule';
import MetricsCard from './dashboard/MetricsCard';
import QuickActionsModule from './dashboard/QuickActionsModule';
import RecentActivityModule from './dashboard/RecentActivityModule';
import StatsOverviewModule from './dashboard/StatsOverviewModule';
import TeamAnalyticsModule from './dashboard/TeamAnalyticsModule';
import TopPicksModule from './dashboard/TopPicksModule';
import WaiversModule from './dashboard/WaiversModule';
import WeekendSummaryModule from './dashboard/WeekendSummaryModule';

import type { User } from 'firebase/auth';

interface ModularDashboardProps {
  user: User;
}

interface DashboardModule {
  id: string;
  component: React.ComponentType<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  title: string;
  size: 'small' | 'medium' | 'large' | 'wide' | 'tall';
  priority: number;
  props?: Record<string, unknown>;
}

// Remove the unused ModuleProps interface

const defaultModules: DashboardModule[] = [
  {
    id: 'metrics',
    component: MetricsCard,
    title: 'Server Metrics',
    size: 'small',
    props: { errorRateThreshold: 2 },
    priority: 0,
  },
  {
    id: 'live-draft',
    component: LiveDraftModule,
    title: 'Live Draft',
    size: 'wide',
    priority: 1,
  },
  {
    id: 'league-management',
    component: LeagueManagementModule,
    title: 'My Leagues',
    size: 'medium',
    priority: 2,
  },
  {
    id: 'weekend-summary',
    component: WeekendSummaryModule,
    title: 'Weekend Summary',
    size: 'large',
    priority: 3,
  },
  {
    id: 'quick-actions',
    component: QuickActionsModule,
    title: 'Quick Actions',
    size: 'medium',
    priority: 4,
  },
  {
    id: 'top-picks',
    component: TopPicksModule,
    title: 'Top Picks',
    size: 'large',
    priority: 5,
  },
  {
    id: 'leaderboard',
    component: LeaderboardModule,
    title: 'Leaderboard',
    size: 'tall',
    priority: 6,
  },
  {
    id: 'injury-alerts',
    component: LinkedInjuryFeed,
    title: 'Linked Injury Report',
    size: 'wide',
    priority: 8,
  },
  {
    id: 'recent-activity',
    component: RecentActivityModule,
    title: 'Recent Activity',
    size: 'medium',
    priority: 9,
  },
  {
    id: 'stats-overview',
    component: StatsOverviewModule,
    title: 'Stats Overview',
    size: 'large',
    priority: 10,
  },
  {
    id: 'team-analytics',
    component: TeamAnalyticsModule,
    title: 'Team Analytics',
    size: 'medium',
    priority: 11,
  },
  {
    id: 'waivers-faab',
    component: WaiversModule,
    title: 'Waivers & FAAB',
    size: 'medium',
    priority: 12,
  },
  {
    id: 'live-scoring',
    component: LiveScoringModule,
    title: 'Live Scoring',
    size: 'medium',
    priority: 13,
  },
];

export default function ModularDashboard({ user }: ModularDashboardProps): React.ReactElement {
  const [players, setPlayers] = useState<Player[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Mock data for different modules
  const mockActivities = [
    {
      id: '1',
      type: 'trade' as const,
      message: 'Trade completed: You received M. Gawn',
      timestamp: new Date(Date.now() - 1000 * 60 * 30), // 30 minutes ago
    },
    {
      id: '2',
      type: 'draft' as const,
      message: 'Your pick is coming up in Round 3',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
      urgent: true,
    },
    {
      id: '3',
      type: 'score' as const,
      message: 'Weekly scores updated',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 6), // 6 hours ago
    },
  ];

  const mockStats = [
    { label: 'Total Points', value: 1247, change: 12, format: 'number' as const },
    { label: 'Weekly Rank', value: 3, change: -1, format: 'number' as const },
    { label: 'Success Rate', value: 73, change: 5, format: 'percentage' as const },
    { label: 'Trade Value', value: 850, change: 8, format: 'currency' as const },
    { label: 'Players Owned', value: 22, format: 'number' as const },
    { label: 'Avg. Score', value: 89, change: 3, format: 'number' as const },
  ];

  useEffect(() => {
    const fetchPlayers = async () => {
      try {
        const response = await fetchApi('players');
        const playersData = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : [];
        setPlayers(playersData as Player[]);
      } catch (error) {
        logger.error('Error fetching players:', error);
      }
    };
    void fetchPlayers();
  }, []);

  const handleRefreshModule = (_moduleId: string) => {
    setRefreshTrigger((prev) => prev + 1);
  };

  const getGridClasses = (size: string) => {
    switch (size) {
      case 'small':
        return 'col-span-1 row-span-1';
      case 'medium':
        return 'col-span-1 md:col-span-1 lg:col-span-1 row-span-1';
      case 'large':
        return 'col-span-1 md:col-span-2 lg:col-span-2 row-span-1';
      case 'wide':
        return 'col-span-1 md:col-span-2 lg:col-span-3 row-span-1';
      case 'tall':
        return 'col-span-1 row-span-2';
      default:
        return 'col-span-1 row-span-1';
    }
  };

  const displayName = user.displayName || user.email || 'Manager';

  return (
    <main className="min-h-screen bg-slate-50">
      <section className="mx-auto max-w-[1600px] px-4 sm:px-6 pt-6">
        <div className="rounded-2xl overflow-hidden bg-black text-white">
          <div className="px-6 py-6 border-b border-white/10">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-white/60">Dashboard</p>
                <h1 className="text-3xl font-semibold mt-2 tracking-tight">
                  Welcome back, {displayName}
                </h1>
                <p className="text-sm text-white/70 mt-2">
                  Your league control room with live scoring, drafts, and analytics.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-wide">
                  Live Dashboard
                </span>
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-wide">
                  {players.length} Players
                </span>
              </div>
            </div>
          </div>
          <div className="px-6 py-5 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950">
            <div className="flex flex-wrap gap-3">
              <span className="inline-flex items-center gap-2 rounded-md border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/80">
                Command Center
              </span>
              <button
                onClick={() => setRefreshTrigger((prev) => prev + 1)}
                className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:bg-blue-700"
              >
                Refresh Modules
              </button>
            </div>
          </div>
        </div>
      </section>
      {/* Command Center Layout */}
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <div className="xl:col-span-12">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <StatsOverviewModule stats={mockStats} refreshTrigger={refreshTrigger} />
            </div>
          </div>

          <div className="xl:col-span-8 space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <LiveScoringModule refreshTrigger={refreshTrigger} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                <LiveDraftModule user={user} refreshTrigger={refreshTrigger} />
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                <WeekendSummaryModule refreshTrigger={refreshTrigger} />
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <RecentActivityModule activities={mockActivities} refreshTrigger={refreshTrigger} />
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <LinkedInjuryFeed />
            </div>
          </div>

          <div className="xl:col-span-4 space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <LeagueManagementModule user={user} refreshTrigger={refreshTrigger} />
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <QuickActionsModule refreshTrigger={refreshTrigger} />
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <LeaderboardModule refreshTrigger={refreshTrigger} />
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <WaiversModule refreshTrigger={refreshTrigger} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
