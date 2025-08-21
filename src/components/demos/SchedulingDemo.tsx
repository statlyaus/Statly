'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  CalendarIcon, 
  CodeBracketIcon,
  SparklesIcon,
  TrophyIcon,
  UsersIcon,
  ClockIcon,
  ChartBarIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  PlayIcon,
  AdjustmentsHorizontalIcon
} from '@heroicons/react/24/outline';
import { 
  generateCompleteSchedule,
  validateLeagueSettings,
  previewScheduleRequirements,
  LEAGUE_PRESETS,
  type LeagueSettings,
  type ScheduleResult
} from '@/lib/scheduling';

export default function SchedulingDemo() {
  const [activeTab, setActiveTab] = useState<'overview' | 'features' | 'code'>('overview');
  const [selectedPreset, setSelectedPreset] = useState<keyof typeof LEAGUE_PRESETS>('CLASSIC_8_TEAM');
  const [customSettings, setCustomSettings] = useState<LeagueSettings>(LEAGUE_PRESETS.CLASSIC_8_TEAM.settings);
  const [scheduleResult, setScheduleResult] = useState<ScheduleResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const features = [
    {
      icon: <CalendarIcon className="w-6 h-6" />,
      title: 'Round-Robin Generation',
      description: 'Advanced Circle Method (Berger tables) for balanced team scheduling with odd/even team support'
    },
    {
      icon: <TrophyIcon className="w-6 h-6" />,
      title: 'Playoff Brackets',
      description: 'Flexible playoff systems with reseeding, bye weeks, and multi-week championship legs'
    },
    {
      icon: <UsersIcon className="w-6 h-6" />,
      title: 'Team Management',
      description: 'Support for 4-16 teams with automatic bye week handling for odd team counts'
    },
    {
      icon: <ClockIcon className="w-6 h-6" />,
      title: 'Season Planning',
      description: 'Intelligent week allocation between regular season and playoffs with feasibility validation'
    },
    {
      icon: <ChartBarIcon className="w-6 h-6" />,
      title: 'Schedule Analytics',
      description: 'Comprehensive schedule analysis with match counts, balance metrics, and optimization'
    },
    {
      icon: <AdjustmentsHorizontalIcon className="w-6 h-6" />,
      title: 'Customization',
      description: 'Configurable matchups per opponent, playoff formats, and consolation brackets'
    }
  ];

  const codeExample = `import { 
  generateCompleteSchedule,
  validateLeagueSettings,
  type LeagueSettings
} from '@/lib/scheduling';

// Define league configuration
const settings: LeagueSettings = {
  numTeams: 8,
  seasonWeeks: 16,
  matchupsPerOpponent: 2,
  playoffs: {
    enabled: true,
    teams: 4,
    legLengthWeeks: 1,
    reseedEachRound: false,
    includeConsolation: false
  }
};

// Validate settings
const validation = validateLeagueSettings(settings);
if (!validation.isValid) {
  console.log('Errors:', validation.errors);
  return;
}

// Generate complete schedule
const schedule = generateCompleteSchedule(settings);
if (schedule.success) {
  console.log('Regular season weeks:', schedule.regularSeason.length);
  console.log('Playoff weeks:', schedule.playoffs.length);
  console.log('Total matches:', schedule.summary.totalMatches);
  
  // Access weekly schedules
  schedule.regularSeason.forEach((week, index) => {
    console.log(\`Week \${week.week}:\`, week.matches);
  });
} else {
  console.error('Schedule generation failed:', schedule.error);
}`;

  const handleGenerateSchedule = async () => {
    setIsGenerating(true);
    try {
      // Simulate API call delay for better UX
      await new Promise(resolve => setTimeout(resolve, 1000));
      const result = generateCompleteSchedule(customSettings);
      setScheduleResult(result);
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePresetChange = (preset: keyof typeof LEAGUE_PRESETS) => {
    setSelectedPreset(preset);
    setCustomSettings(LEAGUE_PRESETS[preset].settings);
    setScheduleResult(null);
  };

  const validation = validateLeagueSettings(customSettings);
  const preview = previewScheduleRequirements(customSettings);

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
            <CalendarIcon className="w-4 h-4" />
            League Scheduling System Demo
          </motion.div>
          
          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl font-bold text-base-content mb-4"
          >
            Advanced League Scheduling
          </motion.h1>
          
          <motion.p
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-lg text-base-content/70 max-w-3xl mx-auto"
          >
            Comprehensive scheduling system with round-robin generation, playoff brackets,
            and intelligent season planning for fantasy AFL leagues.
          </motion.p>
        </div>

        {/* Tab Navigation */}
        <div className="flex justify-center mb-8">
          <div className="tabs tabs-boxed bg-base-200 p-1">
            <button
              className={`tab tab-lg gap-2 ${activeTab === 'overview' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              <PlayIcon className="w-4 h-4" />
              Interactive Demo
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
              Implementation
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
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              {/* Configuration Panel */}
              <div className="xl:col-span-1 space-y-6">
                <div className="card bg-base-200 shadow-xl">
                  <div className="card-body">
                    <h2 className="card-title text-xl mb-4 flex items-center gap-2">
                      <AdjustmentsHorizontalIcon className="w-5 h-5 text-primary" />
                      League Configuration
                    </h2>
                    
                    {/* Preset Selection */}
                    <div className="form-control mb-4">
                      <label className="label" htmlFor="preset-select">
                        <span className="label-text font-semibold">League Preset</span>
                      </label>
                      <select 
                        id="preset-select"
                        className="select select-bordered select-sm"
                        value={selectedPreset}
                        onChange={(e) => handlePresetChange(e.target.value as keyof typeof LEAGUE_PRESETS)}
                      >
                        {Object.entries(LEAGUE_PRESETS).map(([key, preset]) => (
                          <option key={key} value={key}>{preset.name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Custom Settings */}
                    <div className="space-y-3">
                      <div className="form-control">
                        <label className="label" htmlFor="teams-input">
                          <span className="label-text">Teams</span>
                        </label>
                        <input 
                          id="teams-input"
                          type="number" 
                          className="input input-bordered input-sm"
                          value={customSettings.numTeams}
                          min="4"
                          max="16"
                          onChange={(e) => setCustomSettings(prev => ({
                            ...prev,
                            numTeams: parseInt(e.target.value)
                          }))}
                        />
                      </div>

                      <div className="form-control">
                        <label className="label" htmlFor="season-weeks-input">
                          <span className="label-text">Season Weeks</span>
                        </label>
                        <input 
                          id="season-weeks-input"
                          type="number" 
                          className="input input-bordered input-sm"
                          value={customSettings.seasonWeeks}
                          min="8"
                          max="30"
                          onChange={(e) => setCustomSettings(prev => ({
                            ...prev,
                            seasonWeeks: parseInt(e.target.value)
                          }))}
                        />
                      </div>

                      <div className="form-control">
                        <label className="label" htmlFor="matchups-select">
                          <span className="label-text">Matchups per Opponent</span>
                        </label>
                        <select 
                          id="matchups-select"
                          className="select select-bordered select-sm"
                          value={customSettings.matchupsPerOpponent}
                          onChange={(e) => setCustomSettings(prev => ({
                            ...prev,
                            matchupsPerOpponent: parseInt(e.target.value) as 1 | 2
                          }))}
                        >
                          <option value={1}>Single Round-Robin</option>
                          <option value={2}>Double Round-Robin</option>
                        </select>
                      </div>

                      {/* Playoff Settings */}
                      <div className="divider">Playoffs</div>
                      
                      <div className="form-control">
                        <label className="cursor-pointer label">
                          <span className="label-text">Enable Playoffs</span>
                          <input 
                            type="checkbox" 
                            className="toggle toggle-primary"
                            checked={customSettings.playoffs?.enabled}
                            onChange={(e) => setCustomSettings(prev => ({
                              ...prev,
                              playoffs: prev.playoffs ? {
                                ...prev.playoffs,
                                enabled: e.target.checked
                              } : undefined
                            }))}
                          />
                        </label>
                      </div>

                      {customSettings.playoffs?.enabled && (
                        <>
                          <div className="form-control">
                            <label className="label" htmlFor="playoff-teams-input">
                              <span className="label-text">Playoff Teams</span>
                            </label>
                            <input 
                              id="playoff-teams-input"
                              type="number" 
                              className="input input-bordered input-sm"
                              value={customSettings.playoffs.teams}
                              min="2"
                              max={customSettings.numTeams}
                              onChange={(e) => setCustomSettings(prev => ({
                                ...prev,
                                playoffs: prev.playoffs ? {
                                  ...prev.playoffs,
                                  teams: parseInt(e.target.value)
                                } : undefined
                              }))}
                            />
                          </div>

                          <div className="form-control">
                            <label className="label" htmlFor="leg-length-select">
                              <span className="label-text">Leg Length (Weeks)</span>
                            </label>
                            <select 
                              id="leg-length-select"
                              className="select select-bordered select-sm"
                              value={customSettings.playoffs.legLengthWeeks}
                              onChange={(e) => setCustomSettings(prev => ({
                                ...prev,
                                playoffs: prev.playoffs ? {
                                  ...prev.playoffs,
                                  legLengthWeeks: parseInt(e.target.value)
                                } : undefined
                              }))}
                            >
                              <option value={1}>Single Week</option>
                              <option value={2}>Two Week Aggregate</option>
                            </select>
                          </div>

                          <div className="form-control">
                            <label className="cursor-pointer label">
                              <span className="label-text">Reseed Each Round</span>
                              <input 
                                type="checkbox" 
                                className="toggle toggle-secondary"
                                checked={customSettings.playoffs.reseedEachRound}
                                onChange={(e) => setCustomSettings(prev => ({
                                  ...prev,
                                  playoffs: prev.playoffs ? {
                                    ...prev.playoffs,
                                    reseedEachRound: e.target.checked
                                  } : undefined
                                }))}
                              />
                            </label>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Generate Button */}
                    <div className="card-actions justify-end mt-6">
                      <button 
                        className={`btn btn-primary gap-2 ${isGenerating ? 'loading' : ''}`}
                        onClick={handleGenerateSchedule}
                        disabled={!validation.isValid || isGenerating}
                      >
                        {isGenerating ? (
                          <>
                            <ArrowPathIcon className="w-4 h-4 animate-spin" />
                            Generating...
                          </>
                        ) : (
                          <>
                            <CalendarIcon className="w-4 h-4" />
                            Generate Schedule
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Validation Status */}
                <div className="card bg-base-200 shadow-lg">
                  <div className="card-body">
                    <h3 className="card-title text-lg mb-4">Schedule Validation</h3>
                    <div className="space-y-3">
                      <div className={`alert ${validation.isValid ? 'alert-success' : 'alert-error'}`}>
                        {validation.isValid ? (
                          <CheckCircleIcon className="w-5 h-5" />
                        ) : (
                          <ExclamationTriangleIcon className="w-5 h-5" />
                        )}
                        <div>
                          <h4 className="font-semibold">
                            {validation.isValid ? 'Configuration Valid' : 'Configuration Issues'}
                          </h4>
                          {!validation.isValid && (
                            <ul className="text-sm list-disc list-inside">
                              {validation.errors.map((error, i) => (
                                <li key={i}>{error}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>

                      {validation.warnings.length > 0 && (
                        <div className="alert alert-warning">
                          <ExclamationTriangleIcon className="w-5 h-5" />
                          <div>
                            <h4 className="font-semibold">Warnings</h4>
                            <ul className="text-sm list-disc list-inside">
                              {validation.warnings.map((warning, i) => (
                                <li key={i}>{warning}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}

                      <div className="stats stats-vertical bg-base-100 shadow">
                        <div className="stat">
                          <div className="stat-title">Total Weeks</div>
                          <div className="stat-value text-lg">{preview.totalWeeks}</div>
                          <div className="stat-desc">
                            {preview.fitsInSeason ? '✅ Fits in season' : '❌ Exceeds season length'}
                          </div>
                        </div>
                        <div className="stat">
                          <div className="stat-title">Weeks Remaining</div>
                          <div className="stat-value text-lg">{preview.weeksRemaining}</div>
                          <div className="stat-desc">Available for other activities</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Results Panel */}
              <div className="xl:col-span-2 space-y-6">
                {scheduleResult ? (
                  <>
                    {/* Schedule Summary */}
                    <div className="card bg-base-200 shadow-xl">
                      <div className="card-body">
                        <h2 className="card-title text-xl mb-4 flex items-center gap-2">
                          <ChartBarIcon className="w-5 h-5 text-success" />
                          Schedule Generated Successfully
                        </h2>
                        
                        <div className="stats stats-horizontal bg-base-100 shadow">
                          <div className="stat">
                            <div className="stat-figure text-primary">
                              <CalendarIcon className="w-8 h-8" />
                            </div>
                            <div className="stat-title">Regular Season</div>
                            <div className="stat-value">{scheduleResult.summary.regularSeasonWeeks}</div>
                            <div className="stat-desc">weeks</div>
                          </div>
                          <div className="stat">
                            <div className="stat-figure text-secondary">
                              <TrophyIcon className="w-8 h-8" />
                            </div>
                            <div className="stat-title">Playoffs</div>
                            <div className="stat-value">{scheduleResult.summary.playoffWeeks}</div>
                            <div className="stat-desc">weeks</div>
                          </div>
                          <div className="stat">
                            <div className="stat-figure text-accent">
                              <UsersIcon className="w-8 h-8" />
                            </div>
                            <div className="stat-title">Total Matches</div>
                            <div className="stat-value">{scheduleResult.summary.totalMatches}</div>
                            <div className="stat-desc">games</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Schedule Preview */}
                    <div className="card bg-base-200 shadow-lg">
                      <div className="card-body">
                        <h3 className="card-title text-lg mb-4">Regular Season Preview</h3>
                        <div className="overflow-x-auto">
                          <table className="table table-sm">
                            <thead>
                              <tr>
                                <th>Week</th>
                                <th>Matches</th>
                                <th>Sample Matchup</th>
                              </tr>
                            </thead>
                            <tbody>
                              {scheduleResult.regularSeason.slice(0, 5).map((week) => (
                                <tr key={week.week}>
                                  <td className="font-semibold">Week {week.week}</td>
                                  <td>{week.matches.length}</td>
                                  <td>
                                    {week.matches[0] ? (
                                      <span className="badge badge-outline">
                                        Team {week.matches[0].homeTeam} vs Team {week.matches[0].awayTeam}
                                      </span>
                                    ) : 'No matches'}
                                  </td>
                                </tr>
                              ))}
                              {scheduleResult.regularSeason.length > 5 && (
                                <tr>
                                  <td colSpan={3} className="text-center text-base-content/60">
                                    ... and {scheduleResult.regularSeason.length - 5} more weeks
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    {/* Playoff Preview */}
                    {scheduleResult.playoffs.length > 0 && (
                      <div className="card bg-base-200 shadow-lg">
                        <div className="card-body">
                          <h3 className="card-title text-lg mb-4">Playoff Bracket Preview</h3>
                          <div className="overflow-x-auto">
                            <table className="table table-sm">
                              <thead>
                                <tr>
                                  <th>Week</th>
                                  <th>Round</th>
                                  <th>Matches</th>
                                </tr>
                              </thead>
                              <tbody>
                                {scheduleResult.playoffs.map((week) => (
                                  <tr key={week.week}>
                                    <td className="font-semibold">Week {week.week}</td>
                                    <td>
                                      <span className="badge badge-primary">
                                        {week.roundName || 'Playoff Round'}
                                      </span>
                                    </td>
                                    <td>{week.matches.length}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="card bg-base-200 shadow-lg">
                    <div className="card-body text-center">
                      <CalendarIcon className="w-16 h-16 text-base-content/30 mx-auto mb-4" />
                      <h3 className="text-lg font-semibold mb-2">Generate a Schedule</h3>
                      <p className="text-base-content/70 mb-4">
                        Configure your league settings and click &quot;Generate Schedule&quot; to see the results.
                      </p>
                      <div className="flex justify-center gap-4">
                        <div className="badge badge-outline">Round-Robin Scheduling</div>
                        <div className="badge badge-outline">Playoff Brackets</div>
                        <div className="badge badge-outline">Balance Optimization</div>
                      </div>
                    </div>
                  </div>
                )}
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
                    Implementation Example
                  </h2>
                  
                  <div className="mockup-code text-sm">
                    <pre data-prefix="1"><code>{codeExample}</code></pre>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="card bg-base-200 shadow-lg">
                  <div className="card-body">
                    <h3 className="card-title mb-4">Core Algorithms</h3>
                    <div className="space-y-2">
                      <div className="badge badge-primary gap-2">
                        <CalendarIcon className="w-3 h-3" />
                        Circle Method (Berger)
                      </div>
                      <div className="badge badge-secondary gap-2">
                        <TrophyIcon className="w-3 h-3" />
                        Bracket Generation
                      </div>
                      <div className="badge badge-accent gap-2">
                        <ChartBarIcon className="w-3 h-3" />
                        Balance Optimization
                      </div>
                      <div className="badge badge-info gap-2">
                        <CheckCircleIcon className="w-3 h-3" />
                        Feasibility Validation
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card bg-base-200 shadow-lg">
                  <div className="card-body">
                    <h3 className="card-title mb-4">API Endpoints</h3>
                    <div className="text-sm space-y-2">
                      <div className="bg-base-100 p-2 rounded">
                        <code className="text-primary">POST /api/scheduling/generate</code>
                        <p className="text-xs text-base-content/60 mt-1">Generate complete schedule</p>
                      </div>
                      <div className="bg-base-100 p-2 rounded">
                        <code className="text-secondary">GET /api/scheduling/presets</code>
                        <p className="text-xs text-base-content/60 mt-1">Get league presets</p>
                      </div>
                    </div>
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
            This comprehensive scheduling system provides enterprise-grade league management
            with advanced algorithms, flexible configuration, and intelligent optimization.
          </p>
          <div className="flex justify-center gap-4 flex-wrap">
            <div className="badge badge-outline">Round-Robin Generation</div>
            <div className="badge badge-outline">Playoff Brackets</div>
            <div className="badge badge-outline">Balance Optimization</div>
            <div className="badge badge-outline">TypeScript</div>
            <div className="badge badge-outline">Real-time Validation</div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
