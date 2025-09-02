'use client';

import { useState } from 'react';
import MatchLogTable from '@/components/MatchLogTable';
import { motion } from 'framer-motion';
import {
  EyeIcon,
  CodeBracketIcon,
  SparklesIcon,
  DevicePhoneMobileIcon,
  ShieldCheckIcon,
  ChartBarIcon,
  TrophyIcon,
  FireIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  UserIcon,
} from '@heroicons/react/24/outline';

type MatchLog = {
  round: number;
  opponent: string;
  goals?: number;
  disposals?: number;
  marks?: number;
  tackles?: number;
  fantasyPoints?: number;
  matchDate?: string;
  venue?: string;
  result?: 'W' | 'L' | 'D';
  margin?: number;
  kickingAccuracy?: string;
  timeOnGround?: number;
  superCoachScore?: number;
  dreamTeamScore?: number;
};

export default function MatchLogTableDemo() {
  const [activeTab, setActiveTab] = useState<'overview' | 'features' | 'code'>('overview');
  const [isLoading, setIsLoading] = useState(false);

  // Sample match log data
  const sampleMatchLogs = [
    {
      round: 23,
      opponent: 'Brisbane Lions',
      goals: 3,
      disposals: 28,
      marks: 12,
      tackles: 6,
      fantasyPoints: 115,
      matchDate: '2024-08-18',
      venue: 'Gabba',
      result: 'W' as const,
      margin: 15,
      kickingAccuracy: '75%',
      timeOnGround: 85,
      superCoachScore: 142,
      dreamTeamScore: 138,
    },
    {
      round: 22,
      opponent: 'Richmond Tigers',
      goals: 1,
      disposals: 22,
      marks: 8,
      tackles: 4,
      fantasyPoints: 87,
      matchDate: '2024-08-11',
      venue: 'MCG',
      result: 'L' as const,
      margin: -8,
      kickingAccuracy: '67%',
      timeOnGround: 78,
      superCoachScore: 95,
      dreamTeamScore: 89,
    },
    {
      round: 21,
      opponent: 'Geelong Cats',
      goals: 2,
      disposals: 31,
      marks: 15,
      tackles: 8,
      fantasyPoints: 128,
      matchDate: '2024-08-04',
      venue: 'GMHBA Stadium',
      result: 'W' as const,
      margin: 22,
      kickingAccuracy: '80%',
      timeOnGround: 92,
      superCoachScore: 156,
      dreamTeamScore: 148,
    },
    {
      round: 20,
      opponent: 'Sydney Swans',
      goals: 0,
      disposals: 18,
      marks: 6,
      tackles: 3,
      fantasyPoints: 65,
      matchDate: '2024-07-28',
      venue: 'SCG',
      result: 'L' as const,
      margin: -12,
      kickingAccuracy: '50%',
      timeOnGround: 68,
      superCoachScore: 72,
      dreamTeamScore: 69,
    },
    {
      round: 19,
      opponent: 'Collingwood Magpies',
      goals: 4,
      disposals: 25,
      marks: 10,
      tackles: 7,
      fantasyPoints: 132,
      matchDate: '2024-07-21',
      venue: 'MCG',
      result: 'W' as const,
      margin: 18,
      kickingAccuracy: '85%',
      timeOnGround: 88,
      superCoachScore: 165,
      dreamTeamScore: 159,
    },
    {
      round: 18,
      opponent: 'West Coast Eagles',
      goals: 2,
      disposals: 24,
      marks: 9,
      tackles: 5,
      fantasyPoints: 98,
      matchDate: '2024-07-14',
      venue: 'Optus Stadium',
      result: 'W' as const,
      margin: 35,
      kickingAccuracy: '71%',
      timeOnGround: 82,
      superCoachScore: 118,
      dreamTeamScore: 112,
    },
  ];

  const features = [
    {
      icon: <ChartBarIcon className="w-6 h-6" />,
      title: 'Advanced Statistics',
      description:
        'Comprehensive match statistics with performance analytics and trend visualization',
    },
    {
      icon: <FunnelIcon className="w-6 h-6" />,
      title: 'Powerful Filtering',
      description: 'Multi-criteria filtering by points range, results, rounds, and search terms',
    },
    {
      icon: <TrophyIcon className="w-6 h-6" />,
      title: 'Performance Insights',
      description: 'Color-coded performance indicators and statistical summaries',
    },
    {
      icon: <DevicePhoneMobileIcon className="w-6 h-6" />,
      title: 'Responsive Design',
      description: 'Fully responsive table with mobile-optimized interactions',
    },
    {
      icon: <SparklesIcon className="w-6 h-6" />,
      title: 'Smooth Animations',
      description: 'Framer Motion powered transitions and micro-interactions',
    },
    {
      icon: <ShieldCheckIcon className="w-6 h-6" />,
      title: 'Data Integrity',
      description: 'Robust data handling with null safety and error boundaries',
    },
  ];

  const codeExample = `'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import MatchLogTable from '@/components/MatchLogTable';

interface MatchLog {
  round: number;
  opponent: string;
  goals?: number;
  disposals?: number;
  marks?: number;
  tackles?: number;
  fantasyPoints?: number;
  matchDate?: string;
  venue?: string;
  result?: 'W' | 'L' | 'D';
  // ... additional fields
}

const PlayerProfile = () => {
  const [matchLogs, setMatchLogs] = useState<MatchLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleMatchSelect = (match: MatchLog) => {
    // Handle match selection for detailed view
    console.log('Selected match:', match);
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    // Fetch fresh data
    await fetchMatchLogs();
    setIsLoading(false);
  };

  return (
    <MatchLogTable
      matchLogs={matchLogs}
      playerName="Marcus Bontempelli"
      isLoading={isLoading}
      onRefresh={handleRefresh}
      onMatchSelect={handleMatchSelect}
      showAdvancedStats={true}
      className="max-w-7xl mx-auto"
    />
  );
};`;

  const handleRefresh = () => {
    setIsLoading(true);
    setTimeout(() => setIsLoading(false), 2000);
  };

  const handleMatchSelect = (match: MatchLog) => {
    console.log('Demo: Selected match', match);
  };

  return (
    <div className="min-h-screen bg-base-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-4"
          >
            <ChartBarIcon className="w-4 h-4" />
            Match Log Table Demo
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl font-bold text-base-content mb-4"
          >
            Enhanced MatchLogTable Component
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-lg text-base-content/70 max-w-3xl mx-auto"
          >
            A comprehensive match log table with advanced filtering, sorting, statistics, and
            interactive features for fantasy sports data visualization.
          </motion.p>
        </div>

        {/* Tab Navigation */}
        <div className="flex justify-center mb-8">
          <div className="tabs tabs-boxed bg-base-200 p-1">
            <button
              className={`tab tab-lg gap-2 ${activeTab === 'overview' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              <EyeIcon className="w-4 h-4" />
              Live Demo
            </button>
            <button
              className={`tab tab-lg gap-2 ${activeTab === 'features' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('features')}
            >
              <SparklesIcon className="w-4 h-4" />
              Features
            </button>
            <button
              className={`tab tab-lg gap-2 ${activeTab === 'code' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('code')}
            >
              <CodeBracketIcon className="w-4 h-4" />
              Code
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
        >
          {activeTab === 'overview' && (
            <div className="space-y-8">
              {/* Interactive Demo */}
              <div className="card bg-base-200 shadow-xl">
                <div className="card-body">
                  <h2 className="card-title text-2xl mb-4 flex items-center gap-2">
                    <EyeIcon className="w-6 h-6 text-primary" />
                    Interactive Match Log Demo
                  </h2>

                  <p className="text-base-content/70 mb-6">
                    This demo shows a sample player&apos;s match logs with full functionality. Try
                    the filtering, sorting, and detailed view features.
                  </p>

                  <MatchLogTable
                    matchLogs={sampleMatchLogs}
                    playerName="Marcus Bontempelli"
                    isLoading={isLoading}
                    onRefresh={handleRefresh}
                    onMatchSelect={handleMatchSelect}
                    showAdvancedStats={true}
                    className="bg-base-100 rounded-xl"
                  />
                </div>
              </div>

              {/* Feature Highlights */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card bg-base-200 shadow-lg">
                  <div className="card-body">
                    <h3 className="card-title text-lg mb-4 flex items-center gap-2">
                      <MagnifyingGlassIcon className="w-5 h-5 text-primary" />
                      Try These Features
                    </h3>
                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="w-2 h-2 bg-primary rounded-full mt-2"></div>
                        <div>
                          <p className="font-medium">Advanced Filtering</p>
                          <p className="text-sm text-base-content/70">
                            Click &quot;Filters&quot; to access multi-criteria filtering options
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-2 h-2 bg-primary rounded-full mt-2"></div>
                        <div>
                          <p className="font-medium">Column Sorting</p>
                          <p className="text-sm text-base-content/70">
                            Click any column header to sort by that field
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-2 h-2 bg-primary rounded-full mt-2"></div>
                        <div>
                          <p className="font-medium">Match Details</p>
                          <p className="text-sm text-base-content/70">
                            Click the eye icon or any row to view detailed match information
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-2 h-2 bg-primary rounded-full mt-2"></div>
                        <div>
                          <p className="font-medium">Performance Indicators</p>
                          <p className="text-sm text-base-content/70">
                            Fantasy points are color-coded based on performance levels
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card bg-base-200 shadow-lg">
                  <div className="card-body">
                    <h3 className="card-title text-lg mb-4 flex items-center gap-2">
                      <TrophyIcon className="w-5 h-5 text-secondary" />
                      Performance Analytics
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="stat bg-base-100 rounded-lg">
                        <div className="stat-figure text-primary">
                          <ChartBarIcon className="w-6 h-6" />
                        </div>
                        <div className="stat-title text-xs">Best Performance</div>
                        <div className="stat-value text-lg">132 pts</div>
                        <div className="stat-desc">vs Collingwood</div>
                      </div>
                      <div className="stat bg-base-100 rounded-lg">
                        <div className="stat-figure text-success">
                          <FireIcon className="w-6 h-6" />
                        </div>
                        <div className="stat-title text-xs">Win Rate</div>
                        <div className="stat-value text-lg">67%</div>
                        <div className="stat-desc">4 wins, 2 losses</div>
                      </div>
                      <div className="stat bg-base-100 rounded-lg">
                        <div className="stat-title text-xs">Avg Points</div>
                        <div className="stat-value text-lg">104</div>
                      </div>
                      <div className="stat bg-base-100 rounded-lg">
                        <div className="stat-title text-xs">Total Goals</div>
                        <div className="stat-value text-lg">12</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'features' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {features.map((feature, index) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="card bg-base-200 shadow-lg hover:shadow-xl transition-shadow duration-300"
                >
                  <div className="card-body">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="p-3 bg-primary/10 text-primary rounded-xl">
                        {feature.icon}
                      </div>
                      <h3 className="card-title text-lg">{feature.title}</h3>
                    </div>
                    <p className="text-base-content/70">{feature.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {activeTab === 'code' && (
            <div className="space-y-6">
              <div className="card bg-base-200 shadow-xl">
                <div className="card-body">
                  <h2 className="card-title text-2xl mb-6 flex items-center gap-2">
                    <CodeBracketIcon className="w-6 h-6 text-primary" />
                    Implementation Guide
                  </h2>

                  <div className="mockup-code">
                    <pre data-prefix="1">
                      <code>{codeExample}</code>
                    </pre>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="card bg-base-200 shadow-lg">
                  <div className="card-body">
                    <h3 className="card-title mb-4">Props Interface</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <code className="text-primary">matchLogs</code>
                        <span className="text-base-content/70">MatchLog[] (required)</span>
                      </div>
                      <div className="flex justify-between">
                        <code className="text-primary">playerName</code>
                        <span className="text-base-content/70">string (optional)</span>
                      </div>
                      <div className="flex justify-between">
                        <code className="text-primary">isLoading</code>
                        <span className="text-base-content/70">boolean (optional)</span>
                      </div>
                      <div className="flex justify-between">
                        <code className="text-primary">onRefresh</code>
                        <span className="text-base-content/70">() =&gt; void (optional)</span>
                      </div>
                      <div className="flex justify-between">
                        <code className="text-primary">onMatchSelect</code>
                        <span className="text-base-content/70">(match) =&gt; void (optional)</span>
                      </div>
                      <div className="flex justify-between">
                        <code className="text-primary">showAdvancedStats</code>
                        <span className="text-base-content/70">boolean (optional)</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card bg-base-200 shadow-lg">
                  <div className="card-body">
                    <h3 className="card-title mb-4">Key Features</h3>
                    <ul className="text-sm space-y-2">
                      <li className="flex items-start gap-2">
                        <UserIcon className="w-4 h-4 text-success mt-0.5" />
                        Sortable columns with visual indicators
                      </li>
                      <li className="flex items-start gap-2">
                        <UserIcon className="w-4 h-4 text-success mt-0.5" />
                        Advanced filtering with multiple criteria
                      </li>
                      <li className="flex items-start gap-2">
                        <UserIcon className="w-4 h-4 text-success mt-0.5" />
                        Performance-based color coding
                      </li>
                      <li className="flex items-start gap-2">
                        <UserIcon className="w-4 h-4 text-success mt-0.5" />
                        Detailed match view modal
                      </li>
                      <li className="flex items-start gap-2">
                        <UserIcon className="w-4 h-4 text-success mt-0.5" />
                        Comprehensive statistics overview
                      </li>
                      <li className="flex items-start gap-2">
                        <UserIcon className="w-4 h-4 text-success mt-0.5" />
                        Loading states and error handling
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
        </motion.div>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center mt-12 p-6 bg-base-200 rounded-xl"
        >
          <p className="text-base-content/70 mb-4">
            This enhanced MatchLogTable component provides comprehensive match data visualization
            with advanced filtering, sorting, and analytics for fantasy sports applications.
          </p>
          <div className="flex justify-center gap-4 flex-wrap">
            <div className="badge badge-outline">Advanced Filtering</div>
            <div className="badge badge-outline">Performance Analytics</div>
            <div className="badge badge-outline">Interactive Sorting</div>
            <div className="badge badge-outline">Responsive Design</div>
            <div className="badge badge-outline">TypeScript</div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
