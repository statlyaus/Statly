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
  const [_selectedPreset, setSelectedPreset] = useState<keyof typeof LEAGUE_PRESETS>('CLASSIC_8_TEAM');
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

  const _handlePresetChange = (preset: keyof typeof LEAGUE_PRESETS) => {
    setSelectedPreset(preset);
    setCustomSettings(LEAGUE_PRESETS[preset].settings);
    setScheduleResult(null);
  };

  const validation = validateLeagueSettings(customSettings);
  const _preview = previewScheduleRequirements(customSettings);

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
            <div className="max-w-3xl mx-auto">
              {/* Simple Question Flow */}
              <div className="space-y-8">
                {/* Step 1: How many teams? */}
                <div className="card bg-base-200 shadow-xl">
                  <div className="card-body text-center">
                    <h2 className="text-2xl font-bold mb-4">How many teams in your league?</h2>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                      {[6, 8, 10, 12].map((teamCount) => (
                        <button
                          key={teamCount}
                          className={`btn btn-lg ${customSettings.numTeams === teamCount ? 'btn-primary' : 'btn-outline'}`}
                          onClick={() => {
                            // Auto-select appropriate preset
                            let preset: keyof typeof LEAGUE_PRESETS = 'CLASSIC_8_TEAM';
                            if (teamCount === 10) preset = 'STANDARD_10_TEAM';
                            if (teamCount === 12) preset = 'LARGE_12_TEAM';
                            if (teamCount === 6) preset = 'CLASSIC_8_TEAM'; // Use 8-team as base for 6
                            
                            setSelectedPreset(preset);
                            setCustomSettings({
                              ...LEAGUE_PRESETS[preset].settings,
                              numTeams: teamCount
                            });
                            setScheduleResult(null);
                          }}
                        >
                          <div>
                            <div className="text-2xl">{teamCount}</div>
                            <div className="text-xs">teams</div>
                          </div>
                        </button>
                      ))}
                    </div>
                    
                    <p className="text-sm text-base-content/60">
                      Most common league sizes. Don&apos;t see yours? 
                      <button className="link link-primary ml-1" onClick={() => {
                        const teams = prompt('How many teams?', customSettings.numTeams.toString());
                        if (teams && !isNaN(parseInt(teams))) {
                          setCustomSettings(prev => ({ ...prev, numTeams: parseInt(teams) }));
                        }
                      }}>
                        Enter custom number
                      </button>
                    </p>
                  </div>
                </div>

                {/* Step 2: Season Length */}
                <div className="card bg-base-200 shadow-xl">
                  <div className="card-body text-center">
                    <h2 className="text-2xl font-bold mb-4">How long is your AFL season?</h2>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                      {[
                        { weeks: 14, label: 'Regular Season Only', desc: '14 AFL rounds' },
                        { weeks: 18, label: 'Including Finals', desc: '14 rounds + 4 finals' },
                        { weeks: 23, label: 'Full Season', desc: '23 AFL rounds' }
                      ].map((option) => (
                        <button
                          key={option.weeks}
                          className={`card bg-base-100 shadow-lg hover:shadow-xl transition-all cursor-pointer border-2 ${
                            customSettings.seasonWeeks === option.weeks ? 'border-primary' : 'border-transparent'
                          }`}
                          onClick={() => setCustomSettings(prev => ({ ...prev, seasonWeeks: option.weeks }))}
                        >
                          <div className="card-body text-center p-4">
                            <h3 className="font-bold text-lg">{option.label}</h3>
                            <p className="text-2xl font-bold text-primary">{option.weeks}</p>
                            <p className="text-sm text-base-content/70">{option.desc}</p>
                            {customSettings.seasonWeeks === option.weeks && (
                              <div className="badge badge-primary mt-2">Selected</div>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Step 3: Finals */}
                <div className="card bg-base-200 shadow-xl">
                  <div className="card-body text-center">
                    <h2 className="text-2xl font-bold mb-4">Do you want finals?</h2>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      <button
                        className={`card bg-base-100 shadow-lg hover:shadow-xl transition-all cursor-pointer border-2 ${
                          !customSettings.playoffs?.enabled ? 'border-primary' : 'border-transparent'
                        }`}
                        aria-pressed={!customSettings.playoffs?.enabled}
                        onClick={() => setCustomSettings(prev => ({
                          ...prev,
                          playoffs: {
                            enabled: false,
                            teams: prev.playoffs?.teams || 4,
                            legLengthWeeks: prev.playoffs?.legLengthWeeks || 1,
                            reseedEachRound: prev.playoffs?.reseedEachRound || false,
                            includeConsolation: prev.playoffs?.includeConsolation || false
                          },
                          // Clear any existing schedule results when changing playoff settings
                          ...(setScheduleResult(null), {})
                        }))}
                      >
                        <div className="card-body text-center p-6">
                          <div className="text-4xl mb-2">📊</div>
                          <h3 className="font-bold text-lg">Regular Season Only</h3>
                          <p className="text-sm text-base-content/70">
                            Best overall record wins the league
                          </p>
                          {!customSettings.playoffs?.enabled && (
                            <div className="badge badge-primary mt-3">Selected</div>
                          )}
                        </div>
                      </button>

                      <button
                        className={`card bg-base-100 shadow-lg hover:shadow-xl transition-all cursor-pointer border-2 ${
                          customSettings.playoffs?.enabled ? 'border-primary' : 'border-transparent'
                        }`}
                        aria-pressed={customSettings.playoffs?.enabled ? true : false}
                        onClick={() => {
                          setCustomSettings(prev => ({
                            ...prev,
                            playoffs: {
                              enabled: true,
                              teams: Math.min(4, Math.floor(prev.numTeams / 2)),
                              legLengthWeeks: prev.playoffs?.legLengthWeeks || 1,
                              reseedEachRound: prev.playoffs?.reseedEachRound || false,
                              includeConsolation: prev.playoffs?.includeConsolation || false
                            }
                          }));
                          // Clear any existing schedule results when changing playoff settings
                          setScheduleResult(null);
                        }}
                      >
                        <div className="card-body text-center p-6">
                          <div className="text-4xl mb-2">🏆</div>
                          <h3 className="font-bold text-lg">Include Finals</h3>
                          <p className="text-sm text-base-content/70">
                            Top teams compete for championship
                          </p>
                          {customSettings.playoffs?.enabled && (
                            <div className="badge badge-primary mt-3">Selected</div>
                          )}
                        </div>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Generate Button */}
                <div className="text-center">
                  <button 
                    className={`btn btn-primary btn-lg gap-3 px-12 ${isGenerating ? 'loading' : ''}`}
                    onClick={handleGenerateSchedule}
                    disabled={!validation.isValid || isGenerating}
                  >
                    {isGenerating ? (
                      <>
                        <ArrowPathIcon className="w-6 h-6 animate-spin" />
                        Creating Schedule...
                      </>
                    ) : (
                      <>
                        <CalendarIcon className="w-6 h-6" />
                        Create My Schedule
                      </>
                    )}
                  </button>
                  
                  {validation.isValid && (
                    <p className="text-sm text-base-content/60 mt-3">
                      {customSettings.numTeams} teams • {customSettings.seasonWeeks} weeks • {customSettings.playoffs?.enabled ? 'With finals' : 'No finals'}
                    </p>
                  )}
                </div>
              </div>

              {/* Results Section */}
              {scheduleResult ? (
                scheduleResult.success ? (
                  <div className="space-y-6">
                    {/* Success Header */}
                    <div className="text-center">
                      <div className="text-6xl mb-4">🎉</div>
                      <h2 className="text-3xl font-bold text-success mb-2">Schedule Created!</h2>
                      <p className="text-lg text-base-content/70">
                        Your {customSettings.numTeams}-team league is ready to go
                      </p>
                    </div>

                    {/* Key Stats */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="stat bg-base-100 rounded-xl shadow-lg text-center">
                        <div className="stat-value text-primary text-2xl">{scheduleResult.summary.regularSeasonWeeks}</div>
                        <div className="stat-title">Regular Weeks</div>
                      </div>
                      <div className="stat bg-base-100 rounded-xl shadow-lg text-center">
                        <div className="stat-value text-secondary text-2xl">{scheduleResult.summary.playoffWeeks}</div>
                        <div className="stat-title">Finals Weeks</div>
                      </div>
                      <div className="stat bg-base-100 rounded-xl shadow-lg text-center">
                        <div className="stat-value text-accent text-2xl">{scheduleResult.summary.totalMatches}</div>
                        <div className="stat-title">Total Games</div>
                      </div>
                    </div>

                    {/* Schedule Preview */}
                    <div className="card bg-base-100 shadow-lg">
                      <div className="card-body">
                        <h3 className="card-title justify-center mb-4">📅 Schedule Preview</h3>
                        <div className="overflow-x-auto">
                          <table className="table table-zebra">
                            <thead>
                              <tr>
                                <th>Week</th>
                                <th>Phase</th>
                                <th>Games</th>
                                <th>Example</th>
                              </tr>
                            </thead>
                            <tbody>
                              {/* Regular Season Sample */}
                              {scheduleResult.regularSeason.slice(0, 3).map((week) => (
                                <tr key={`reg-${week.week}`}>
                                  <td className="font-semibold">Week {week.week}</td>
                                  <td><span className="badge badge-primary badge-sm">Regular</span></td>
                                  <td>{week.matches.length}</td>
                                  <td className="text-sm">
                                    {week.matches[0] ? (
                                      <>Team {week.matches[0].homeTeam} vs {week.matches[0].awayTeam}</>
                                    ) : (
                                      <span className="text-base-content/60">Bye week</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                              {scheduleResult.regularSeason.length > 3 && (
                                <tr>
                                  <td colSpan={4} className="text-center text-base-content/60 italic">
                                    ... {scheduleResult.regularSeason.length - 3} more regular season weeks
                                  </td>
                                </tr>
                              )}
                              {/* Playoffs Sample */}
                              {scheduleResult.playoffs.slice(0, 2).map((week) => (
                                <tr key={`playoff-${week.week}`}>
                                  <td className="font-semibold">Week {week.week}</td>
                                  <td><span className="badge badge-secondary badge-sm">Finals</span></td>
                                  <td>{week.matches.length}</td>
                                  <td className="text-sm">{week.roundName || 'Finals Round'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-4 justify-center">
                      <button className="btn btn-primary btn-lg gap-2">
                        <CalendarIcon className="w-5 h-5" />
                        Download Schedule
                      </button>
                      <button 
                        className="btn btn-outline btn-lg gap-2"
                        onClick={() => setScheduleResult(null)}
                      >
                        <AdjustmentsHorizontalIcon className="w-5 h-5" />
                        Create Another
                      </button>
                    </div>
                  </div>
                ) : (
                  // Render a clear error card when schedule generation failed
                  <div className="card bg-base-200 shadow-lg">
                    <div className="card-body text-center">
                      <h2 className="text-2xl font-bold text-error mb-2">Could not create schedule</h2>
                      <p className="text-base-content/70 mb-4">{scheduleResult.error || 'An unknown error occurred while generating the schedule.'}</p>

                      <div className="flex justify-center gap-4">
                        <button
                          className="btn btn-primary"
                          onClick={() => {
                            // Retry generation with current settings
                            handleGenerateSchedule();
                          }}
                        >
                          Retry
                        </button>

                        <button
                          className="btn btn-outline"
                          onClick={() => setScheduleResult(null)}
                        >
                          Create Another
                        </button>
                      </div>

                      {/* Optional: show debug details in collapsible area */}
                      {scheduleResult.errorDetails && (
                        <details className="mt-4 text-left p-3 bg-base-100 rounded">
                          <summary className="cursor-pointer">Details</summary>
                          <pre className="text-xs mt-2 whitespace-pre-wrap">{String(scheduleResult.errorDetails)}</pre>
                        </details>
                      )}
                    </div>
                  </div>
                )
              ) : (
                <div className="text-center py-16">
                  <CalendarIcon className="w-20 h-20 text-base-content/20 mx-auto mb-6" />
                  <h3 className="text-xl font-semibold mb-3">Choose Your Format</h3>
                  <p className="text-base-content/60 max-w-md mx-auto">
                    Pick a league format above and click Generate to create your schedule
                  </p>
                </div>
              )}
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
