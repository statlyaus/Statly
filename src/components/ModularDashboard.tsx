'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { User } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebaseClient';
import type { Player } from '@/types/players';
import { logger } from '@/lib/logger';
import { io, type Socket } from 'socket.io-client';

// Module Components
import LiveDraftModule from './dashboard/LiveDraftModule';
import TopPicksModule from './dashboard/TopPicksModule';
import LeaderboardModule from './dashboard/LeaderboardModule';
import PlayerSpotlightModule from './dashboard/PlayerSpotlightModule';
import WeekendSummaryModule from './dashboard/WeekendSummaryModule';
import LinkedInjuryFeed from './dashboard/LinkedInjuryFeed';
import QuickActionsModule from './dashboard/QuickActionsModule';
import RecentActivityModule from './dashboard/RecentActivityModule';
import StatsOverviewModule from './dashboard/StatsOverviewModule';
import LeagueManagementModule from './dashboard/LeagueManagementModule';
import TeamAnalyticsModule from './dashboard/TeamAnalyticsModule';
import WaiversModule from './dashboard/WaiversModule';
import LiveScoringModule from './dashboard/LiveScoringModule';
import MetricsCard from './dashboard/MetricsCard';

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
    id: 'player-spotlight',
    component: PlayerSpotlightModule,
    title: 'Player Spotlight',
    size: 'medium',
    priority: 7,
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

export default function ModularDashboard({ user }: ModularDashboardProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [modules, setModules] = useState<DashboardModule[]>(defaultModules);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);

  const firstName = useMemo(() => {
    return user.displayName?.trim().split(/\s+/)[0] || user.email?.split('@')[0] || 'Player';
  }, [user]);

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
      const database = db;
      if (!database) {
        logger.error('Firebase database not initialized. Cannot fetch players.');
        return;
      }

      try {
        const querySnapshot = await getDocs(collection(database, 'players'));
        const data = querySnapshot.docs.map((doc) => {
          const docData = doc.data();
          return {
            id: doc.id,
            name: docData.name,
            team: docData.team,
            position: docData.position,
            injury: docData.injury,
          } as Player;
        });
        setPlayers(data);
      } catch (error) {
        logger.error('Error fetching players:', error);
      }
    };
    fetchPlayers();
  }, []);

  useEffect(() => {
    const s = io(process.env.NEXT_PUBLIC_SOCKET_URL ?? undefined, {
      transports: ['websocket'],
      withCredentials: false,
    });
    setSocket(s);

    const onConnect = () => logger.info('Socket connected', { id: s.id });
    const onConnectError = (err: Error) => logger.error('Socket connect_error', err);
    const onDashboardUpdate = (data: unknown) => {
      logger.info('Dashboard update received', data);
    };

    s.on('connect', onConnect);
    s.on('connect_error', onConnectError);
    s.on('dashboard:update', onDashboardUpdate);

    return () => {
      s.off('connect', onConnect);
      s.off('connect_error', onConnectError);
      s.off('dashboard:update', onDashboardUpdate);
      s.disconnect();
    };
  }, []);

  // Filter modules based on conditions
  const visibleModules = useMemo(() => {
    return modules
      .filter((module) => module.priority !== 999)
      .slice()
      .sort((a, b) => a.priority - b.priority);
  }, [modules]);

  const handleToggleModule = (moduleId: string) => {
    setModules((prev) =>
      prev.map((module) =>
        module.id === moduleId
          ? {
              ...module,
              priority:
                module.priority === 999
                  ? defaultModules.find((d) => d.id === moduleId)?.priority || 1
                  : 999,
            }
          : module
      )
    );
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

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      {/* Hero Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold text-slate-900 mb-2">
                Welcome back, {firstName}! 👋
              </h1>
              <p className="text-lg text-slate-600">
                Your fantasy empire awaits. Time to dominate the competition.
              </p>
            </div>

            {/* Dashboard Controls */}
            <div className="flex items-center space-x-3">
              <button
                onClick={() => socket?.emit('dashboard:refresh')}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                <span>Refresh</span>
              </button>

              <button
                onClick={() => setIsCustomizing(!isCustomizing)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
                  isCustomizing
                    ? 'bg-purple-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4"
                  />
                </svg>
                <span>{isCustomizing ? 'Done' : 'Customize'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Customization Panel */}
      <AnimatePresence>
        {isCustomizing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-purple-50 border-b border-purple-200"
          >
            <div className="container mx-auto px-4 py-4">
              <h3 className="text-lg font-semibold text-purple-900 mb-3">
                Customize Your Dashboard
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                {defaultModules.map((module) => {
                  const isVisible = visibleModules.some((v) => v.id === module.id);
                  return (
                    <button
                      key={module.id}
                      onClick={() => handleToggleModule(module.id)}
                      className={`p-3 rounded-lg text-sm font-medium transition-colors ${
                        isVisible
                          ? 'bg-purple-600 text-white'
                          : 'bg-white text-purple-700 border border-purple-300 hover:bg-purple-100'
                      }`}
                    >
                      {module.title}
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modular Grid */}
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 auto-rows-min">
          <AnimatePresence mode="popLayout">
            {visibleModules.map((module, index) => {
              const Component = module.component;
              return (
                <motion.div
                  key={module.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: -20 }}
                  transition={{
                    duration: 0.3,
                    delay: index * 0.05,
                    layout: { duration: 0.3 },
                  }}
                  className={`${getGridClasses(module.size)} group`}
                >
                  <div className="h-full bg-white rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow duration-300 overflow-hidden">
                    {/* Module Header */}
                    <div className="flex items-center justify-between p-4 border-b border-slate-100">
                      <h3 className="font-semibold text-slate-900">{module.title}</h3>
                      <div className="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => socket?.emit('module:refresh', module.id)}
                          className="p-1 hover:bg-slate-100 rounded transition-colors"
                          title="Refresh module"
                        >
                          <svg
                            className="w-4 h-4 text-slate-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                        </button>
                        {isCustomizing && (
                          <button
                            onClick={() => handleToggleModule(module.id)}
                            className="p-1 hover:bg-red-100 rounded transition-colors"
                            title="Hide module"
                          >
                            <svg
                              className="w-4 h-4 text-red-400"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12"
                              />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Module Content */}
                    <div className="p-4 h-full">
                      <Component
                        user={user}
                        players={players}
                        activities={mockActivities}
                        stats={mockStats}
                        socket={socket}
                        {...module.props}
                      />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Empty State */}
        {visibleModules.length === 0 && (
          <div className="text-center py-16">
            <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-12 h-12 text-slate-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-slate-900 mb-2">No modules selected</h3>
            <p className="text-slate-600 mb-4">
              Click &ldquo;Customize&rdquo; to add modules to your dashboard.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
