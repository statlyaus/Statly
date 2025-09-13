'use client';

import { useState } from 'react';

import {
  CogIcon,
  CodeBracketIcon,
  EyeIcon,
  DocumentTextIcon,
  PlayIcon,
  StarIcon,
  UserGroupIcon,
  TrophyIcon,
  ChartBarIcon,
} from '@heroicons/react/24/outline';
import { motion } from 'framer-motion';

import MyTeamPanel from '../MyTeamPanel';

import type { Player, Team } from '../../types/players';

// Mock data
const mockPlayers: Player[] = [
  { id: '1', name: 'Marcus Bontempelli', position: 'MID', team: 'WBD' },
  { id: '2', name: 'Clayton Oliver', position: 'MID', team: 'MEL' },
  { id: '3', name: 'Lachie Neale', position: 'MID', team: 'BL' },
  { id: '4', name: 'Jeremy Cameron', position: 'FWD', team: 'GEE' },
  { id: '5', name: 'Max Gawn', position: 'RUC', team: 'MEL' },
  { id: '6', name: 'Tom Stewart', position: 'DEF', team: 'GEE' },
  { id: '7', name: 'Touk Miller', position: 'MID', team: 'GC' },
  { id: '8', name: 'Christian Petracca', position: 'MID', team: 'MEL', injury: 'Knee - 2-3 weeks' },
  { id: '9', name: 'Brodie Grundy', position: 'RUC', team: 'SYD' },
  { id: '10', name: 'Sam Docherty', position: 'DEF', team: 'CAR' },
  { id: '11', name: 'Zach Merrett', position: 'MID', team: 'ESS' },
  { id: '12', name: 'Charlie Curnow', position: 'FWD', team: 'CAR' },
  { id: '13', name: 'Jake Lloyd', position: 'DEF', team: 'SYD' },
  { id: '14', name: 'Josh Dunkley', position: 'MID', team: 'BL' },
  { id: '15', name: 'Tom Green', position: 'MID', team: 'GWS' },
  { id: '16', name: 'Jesse Hogan', position: 'FWD', team: 'GWS' },
  { id: '17', name: 'Jack Sinclair', position: 'DEF', team: 'STK' },
  { id: '18', name: 'Callum Mills', position: 'DEF', team: 'SYD' },
  { id: '19', name: 'Tim Taranto', position: 'MID', team: 'RIC' },
  { id: '20', name: 'Jordan De Goey', position: 'FWD', team: 'COL' },
  { id: '21', name: 'Nick Daicos', position: 'MID', team: 'COL' },
  { id: '22', name: 'Darcy Cameron', position: 'RUC', team: 'COL' },
];

const mockTeam: Team = {
  id: '1',
  name: 'Championship Chasers',
  players: [
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    '10',
    '11',
    '12',
    '13',
    '14',
    '15',
    '16',
    '17',
    '18',
    '19',
    '20',
    '21',
    '22',
  ],
};

type DemoConfig = {
  showAdvancedFeatures: boolean;
  compact: boolean;
  sortByValue: boolean;
  maxHeight: string;
  isLoading: boolean;
};

const MyTeamPanelDemo = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'features' | 'config' | 'code'>(
    'overview'
  );
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [lastAction, setLastAction] = useState<string>('');

  const [config, setConfig] = useState<DemoConfig>({
    showAdvancedFeatures: true,
    compact: false,
    sortByValue: true,
    maxHeight: '500px',
    isLoading: false,
  });

  const handlePlayerSelect = (player: Player) => {
    setSelectedPlayer(player);
    setLastAction(`Selected player: ${player.name}`);
  };

  const handleTeamAction = (action: string, player?: Player) => {
    const actionText = player ? `${action} action for ${player.name}` : `${action} action`;
    setLastAction(actionText);
  };

  const handleRefresh = () => {
    setConfig((prev) => ({ ...prev, isLoading: true }));
    setTimeout(() => {
      setConfig((prev) => ({ ...prev, isLoading: false }));
      setLastAction('Team data refreshed');
    }, 2000);
  };

  const codeExample = `import MyTeamPanel from '@/components/MyTeamPanel';
import type { Player, Team } from '@/types/players';

const MyComponent = () => {
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  
  const handlePlayerSelect = (player: Player) => {
    setSelectedPlayer(player);
    // Handle player selection
  };

  const handleTeamAction = (action: string, player?: Player) => {
    switch (action) {
      case 'optimize':
        // Optimize team lineup
        break;
      case 'trade':
        // Open trade interface
        break;
      case 'captain':
        // Set player as captain
        break;
      // Handle other actions...
    }
  };

  return (
    <MyTeamPanel
      team={team}
      players={players}
      onPlayerSelect={handlePlayerSelect}
      onTeamAction={handleTeamAction}
      showAdvancedFeatures={true}
      sortByValue={true}
      maxHeight="600px"
    />
  );
};`;

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="text-center space-y-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-center gap-3"
        >
          <TrophyIcon className="w-8 h-8 text-primary" />
          <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            MyTeamPanel Demo
          </h1>
        </motion.div>

        <p className="text-lg text-base-content/70 max-w-3xl mx-auto">
          A comprehensive fantasy sports team management component with advanced features,
          statistics, player interactions, and modern UI design.
        </p>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
          <div className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-primary">
              <UserGroupIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Players</div>
            <div className="stat-value text-primary">22</div>
            <div className="stat-desc">Full roster</div>
          </div>

          <div className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-secondary">
              <ChartBarIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Total Value</div>
            <div className="stat-value text-secondary">$13.1M</div>
            <div className="stat-desc">Average: $595K</div>
          </div>

          <div className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-accent">
              <StarIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Features</div>
            <div className="stat-value text-accent">15+</div>
            <div className="stat-desc">Advanced tools</div>
          </div>

          <div className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-success">
              <PlayIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Interactive</div>
            <div className="stat-value text-success">100%</div>
            <div className="stat-desc">Fully responsive</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs tabs-boxed justify-center">
        <button
          className={`tab gap-2 ${activeTab === 'overview' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <EyeIcon className="w-4 h-4" />
          Live Demo
        </button>
        <button
          className={`tab gap-2 ${activeTab === 'features' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('features')}
        >
          <DocumentTextIcon className="w-4 h-4" />
          Features
        </button>
        <button
          className={`tab gap-2 ${activeTab === 'config' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('config')}
        >
          <CogIcon className="w-4 h-4" />
          Configuration
        </button>
        <button
          className={`tab gap-2 ${activeTab === 'code' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('code')}
        >
          <CodeBracketIcon className="w-4 h-4" />
          Code
        </button>
      </div>

      {/* Tab Content */}
      <div className="min-h-[600px]">
        {activeTab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-6"
          >
            {/* Main Component */}
            <div className="lg:col-span-2">
              <div className="bg-base-100 rounded-xl border border-base-300 p-1">
                <MyTeamPanel
                  team={mockTeam}
                  players={mockPlayers}
                  onPlayerSelect={handlePlayerSelect}
                  onTeamAction={handleTeamAction}
                  onRefresh={handleRefresh}
                  showAdvancedFeatures={config.showAdvancedFeatures}
                  compact={config.compact}
                  sortByValue={config.sortByValue}
                  maxHeight={config.maxHeight}
                  isLoading={config.isLoading}
                />
              </div>
            </div>

            {/* Info Panel */}
            <div className="space-y-4">
              {/* Selected Player */}
              <div className="bg-base-100 rounded-xl border border-base-300 p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <StarIcon className="w-5 h-5 text-primary" />
                  Selected Player
                </h3>
                {selectedPlayer ? (
                  <div className="space-y-2">
                    <div className="font-medium">{selectedPlayer.name}</div>
                    <div className="text-sm text-base-content/70">
                      {selectedPlayer.position} • {selectedPlayer.team}
                    </div>
                    {selectedPlayer.injury && (
                      <div className="alert alert-error p-2 text-xs">
                        <span>{selectedPlayer.injury}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-base-content/50 text-sm">Click on a player to see details</p>
                )}
              </div>

              {/* Last Action */}
              <div className="bg-base-100 rounded-xl border border-base-300 p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <PlayIcon className="w-5 h-5 text-secondary" />
                  Last Action
                </h3>
                <p className="text-sm text-base-content/70">
                  {lastAction || 'No actions performed yet'}
                </p>
              </div>

              {/* Quick Controls */}
              <div className="bg-base-100 rounded-xl border border-base-300 p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <CogIcon className="w-5 h-5 text-accent" />
                  Quick Controls
                </h3>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={config.showAdvancedFeatures}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          showAdvancedFeatures: e.target.checked,
                        }))
                      }
                    />
                    <span className="text-sm">Advanced Features</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={config.compact}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          compact: e.target.checked,
                        }))
                      }
                    />
                    <span className="text-sm">Compact Mode</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={config.sortByValue}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          sortByValue: e.target.checked,
                        }))
                      }
                    />
                    <span className="text-sm">Sort by Value</span>
                  </label>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'features' && (
          <motion.div
            key="features"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {[
              {
                icon: UserGroupIcon,
                title: 'Team Management',
                description:
                  'Complete roster management with player statistics and team composition analytics.',
                features: [
                  '22-player roster',
                  'Position tracking',
                  'Team statistics',
                  'Value calculations',
                ],
              },
              {
                icon: StarIcon,
                title: 'Captain System',
                description:
                  'Set captains and vice-captains with visual indicators and status tracking.',
                features: [
                  'Captain selection',
                  'Vice-captain support',
                  'Leadership indicators',
                  'Status validation',
                ],
              },
              {
                icon: ChartBarIcon,
                title: 'Advanced Analytics',
                description:
                  'Comprehensive team statistics with position breakdowns and performance metrics.',
                features: [
                  'Position breakdown',
                  'Value analytics',
                  'Performance tracking',
                  'Roster completion',
                ],
              },
              {
                icon: TrophyIcon,
                title: 'Interactive Actions',
                description: 'Full suite of team management actions with context-aware controls.',
                features: [
                  'Player selection',
                  'Team optimization',
                  'Trade interface',
                  'Bench management',
                ],
              },
              {
                icon: CogIcon,
                title: 'Customizable Interface',
                description:
                  'Flexible configuration options for different use cases and display preferences.',
                features: [
                  'Compact mode',
                  'Height control',
                  'Feature toggles',
                  'Responsive design',
                ],
              },
              {
                icon: PlayIcon,
                title: 'Real-time Updates',
                description: 'Live data integration with loading states and refresh capabilities.',
                features: ['Live updates', 'Loading states', 'Error handling', 'Data refresh'],
              },
            ].map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="bg-base-100 rounded-xl border border-base-300 p-6 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-center gap-3 mb-4">
                  <feature.icon className="w-8 h-8 text-primary" />
                  <h3 className="font-bold text-lg">{feature.title}</h3>
                </div>
                <p className="text-base-content/70 mb-4">{feature.description}</p>
                <ul className="space-y-1">
                  {feature.features.map((item, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <div className="w-1.5 h-1.5 bg-primary rounded-full"></div>
                      {item}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </motion.div>
        )}

        {activeTab === 'config' && (
          <motion.div
            key="config"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="max-w-4xl mx-auto space-y-6"
          >
            <div className="bg-base-100 rounded-xl border border-base-300 p-6">
              <h3 className="text-xl font-bold mb-6">Component Configuration</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h4 className="font-semibold">Display Options</h4>

                  <div className="form-control">
                    <label className="label cursor-pointer">
                      <span className="label-text">Show Advanced Features</span>
                      <input
                        type="checkbox"
                        className="toggle toggle-primary"
                        checked={config.showAdvancedFeatures}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            showAdvancedFeatures: e.target.checked,
                          }))
                        }
                      />
                    </label>
                  </div>

                  <div className="form-control">
                    <label className="label cursor-pointer">
                      <span className="label-text">Compact Mode</span>
                      <input
                        type="checkbox"
                        className="toggle toggle-secondary"
                        checked={config.compact}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            compact: e.target.checked,
                          }))
                        }
                      />
                    </label>
                  </div>

                  <div className="form-control">
                    <label className="label cursor-pointer">
                      <span className="label-text">Sort by Value</span>
                      <input
                        type="checkbox"
                        className="toggle toggle-accent"
                        checked={config.sortByValue}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            sortByValue: e.target.checked,
                          }))
                        }
                      />
                    </label>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="font-semibold">Layout Options</h4>

                  <div className="form-control">
                    <label className="label" htmlFor="max-height-select">
                      <span className="label-text">Maximum Height</span>
                    </label>
                    <select
                      id="max-height-select"
                      className="select select-bordered"
                      value={config.maxHeight}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          maxHeight: e.target.value,
                        }))
                      }
                    >
                      <option value="400px">400px</option>
                      <option value="500px">500px</option>
                      <option value="600px">600px</option>
                      <option value="800px">800px</option>
                      <option value="none">No limit</option>
                    </select>
                  </div>

                  <div className="form-control">
                    <label className="label cursor-pointer">
                      <span className="label-text">Loading State</span>
                      <input
                        type="checkbox"
                        className="toggle toggle-warning"
                        checked={config.isLoading}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            isLoading: e.target.checked,
                          }))
                        }
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="mt-6 p-4 bg-base-200 rounded-lg">
                <h4 className="font-semibold mb-2">Current Configuration:</h4>
                <pre className="text-xs overflow-x-auto">{JSON.stringify(config, null, 2)}</pre>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'code' && (
          <motion.div
            key="code"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-6"
          >
            <div className="bg-base-100 rounded-xl border border-base-300 p-6">
              <h3 className="text-xl font-bold mb-4">Implementation Example</h3>
              <div className="mockup-code">
                <pre className="text-sm">{codeExample}</pre>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-base-100 rounded-xl border border-base-300 p-6">
                <h4 className="font-semibold mb-3">Props Interface</h4>
                <div className="text-sm space-y-2">
                  <div>
                    <code className="text-primary">team</code>: Team object
                  </div>
                  <div>
                    <code className="text-primary">players</code>: Player array
                  </div>
                  <div>
                    <code className="text-primary">onPlayerSelect</code>: Selection callback
                  </div>
                  <div>
                    <code className="text-primary">onTeamAction</code>: Action callback
                  </div>
                  <div>
                    <code className="text-primary">showAdvancedFeatures</code>: Boolean
                  </div>
                  <div>
                    <code className="text-primary">compact</code>: Boolean
                  </div>
                  <div>
                    <code className="text-primary">sortByValue</code>: Boolean
                  </div>
                  <div>
                    <code className="text-primary">maxHeight</code>: String
                  </div>
                  <div>
                    <code className="text-primary">isLoading</code>: Boolean
                  </div>
                </div>
              </div>

              <div className="bg-base-100 rounded-xl border border-base-300 p-6">
                <h4 className="font-semibold mb-3">Key Features</h4>
                <ul className="text-sm space-y-1">
                  <li>• Advanced filtering and sorting</li>
                  <li>• Real-time search functionality</li>
                  <li>• Captain/vice-captain management</li>
                  <li>• Team statistics calculation</li>
                  <li>• Interactive player actions</li>
                  <li>• Responsive design</li>
                  <li>• Loading and error states</li>
                  <li>• Accessibility support</li>
                </ul>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default MyTeamPanelDemo;
