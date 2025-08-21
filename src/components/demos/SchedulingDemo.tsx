'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  CalendarIcon, 
  CodeBracketIcon,
  SparklesIcon,
  CheckCircleIcon,
  ArrowPathIcon,
  PlayIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { 
  generateCompleteSchedule,
  validateLeagueSettings,
  LEAGUE_PRESETS,
  type LeagueSettings as NewLeagueSettings,
  type ScheduleResult as SchedulingResult
} from '@/lib/scheduling';
import { generateScheduleViaApi } from '@/lib/schedulingClient';

// Create explicit type alias to avoid conflicts with legacy scheduling types
type ComponentScheduleResult = SchedulingResult;
type ComponentLeagueSettings = NewLeagueSettings;

export default function SchedulingDemo() {
  const [activeTab, setActiveTab] = useState<'overview' | 'features' | 'code'>('overview');
  const [_selectedPreset, setSelectedPreset] = useState<keyof typeof LEAGUE_PRESETS>('CLASSIC_8_TEAM');
  const [customSettings, setCustomSettings] = useState<ComponentLeagueSettings>(LEAGUE_PRESETS.CLASSIC_8_TEAM.settings);
  const [scheduleResult, setScheduleResult] = useState<ComponentScheduleResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Professional metadata for a league manager
  const [leagueName, setLeagueName] = useState('My League');
  const [seasonStart, setSeasonStart] = useState('');

  // Professional scheduling options (single state object to avoid desync)
  // matchupsPerOpponent remains on customSettings (single source of truth)
  type ProfessionalScheduling = {
    primeTimeSlots: { friday: boolean; saturday: boolean; sunday: boolean };
    broadcastPreferred: boolean;
    byePolicy: 'spread' | 'cluster';
    rivalryRounds: number;
    homeAwayPreference: 'balanced' | 'asymmetric';
  };

  const [professionalScheduling, setProfessionalScheduling] = useState<ProfessionalScheduling>({
    primeTimeSlots: { friday: true, saturday: true, sunday: true },
    broadcastPreferred: false,
    byePolicy: 'spread',
    rivalryRounds: 2,
    homeAwayPreference: 'balanced',
  });

  // Keep matchupsPerOpponent in sync with the scheduling settings used by generator
  const updateMatchups = (value: 1 | 2) => {
    // write-through to customSettings (single source of truth)
    setCustomSettings((prev: ComponentLeagueSettings) => ({ ...prev, matchupsPerOpponent: value }));
    setScheduleResult(null);
  };

  // AFL-themed micro-illustrations as SVG components
  const AFLFixtureIcon = () => (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12h8M12 8v8" />
      <path d="M16 8l-8 8M8 8l8 8" strokeWidth={0.8} opacity={0.6} />
    </svg>
  );

  const AFLTrophyIcon = () => (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M6 9h12v6a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V9Z" />
      <path d="M9 21v-4h6v4M12 3v3" />
      <circle cx="12" cy="6" r="1" fill="currentColor" />
    </svg>
  );

  const AFLJerseyIcon = () => (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M8 4v2a2 2 0 0 1-2 2H4v10h2a2 2 0 0 1 2 2v2h8v-2a2 2 0 0 1 2-2h2V8h-2a2 2 0 0 1-2-2V4H8Z" />
      <path d="M8 8h8M8 12h8" strokeWidth={1} opacity={0.6} />
      <circle cx="10" cy="10" r="0.5" fill="currentColor" />
      <circle cx="14" cy="10" r="0.5" fill="currentColor" />
    </svg>
  );

  const AFLStadiumIcon = () => (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <ellipse cx="12" cy="16" rx="10" ry="6" />
      <ellipse cx="12" cy="16" rx="6" ry="3" opacity={0.6} />
      <path d="M2 10l3-3M22 10l-3-3M5 7l2-2M19 7l-2-2" strokeWidth={1} />
      <path d="M8 4h8M9 2h6" strokeWidth={1} opacity={0.5} />
    </svg>
  );

  const AFLLadderIcon = () => (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />
      <path d="M2 6v12M22 6v12" strokeWidth={2} />
      <circle cx="6" cy="8" r="0.5" fill="currentColor" />
      <circle cx="6" cy="12" r="0.5" fill="currentColor" />
      <circle cx="6" cy="16" r="0.5" fill="currentColor" />
      <path d="M8 8h6M8 12h4M8 16h8" strokeWidth={1} opacity={0.7} />
    </svg>
  );

  const AFLFootyIcon = () => (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <ellipse cx="12" cy="12" rx="8" ry="10" />
      <path d="M12 4v16M8 12h8" strokeWidth={1} opacity={0.6} />
      <path d="M10 8l4 0M10 16l4 0" strokeWidth={1} opacity={0.4} />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  );

  const features = [
    {
      icon: <AFLFixtureIcon />,
      title: 'Round-Robin Generation',
      description: 'Advanced Circle Method (Berger tables) for balanced team scheduling with odd/even team support'
    },
    {
      icon: <AFLTrophyIcon />,
      title: 'Finals Systems',
      description: 'Flexible AFL-style finals with reseeding, bye weeks, and multi-week championship legs'
    },
    {
      icon: <AFLJerseyIcon />,
      title: 'Team Management',
      description: 'Support for 4-18 teams with automatic bye week handling and balanced home/away splits'
    },
    {
      icon: <AFLStadiumIcon />,
      title: 'Season Planning',
      description: 'Intelligent week allocation between regular season and finals with venue considerations'
    },
    {
      icon: <AFLLadderIcon />,
      title: 'Ladder Analytics',
      description: 'Comprehensive schedule analysis with match counts, balance metrics, and ladder implications'
    },
    {
      icon: <AFLFootyIcon />,
      title: 'AFL Customization',
      description: 'Configurable matchups per opponent, finals formats, and traditional AFL scheduling rules'
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
    
    // Optional flag to force local (e.g., in dev)
    const USE_SERVER = process.env.NEXT_PUBLIC_USE_SERVER_SCHEDULING !== 'false';

    try {
      if (USE_SERVER) {
        try {
          // Use API with graceful fallback
          // Type assertion needed due to type system incompatibility between legacy and new scheduling APIs
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const apiResult = await generateScheduleViaApi(customSettings as any);
          setScheduleResult(apiResult as ComponentScheduleResult);
        } catch (apiErr) {
          // graceful fallback to local
          console.warn('[Scheduling] API failed, falling back to local:', apiErr);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const localResult = generateCompleteSchedule(customSettings as any);
          setScheduleResult(localResult as ComponentScheduleResult);
        }
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const localResult = generateCompleteSchedule(customSettings as any);
        setScheduleResult(localResult as ComponentScheduleResult);
      }
    } catch (e: unknown) {
      // Create error state that matches the success: false pattern
      const message = typeof e === 'string' ? e : e instanceof Error ? e.message : 'Unknown error';
      setScheduleResult({ 
        success: false, 
        error: message 
      } as ComponentScheduleResult);
    } finally {
      setIsGenerating(false);
    }
  };

  // preset change is handled inline where team-size buttons are used
  const validation = validateLeagueSettings(customSettings);

  return (
    <div className="min-h-screen bg-base-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="bg-gradient-to-r from-slate-900 to-slate-700 text-white py-6 px-8 rounded-lg shadow-lg inline-block w-full">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="text-left">
                <h1 className="text-3xl md:text-4xl font-bold">Professional Schedule Builder</h1>
                <p className="mt-1 text-sm text-slate-200 max-w-2xl">Create an AFL-grade season schedule with fairness, balance and broadcast-ready slots.</p>
              </div>
              <div className="text-right md:text-right">
                <div className="text-sm text-slate-200">League</div>
                <div className="text-xl font-semibold">{leagueName}</div>
              </div>
            </div>

            <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-end gap-3">
              <input
                className="input input-bordered w-64"
                value={leagueName}
                onChange={(e) => setLeagueName(e.target.value)}
                placeholder="League name"
                aria-label="League name"
                maxLength={50}
                required
              />
              <input
                type="date"
                className="input input-bordered w-48"
                value={seasonStart}
                onChange={(e) => setSeasonStart(e.target.value)}
                aria-label="Season start date"
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
          </div>
        </div>

        {/* Professional Settings — professional / broadcast-ready checklist */}
        <div className="card bg-base-200 shadow-lg mb-8">
          <div className="card-body">
            <h2 className="text-xl font-semibold mb-2">Professional Settings</h2>
            <p className="text-sm text-base-content/60 mb-4">Broadcast-ready scheduling options. These choices help produce TV-friendly kickoffs, rivalry weeks and balanced byes.</p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="form-control">
                <div className="label"><span className="label-text">Matchups per opponent</span></div>
                <div className="btn-group">
                  <button className={`btn ${(customSettings.matchupsPerOpponent || 2) === 1 ? 'btn-primary' : 'btn-outline'}`} onClick={() => updateMatchups(1)} aria-pressed={(customSettings.matchupsPerOpponent || 2) === 1}>Once</button>
                  <button className={`btn ${(customSettings.matchupsPerOpponent || 2) === 2 ? 'btn-primary' : 'btn-outline'}`} onClick={() => updateMatchups(2)} aria-pressed={(customSettings.matchupsPerOpponent || 2) === 2}>Home & Away</button>
                </div>
                <div className="label mt-2"><span className="label-text-alt text-xs">Single or double round-robin (typical professional leagues use divisions and repeat opponents)</span></div>
              </div>

              <div className="form-control">
                <div className="label"><span className="label-text">Prime-time windows</span></div>
                <div className="flex gap-2">
                  <label className="cursor-pointer label">
                    <input
                      type="checkbox"
                      checked={professionalScheduling.primeTimeSlots.friday}
                      onChange={(e) => setProfessionalScheduling(prev => ({ ...prev, primeTimeSlots: { ...prev.primeTimeSlots, friday: e.target.checked } }))}
                      className="checkbox"
                    />
                    <span className="label-text ml-2">Fri</span>
                  </label>
                  <label className="cursor-pointer label">
                    <input
                      type="checkbox"
                      checked={professionalScheduling.primeTimeSlots.saturday}
                      onChange={(e) => setProfessionalScheduling(prev => ({ ...prev, primeTimeSlots: { ...prev.primeTimeSlots, saturday: e.target.checked } }))}
                      className="checkbox"
                    />
                    <span className="label-text ml-2">Sat</span>
                  </label>
                  <label className="cursor-pointer label">
                    <input
                      type="checkbox"
                      checked={professionalScheduling.primeTimeSlots.sunday}
                      onChange={(e) => setProfessionalScheduling(prev => ({ ...prev, primeTimeSlots: { ...prev.primeTimeSlots, sunday: e.target.checked } }))}
                      className="checkbox"
                    />
                    <span className="label-text ml-2">Sun</span>
                  </label>
                </div>
                <div className="label mt-2"><span className="label-text-alt text-xs">Select nights to prioritize for televised games</span></div>
              </div>

              <div className="form-control">
                <div className="label"><span className="label-text">Broadcast-friendly</span></div>
                <label className="cursor-pointer label">
                  <input type="checkbox" className="toggle toggle-primary" checked={professionalScheduling.broadcastPreferred} onChange={(e) => setProfessionalScheduling(prev => ({ ...prev, broadcastPreferred: e.target.checked }))} />
                  <span className="label-text ml-2">Prefer broadcast slots and balanced rest between teams</span>
                </label>
              </div>
            </div>

            <div className="divider"></div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="label"><span className="label-text">Bye week policy</span></div>
                <div className="btn-group">
                  <button className={`btn ${professionalScheduling.byePolicy === 'spread' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setProfessionalScheduling(prev => ({ ...prev, byePolicy: 'spread' }))} aria-pressed={professionalScheduling.byePolicy === 'spread'}>Spread byes</button>
                  <button className={`btn ${professionalScheduling.byePolicy === 'cluster' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setProfessionalScheduling(prev => ({ ...prev, byePolicy: 'cluster' }))} aria-pressed={professionalScheduling.byePolicy === 'cluster'}>Clustered by division</button>
                </div>
                <p className="text-xs text-base-content/60 mt-2">Spread gives fairness; clustered can create marquee bye weeks.</p>
              </div>

              <div>
                <div className="label"><span className="label-text">Rivalry rounds</span></div>
                <select className="select select-bordered" value={professionalScheduling.rivalryRounds} onChange={(e) => setProfessionalScheduling(prev => ({ ...prev, rivalryRounds: parseInt(e.target.value) }))}>
                  <option value={0}>None</option>
                  <option value={1}>1 rivalry round</option>
                  <option value={2}>2 rivalry rounds</option>
                </select>
                <p className="text-xs text-base-content/60 mt-2">How many weeks should be dedicated to rivalry matchups.</p>
              </div>

              <div>
                <div className="label"><span className="label-text">Home/Away balance</span></div>
                <div className="btn-group">
                  <button className={`btn ${professionalScheduling.homeAwayPreference === 'balanced' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setProfessionalScheduling(prev => ({ ...prev, homeAwayPreference: 'balanced' }))} aria-pressed={professionalScheduling.homeAwayPreference === 'balanced'}>Balanced</button>
                  <button className={`btn ${professionalScheduling.homeAwayPreference === 'asymmetric' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setProfessionalScheduling(prev => ({ ...prev, homeAwayPreference: 'asymmetric' }))} aria-pressed={professionalScheduling.homeAwayPreference === 'asymmetric'}>Allow asymmetry</button>
                </div>
                <p className="text-xs text-base-content/60 mt-2">Balanced gives equal home/away games where possible.</p>
              </div>
            </div>
          </div>
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
                            // Select a preset that matches the desired team count, fall back gracefully
                            const entry = Object.entries(LEAGUE_PRESETS).find(([, preset]) => preset.settings.numTeams === teamCount);
                            const presetKey = entry ? (entry[0] as keyof typeof LEAGUE_PRESETS) : (Object.keys(LEAGUE_PRESETS)[0] as keyof typeof LEAGUE_PRESETS);
                            const presetObj = (entry ? entry[1] : Object.values(LEAGUE_PRESETS)[0]) as { settings: ComponentLeagueSettings };
                            setSelectedPreset(presetKey);
                            setCustomSettings({ ...presetObj.settings, numTeams: teamCount });
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
                          setCustomSettings((prev: ComponentLeagueSettings) => ({ ...prev, numTeams: parseInt(teams) }));
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
                          onClick={() => setCustomSettings((prev: ComponentLeagueSettings) => ({ ...prev, seasonWeeks: option.weeks }))}
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
                        onClick={() => {
                          setScheduleResult(null);
                          setCustomSettings((prev: ComponentLeagueSettings) => ({
                            ...prev,
                            playoffs: {
                              enabled: false,
                              teams: prev.playoffs?.teams || 4,
                              legLengthWeeks: prev.playoffs?.legLengthWeeks || 1,
                              reseedEachRound: prev.playoffs?.reseedEachRound || false,
                              includeConsolation: prev.playoffs?.includeConsolation || false
                            }
                          }));
                        }}
                      >
                        <div className="card-body text-center p-6">
                          <div className="text-4xl mb-2">📊</div>
                          <h3 className="font-bold text-lg">Regular Season Only</h3>
                          <p className="text-sm text-base-content/70">
                            Best AFL ladder position wins the premiership
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
                          setCustomSettings((prev: ComponentLeagueSettings) => ({
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
                          <h3 className="font-bold text-lg">Include AFL Finals</h3>
                          <p className="text-sm text-base-content/70">
                            Top teams compete in AFL-style finals for the premiership
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
                      <div className="text-6xl mb-4">🎯</div>
                      <h2 className="text-3xl font-bold text-success mb-2">AFL Schedule Created!</h2>
                      <div className="text-6xl mb-4">🏆</div>
                      <p className="text-lg text-base-content/80">
                        Your {customSettings.numTeams}-team AFL league is ready for the season
                      </p>
                    </div>

                    {/* Key Stats */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="stat bg-base-100 rounded-xl shadow-lg text-center">
                        <div className="stat-value text-primary text-2xl">{scheduleResult.summary.regularSeasonWeeks}</div>
                        <div className="stat-title">Regular Rounds</div>
                      </div>
                      <div className="stat bg-base-100 rounded-xl shadow-lg text-center">
                        <div className="stat-value text-secondary text-2xl">{scheduleResult.summary.playoffWeeks}</div>
                        <div className="stat-title">Finals Rounds</div>
                      </div>
                      <div className="stat bg-base-100 rounded-xl shadow-lg text-center">
                        <div className="stat-value text-accent text-2xl">{scheduleResult.summary.totalMatches}</div>
                        <div className="stat-title">Total Matches</div>
                      </div>
                    </div>

                    {/* Schedule Preview */}
                      <div className="card bg-base-100 shadow-lg">
                        <div className="card-body">
                          <h3 className="card-title justify-center mb-4">🏟️ AFL Fixture Preview</h3>
                          <div className="overflow-x-auto">
                            <table className="table table-zebra">
                              <thead>
                                <tr>
                                  <th>Round</th>
                                  <th>Phase</th>
                                  <th>Matches</th>
                                  <th>Example Fixture</th>
                                </tr>
                              </thead>
                              <tbody>
                                {/* Regular Season Sample */}
                                {scheduleResult.regularSeason.slice(0, 3).map((week) => (
                                  <tr key={`reg-${week.week}`}>
                                    <td className="font-semibold">Round {week.week}</td>
                                    <td><span className="badge badge-primary badge-sm">Regular</span></td>
                                    <td>{week.matches.length}</td>
                                    <td className="text-sm">
                                      {week.matches[0] ? (
                                        <>Team {week.matches[0].homeTeam} vs {week.matches[0].awayTeam}</>
                                      ) : (
                                        <span className="text-base-content/60">Bye round</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                                {scheduleResult.regularSeason.length > 3 && (
                                  <tr>
                                    <td colSpan={4} className="text-center text-base-content/60 italic">
                                      ... {scheduleResult.regularSeason.length - 3} more regular season rounds
                                    </td>
                                  </tr>
                                )}
                                {/* Playoffs Sample */}
                                {scheduleResult.playoffs.slice(0, 2).map((week) => (
                                  <tr key={`playoff-${week.week}`}>
                                    <td className="font-semibold">Round {week.week}</td>
                                    <td><span className="badge badge-secondary badge-sm">Finals</span></td>
                                    <td>{week.matches.length}</td>
                                    <td className="text-sm">{week.roundName || 'Finals Round'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>                    {/* Action Buttons */}
                    <div className="flex gap-4 justify-center">
                      <button className="btn btn-primary btn-lg gap-2">
                        <AFLFixtureIcon />
                        Download AFL Fixture
                      </button>
                      <button 
                        className="btn btn-outline btn-lg gap-2"
                        onClick={() => setScheduleResult(null)}
                      >
                        <AFLFootyIcon />
                        Create Another Season
                      </button>
                    </div>
                  </div>
                ) : (
                  // Render a clear error card when schedule generation failed
                  <div className="card bg-base-200 shadow-lg">
                    <div className="card-body text-center">
                      <div className="flex justify-center mb-3">
                        <ExclamationTriangleIcon className="w-16 h-16 text-error" />
                      </div>
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
                      {null}
                    </div>
                  </div>
                )
              ) : (
                <div className="text-center py-16">
                  <div className="mb-6 flex justify-center">
                    <div className="w-20 h-20 text-base-content/20 flex items-center justify-center">
                      <AFLStadiumIcon />
                    </div>
                  </div>
                  <h3 className="text-xl font-semibold mb-3">Choose Your AFL Format</h3>
                  <p className="text-base-content/60 max-w-md mx-auto">
                    Pick an AFL league format above and click Generate to create your fixture
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
                    <h3 className="card-title mb-4">Core AFL Algorithms</h3>
                    <div className="space-y-2">
                      <div className="badge badge-primary gap-2">
                        <AFLFixtureIcon />
                        Circle Method (Berger)
                      </div>
                      <div className="badge badge-secondary gap-2">
                        <AFLTrophyIcon />
                        Finals Generation
                      </div>
                      <div className="badge badge-accent gap-2">
                        <AFLLadderIcon />
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
                    <h3 className="card-title mb-4">Statly API Endpoints</h3>
                    <div className="text-sm space-y-2">
                      <div className="bg-base-100 p-2 rounded">
                        <code className="text-primary">POST /api/scheduling/generate</code>
                        <p className="text-xs text-base-content/60 mt-1">Generate complete AFL schedule</p>
                      </div>
                      <div className="bg-base-100 p-2 rounded">
                        <code className="text-secondary">GET /api/scheduling/presets</code>
                        <p className="text-xs text-base-content/60 mt-1">Get AFL league presets</p>
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
          <div className="flex items-center justify-center gap-3 mb-4">
            <AFLFootyIcon />
            <p className="text-base-content/70">
              Statly&apos;s comprehensive AFL scheduling system provides professional-grade league management
              with advanced algorithms, flexible configuration, and intelligent optimization.
            </p>
            <AFLFootyIcon />
          </div>
          <div className="flex justify-center gap-4 flex-wrap">
            <div className="badge badge-outline">AFL Round-Robin</div>
            <div className="badge badge-outline">Finals Systems</div>
            <div className="badge badge-outline">Ladder Balance</div>
            <div className="badge badge-outline">TypeScript</div>
            <div className="badge badge-outline">Real-time Validation</div>
            <div className="badge badge-outline">Statly Powered</div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
