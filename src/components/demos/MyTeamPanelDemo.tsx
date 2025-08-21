'use client';

import { useState } from 'react';
import MyTeamPanel from '@/components/MyTeamPanel';
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
  UserIcon,
  StarIcon,
  ArrowsUpDownIcon
} from '@heroicons/react/24/outline';

// Mock data for demonstration
const mockTeam = {
  id: 'team-1',
  name: 'Statly Superstars',
  players: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22']
};

const mockPlayers = [
  {
    id: '1',
    name: 'Marcus Bontempelli',
    team: 'Western Bulldogs',
    position: 'MID',
    stats: { aflFantasy: 115 },
    injury: undefined
  },
  {
    id: '2', 
    name: 'Sam Walsh',
    team: 'Carlton',
    position: 'MID',
    stats: { aflFantasy: 108 },
    injury: undefined
  },
  {
    id: '3',
    name: 'Clayton Oliver',
    team: 'Melbourne',
    position: 'MID', 
    stats: { aflFantasy: 112 },
    injury: 'Ankle - Test'
  },
  {
    id: '4',
    name: 'Max Gawn',
    team: 'Melbourne',
    position: 'RUC',
    stats: { aflFantasy: 98 },
    injury: undefined
  },
  {
    id: '5',
    name: 'Jordan Dawson',
    team: 'Adelaide',
    position: 'DEF',
    stats: { aflFantasy: 95 },
    injury: undefined
  },
  {
    id: '6',
    name: 'Charlie Curnow',
    team: 'Carlton',
    position: 'FWD',
    stats: { aflFantasy: 88 },
    injury: undefined
  },
  {
    id: '7',
    name: 'Jack Steele',
    team: 'St Kilda',
    position: 'MID',
    stats: { aflFantasy: 104 },
    injury: undefined
  },
  {
    id: '8',
    name: 'Jeremy Cameron',
    team: 'Geelong',
    position: 'FWD',
    stats: { aflFantasy: 85 },
    injury: undefined
  },
  {
    id: '9',
    name: 'Nick Daicos',
    team: 'Collingwood',
    position: 'DEF',
    stats: { aflFantasy: 92 },
    injury: undefined
  },
  {
    id: '10',
    name: 'Touk Miller',
    team: 'Gold Coast',
    position: 'MID',
    stats: { aflFantasy: 101 },
    injury: undefined
  },
  {
    id: '11',
    name: 'Tom Stewart',
    team: 'Geelong',
    position: 'DEF',
    stats: { aflFantasy: 89 },
    injury: undefined
  },
  {
    id: '12',
    name: 'Brodie Grundy',
    team: 'Sydney',
    position: 'RUC',
    stats: { aflFantasy: 87 },
    injury: undefined
  },
  {
    id: '13',
    name: 'Lachie Neale',
    team: 'Brisbane',
    position: 'MID',
    stats: { aflFantasy: 106 },
    injury: undefined
  },
  {
    id: '14',
    name: 'Jake Lloyd',
    team: 'Sydney',
    position: 'DEF',
    stats: { aflFantasy: 86 },
    injury: 'Hamstring - 2-3 weeks'
  },
  {
    id: '15',
    name: 'Taylor Walker',
    team: 'Adelaide',
    position: 'FWD',
    stats: { aflFantasy: 79 },
    injury: undefined
  },
  {
    id: '16',
    name: 'Christian Petracca',
    team: 'Melbourne',
    position: 'MID',
    stats: { aflFantasy: 109 },
    injury: undefined
  },
  {
    id: '17',
    name: 'Darcy Parish',
    team: 'Essendon',
    position: 'MID',
    stats: { aflFantasy: 97 },
    injury: undefined
  },
  {
    id: '18',
    name: 'Isaac Heeney',
    team: 'Sydney',
    position: 'FWD',
    stats: { aflFantasy: 91 },
    injury: undefined
  },
  {
    id: '19',
    name: 'Zak Butters',
    team: 'Port Adelaide',
    position: 'MID',
    stats: { aflFantasy: 94 },
    injury: undefined
  },
  {
    id: '20',
    name: 'Harris Andrews',
    team: 'Brisbane',
    position: 'DEF',
    stats: { aflFantasy: 84 },
    injury: undefined
  },
  {
    id: '21',
    name: 'Cody Weightman',
    team: 'Western Bulldogs',
    position: 'FWD',
    stats: { aflFantasy: 72 },
    injury: undefined
  },
  {
    id: '22',
    name: 'Caleb Serong',
    team: 'Fremantle',
    position: 'MID',
    stats: { aflFantasy: 99 },
    injury: undefined
  }
];

// Mock rankings data
const mockRankings = new Map(
  mockPlayers.map(player => [
    player.id,
    {
      totalValue: (player.stats?.aflFantasy || 70) * 10000 + Math.random() * 50000,
      rank: Math.floor(Math.random() * 100) + 1
    }
  ])
);

export default function MyTeamPanelDemo() {
  const [activeTab, setActiveTab] = useState<'overview' | 'features' | 'code'>('overview');
  const [demoConfig, setDemoConfig] = useState({
    showAdvancedFeatures: true,
    compact: false,
    sortByValue: true,
    isLoading: false
  });

  const handlePlayerSelect = (player: any) => {
    console.log('Demo: Player selected', player);
  };

  const handleTeamAction = (action: string, player?: any) => {
    console.log('Demo: Team action', action, player);
  };

  const handleRefresh = () => {
    setDemoConfig(prev => ({ ...prev, isLoading: true }));
    setTimeout(() => setDemoConfig(prev => ({ ...prev, isLoading: false })), 2000);
  };

  const codeExample = `'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import MyTeamPanel from '@/components/MyTeamPanel';

interface TeamManagement {
  team: Team;
  players: Player[];
}

const TeamDashboard = () => {
  const [teamData, setTeamData] = useState<TeamManagement>();
  const [isLoading, setIsLoading] = useState(false);

  const handlePlayerSelect = (player: Player) => {
    // Navigate to player details or show modal
    console.log('Selected player:', player);
  };

  const handleTeamAction = (action: string, player?: Player) => {
    switch (action) {
      case 'optimize':
        // Run team optimization algorithm
        break;
      case 'trade':
        // Open trade interface
        break;
      case 'captain':
        // Set player as captain
        break;
      case 'analyze':
        // Show team analysis
        break;
    }
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    // Fetch fresh team data
    await fetchTeamData();
    setIsLoading(false);
  };

  return (
    <MyTeamPanel
      team={teamData?.team}
      players={teamData?.players || []}
      showAdvancedFeatures={true}
      onPlayerSelect={handlePlayerSelect}
      onTeamAction={handleTeamAction}
      onRefresh={handleRefresh}
      isLoading={isLoading}
      className="max-w-md mx-auto"
    />
  );
};`;

  return (
    <div className="min-h-screen bg-base-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4"
          >
            <TrophyIcon className="w-16 h-16 text-primary mx-auto mb-4" />
            <h1 className="text-4xl font-bold text-base-content mb-2">
              MyTeamPanel Component
            </h1>
            <p className="text-xl text-base-content/70">
              Advanced team roster management with comprehensive features
            </p>
          </motion.div>

          {/* Feature Highlights */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mx-auto">
            {[
              { icon: UserIcon, label: 'Team Overview', desc: 'Comprehensive roster display' },
              { icon: ChartBarIcon, label: 'Statistics', desc: 'Team analytics & breakdown' },
              { icon: ArrowsUpDownIcon, label: 'Interactive', desc: 'Sorting & filtering' },
              { icon: SparklesIcon, label: 'Advanced UI', desc: 'Modern design & animations' }
            ].map((feature, index) => (
              <motion.div
                key={feature.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="text-center p-3 rounded-lg bg-base-200/50"
              >
                <feature.icon className="w-8 h-8 text-primary mx-auto mb-2" />
                <h3 className="font-semibold text-sm">{feature.label}</h3>
                <p className="text-xs text-base-content/70">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Demo Tabs */}
        <div className="tabs tabs-boxed justify-center mb-8">
          {[
            { id: 'overview', label: 'Live Demo', icon: EyeIcon },
            { id: 'features', label: 'Features', icon: SparklesIcon },
            { id: 'code', label: 'Implementation', icon: CodeBracketIcon }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`tab gap-2 ${activeTab === tab.id ? 'tab-active' : ''}`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="min-h-[600px]">
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Demo Controls */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <DevicePhoneMobileIcon className="w-5 h-5" />
                  Demo Controls
                </h3>
                
                <div className="space-y-3">
                  <label className="label">
                    <span className="label-text">Show Advanced Features</span>
                    <input
                      type="checkbox"
                      className="toggle toggle-primary"
                      checked={demoConfig.showAdvancedFeatures}
                      onChange={(e) => setDemoConfig(prev => ({ 
                        ...prev, 
                        showAdvancedFeatures: e.target.checked 
                      }))}
                    />
                  </label>

                  <label className="label">
                    <span className="label-text">Compact Mode</span>
                    <input
                      type="checkbox"
                      className="toggle toggle-secondary"
                      checked={demoConfig.compact}
                      onChange={(e) => setDemoConfig(prev => ({ 
                        ...prev, 
                        compact: e.target.checked 
                      }))}
                    />
                  </label>

                  <label className="label">
                    <span className="label-text">Sort by Value</span>
                    <input
                      type="checkbox"
                      className="toggle toggle-accent"
                      checked={demoConfig.sortByValue}
                      onChange={(e) => setDemoConfig(prev => ({ 
                        ...prev, 
                        sortByValue: e.target.checked 
                      }))}
                    />
                  </label>

                  <button 
                    onClick={handleRefresh}
                    className="btn btn-outline btn-sm w-full"
                    disabled={demoConfig.isLoading}
                  >
                    {demoConfig.isLoading ? (
                      <span className="loading loading-spinner loading-xs"></span>
                    ) : (
                      'Trigger Refresh'
                    )}
                  </button>
                </div>

                <div className="alert alert-info">
                  <ShieldCheckIcon className="w-4 h-4" />
                  <span className="text-xs">
                    Interact with the team panel to see live updates and actions in the console.
                  </span>
                </div>
              </div>

              {/* Live Demo */}
              <div className="lg:col-span-2">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <TrophyIcon className="w-5 h-5" />
                  Live Interactive Demo
                </h3>
                
                <div className="max-w-md mx-auto">
                  <MyTeamPanel
                    team={mockTeam}
                    players={mockPlayers}
                    sortByValue={demoConfig.sortByValue}
                    showAdvancedFeatures={demoConfig.showAdvancedFeatures}
                    compact={demoConfig.compact}
                    onPlayerSelect={handlePlayerSelect}
                    onTeamAction={handleTeamAction}
                    onRefresh={handleRefresh}
                    isLoading={demoConfig.isLoading}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'features' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {[
                {
                  category: 'Team Management',
                  icon: UserIcon,
                  features: [
                    'Complete roster display with 22+ players',
                    'Real-time team statistics and value tracking',
                    'Position breakdown and roster completion status',
                    'Captain and vice-captain status indicators',
                    'Injury status monitoring and alerts'
                  ]
                },
                {
                  category: 'Interactive Features',
                  icon: ArrowsUpDownIcon,
                  features: [
                    'Advanced search and filtering capabilities',
                    'Multi-field sorting (name, position, value, performance)',
                    'Player selection and action callbacks',
                    'Expandable team statistics panel',
                    'Responsive design with mobile optimization'
                  ]
                },
                {
                  category: 'Data Integration',
                  icon: ChartBarIcon,
                  features: [
                    'Real-time rankings and value updates',
                    'Performance indicators and trend analysis',
                    'Integration with fantasy scoring systems',
                    'Customizable team metrics and calculations',
                    'Automated refresh and data synchronization'
                  ]
                },
                {
                  category: 'User Experience',
                  icon: SparklesIcon,
                  features: [
                    'Smooth animations with Framer Motion',
                    'Modern DaisyUI component styling',
                    'Accessibility-compliant design (WCAG)',
                    'Loading states and error handling',
                    'Customizable themes and compact modes'
                  ]
                }
              ].map((section, index) => (
                <motion.div
                  key={section.category}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="card bg-base-200"
                >
                  <div className="card-body">
                    <h3 className="card-title text-lg flex items-center gap-2">
                      <section.icon className="w-5 h-5 text-primary" />
                      {section.category}
                    </h3>
                    <ul className="space-y-2">
                      {section.features.map((feature, featureIndex) => (
                        <li key={featureIndex} className="flex items-start gap-2 text-sm">
                          <FireIcon className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {activeTab === 'code' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <CodeBracketIcon className="w-5 h-5" />
                  Implementation Example
                </h3>
                <div className="text-sm text-base-content/70">
                  TypeScript + React + Framer Motion
                </div>
              </div>

              <div className="mockup-code">
                <pre><code className="text-sm">{codeExample}</code></pre>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="card bg-base-200">
                  <div className="card-body">
                    <h4 className="card-title text-base">Key Props</h4>
                    <ul className="text-sm space-y-1">
                      <li><code className="bg-base-300 px-1 rounded">team</code> - Team data object</li>
                      <li><code className="bg-base-300 px-1 rounded">players</code> - Array of player objects</li>
                      <li><code className="bg-base-300 px-1 rounded">onPlayerSelect</code> - Player selection callback</li>
                      <li><code className="bg-base-300 px-1 rounded">onTeamAction</code> - Team action callback</li>
                      <li><code className="bg-base-300 px-1 rounded">showAdvancedFeatures</code> - Enable advanced UI</li>
                    </ul>
                  </div>
                </div>

                <div className="card bg-base-200">
                  <div className="card-body">
                    <h4 className="card-title text-base">Dependencies</h4>
                    <ul className="text-sm space-y-1">
                      <li><code className="bg-base-300 px-1 rounded">framer-motion</code> - Animations</li>
                      <li><code className="bg-base-300 px-1 rounded">@heroicons/react</code> - Icons</li>
                      <li><code className="bg-base-300 px-1 rounded">daisyui</code> - UI components</li>
                      <li><code className="bg-base-300 px-1 rounded">tailwindcss</code> - Styling</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
