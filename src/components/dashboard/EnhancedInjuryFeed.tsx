import React, { useState, useEffect, useMemo, memo } from 'react';

import { motion, AnimatePresence } from 'framer-motion';

import { useInjuryData } from '@/hooks/useInjuryData';

interface InjuryData {
  id: string;
  name: string;
  team: string;
  position: string;
  injury: string;
  status: string;
  expectedReturn?: string;
  details?: string;
}

interface EnhancedInjuryFeedProps {
  refreshTrigger?: number;
  teamFilter?: string;
  autoRefresh?: boolean;
  onTeamFilterChange?: (team: string) => void;
}

const AFL_TEAMS = [
  'Adelaide',
  'Brisbane',
  'Carlton',
  'Collingwood',
  'Essendon',
  'Fremantle',
  'Geelong',
  'Gold Coast',
  'GWS',
  'Hawthorn',
  'Melbourne',
  'North Melbourne',
  'Port Adelaide',
  'Richmond',
  'St Kilda',
  'Sydney',
  'West Coast',
  'Western Bulldogs',
];

const getStatusColor = (status: string, expectedReturn?: string) => {
  // Defensive check for unexpected status values
  if (!status || typeof status !== 'string') {
    return 'bg-muted text-foreground border-border';
  }

  const combined = `${status} ${expectedReturn || ''}`.toLowerCase();

  if (combined.includes('test') || combined.includes('available')) {
    return 'bg-warning/10 text-warning border-warning/20';
  }
  if (combined.includes('season') || combined.includes('indefinite')) {
    return 'bg-destructive/10 text-destructive border-destructive/20';
  }
  if (combined.includes('week')) {
    return 'bg-warning/10 text-warning border-warning/20';
  }
  return 'bg-muted text-foreground border-border';
};

// Memoized injury list item component for performance
const InjuryListItem = memo(
  ({
    injury,
    index,
    disableMotion = false,
  }: {
    injury: InjuryData;
    index: number;
    disableMotion: boolean;
  }) => {
    const motionProps = disableMotion
      ? {}
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: { delay: index * 0.05 },
        };

    return (
      <motion.div
        {...motionProps}
        className="p-4 bg-white border border-border rounded-lg hover:shadow-md transition-shadow"
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center space-x-3 mb-2">
              <h4 className="text-base font-medium text-foreground">{injury.name}</h4>
              <span className="text-sm text-muted-foreground">({injury.team})</span>
              {injury.position && injury.position !== 'Unknown' && (
                <span className="bg-info/10 text-info text-xs font-medium px-2 py-1 rounded">
                  {injury.position}
                </span>
              )}
            </div>

            <div className="flex items-center space-x-4 text-sm">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-destructive rounded-full" aria-hidden="true"></div>
                <span className="font-medium text-destructive">{injury.injury}</span>
              </div>

              <div
                className={`px-2 py-1 rounded text-xs font-medium border ${getStatusColor(injury.status, injury.expectedReturn)}`}
              >
                {injury.expectedReturn || injury.status}
              </div>
            </div>

            {injury.details && injury.details !== injury.injury && (
              <p className="mt-2 text-sm text-muted-foreground">{injury.details}</p>
            )}
          </div>
        </div>
      </motion.div>
    );
  }
);

InjuryListItem.displayName = 'InjuryListItem';

export default function EnhancedInjuryFeed({
  teamFilter,
  autoRefresh = true,
  onTeamFilterChange,
}: EnhancedInjuryFeedProps): React.JSX.Element {
  const [selectedTeam, setSelectedTeam] = useState<string>(teamFilter || '');
  const [viewMode, setViewMode] = useState<'teams' | 'list'>('teams');

  // Sync selectedTeam with teamFilter prop changes
  useEffect(() => {
    if (teamFilter !== undefined && teamFilter !== selectedTeam) {
      setSelectedTeam(teamFilter);
    }
  }, [teamFilter, selectedTeam]);

  const { injuries, loading, error, lastUpdated, refresh, count } = useInjuryData({
    teamFilter: selectedTeam || undefined,
    autoRefresh,
    refreshInterval: 300000, // 5 minutes
  });

  // Memoized team grouping for performance
  const injuriesByTeam = useMemo(() => {
    return injuries.reduce(
      (acc, injury) => {
        if (!acc[injury.team]) {
          acc[injury.team] = [];
        }
        acc[injury.team].push(injury);
        return acc;
      },
      {} as Record<string, InjuryData[]>
    );
  }, [injuries]);

  // Memoized team names with stable, locale-aware sorting
  const teamNames = useMemo(() => {
    return Object.keys(injuriesByTeam).sort((a, b) =>
      new Intl.Collator('en-AU', { numeric: true }).compare(a, b)
    );
  }, [injuriesByTeam]);

  // Performance guard for animations
  const shouldDisableAnimations =
    injuries.length > 200 || (selectedTeam && injuriesByTeam[selectedTeam]?.length > 200);

  // Handle team filter changes
  const handleTeamChange = (team: string) => {
    setSelectedTeam(team);
    onTeamFilterChange?.(team);
  };

  // Handle view mode change with keyboard support
  const handleViewModeChange = (mode: 'teams' | 'list') => {
    setViewMode(mode);
  };

  // Format last updated time safely
  const formatLastUpdated = (timestamp: number | string | Date) => {
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        return null;
      }
      return date;
    } catch {
      return null;
    }
  };

  const lastUpdatedDate = lastUpdated ? formatLastUpdated(lastUpdated) : null;

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <h2 className="text-xl font-bold text-foreground">AFL Injury Report</h2>
            {count > 0 && (
              <span
                className="bg-destructive/10 text-destructive text-sm font-medium px-3 py-1 rounded-full"
                aria-label={`${count} injured ${count === 1 ? 'player' : 'players'}`}
              >
                {count} injured {count === 1 ? 'player' : 'players'}
              </span>
            )}
          </div>

          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center space-x-2 px-3 py-2 text-sm font-medium text-foreground bg-white border border-border rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Refresh injury data"
            aria-label="Refresh injury data"
            aria-busy={loading}
          >
            <svg
              className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span>Refresh</span>
          </button>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            {/* Team filter */}
            <div className="flex items-center space-x-2">
              <label htmlFor="team-filter" className="sr-only">
                Filter by team
              </label>
              <select
                id="team-filter"
                value={selectedTeam}
                onChange={(e) => handleTeamChange(e.target.value)}
                className="text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-info focus:border-transparent"
              >
                <option value="">All Teams</option>
                {AFL_TEAMS.map((team) => (
                  <option key={team} value={team}>
                    {team}
                  </option>
                ))}
              </select>
              {selectedTeam && (
                <button
                  onClick={() => handleTeamChange('')}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                  title="Clear team filter"
                >
                  Reset
                </button>
              )}
            </div>

            {/* View mode toggle - proper radiogroup */}
            <fieldset role="radiogroup" aria-label="View mode">
              <legend className="sr-only">Choose view mode</legend>
              <div className="flex bg-muted rounded-md p-1">
                <label className="cursor-pointer">
                  <input
                    type="radio"
                    name="view-mode"
                    value="teams"
                    checked={viewMode === 'teams'}
                    onChange={() => handleViewModeChange('teams')}
                    className="sr-only"
                  />
                  <span
                    className={`px-3 py-1 text-sm font-medium rounded transition-colors block ${
                      viewMode === 'teams'
                        ? 'bg-white text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    By Team
                  </span>
                </label>
                <label className="cursor-pointer">
                  <input
                    type="radio"
                    name="view-mode"
                    value="list"
                    checked={viewMode === 'list'}
                    onChange={() => handleViewModeChange('list')}
                    className="sr-only"
                  />
                  <span
                    className={`px-3 py-1 text-sm font-medium rounded transition-colors block ${
                      viewMode === 'list'
                        ? 'bg-white text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    List View
                  </span>
                </label>
              </div>
            </fieldset>
          </div>

          {/* Last updated */}
          {lastUpdatedDate && (
            <div className="text-xs text-muted-foreground" aria-live="polite">
              Updated:{' '}
              <time dateTime={lastUpdatedDate.toISOString()}>
                {lastUpdatedDate.toLocaleTimeString()}
              </time>
            </div>
          )}
        </div>

        {/* Data source */}
        <div className="text-xs text-muted-foreground border-t border-border pt-2">
          <span>Data source: Footywire AFL Injury List</span>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12" role="status" aria-busy="true">
          <div className="text-center">
            <div
              className="w-8 h-8 border-2 border-info/20 border-t-transparent rounded-full animate-spin mx-auto mb-4"
              aria-hidden="true"
            ></div>
            <p className="text-sm text-muted-foreground">Loading injury data...</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-warning/10 border border-warning/20 rounded-lg"
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-start space-x-3">
            <div className="w-6 h-6 bg-warning/10 rounded-full flex items-center justify-center">
              <svg
                className="w-4 h-4 text-warning"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 18.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <div>
              <h4 className="font-medium text-warning">Unable to fetch live data</h4>
              <p className="text-sm text-warning mt-1">{error}</p>
              <p className="text-sm text-warning mt-1">Showing sample data for demonstration</p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Content */}
      {!loading && (
        <AnimatePresence mode="wait">
          {injuries.length === 0 ? (
            /* Empty State */
            <motion.div
              key="empty"
              initial={shouldDisableAnimations ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
              animate={shouldDisableAnimations ? { opacity: 1 } : { opacity: 1, scale: 1 }}
              exit={shouldDisableAnimations ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
              className="text-center py-12"
              role="status"
              aria-live="polite"
            >
              <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-success"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">
                {selectedTeam ? `No injuries for ${selectedTeam}!` : 'No injuries reported!'}
              </h3>
              <p className="text-muted-foreground">
                {selectedTeam
                  ? 'This team is currently injury-free. Try clearing the team filter to see all injuries.'
                  : 'All players are healthy and available.'}
              </p>
            </motion.div>
          ) : viewMode === 'teams' ? (
            /* Team View */
            <motion.div
              key="teams"
              initial={shouldDisableAnimations ? { opacity: 0 } : { opacity: 0, y: 10 }}
              animate={shouldDisableAnimations ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={shouldDisableAnimations ? { opacity: 0 } : { opacity: 0, y: -10 }}
              className="space-y-4"
            >
              {teamNames.map((teamName, teamIndex) => (
                <motion.div
                  key={teamName}
                  initial={shouldDisableAnimations ? { opacity: 0 } : { opacity: 0, y: 10 }}
                  animate={shouldDisableAnimations ? { opacity: 1 } : { opacity: 1, y: 0 }}
                  transition={shouldDisableAnimations ? {} : { delay: teamIndex * 0.1 }}
                  className="bg-white border border-border rounded-lg overflow-hidden shadow-sm"
                >
                  {/* Team Header */}
                  <div className="bg-muted px-6 py-4 border-b border-border">
                    <div className="flex items-center justify-between">
                      <h3
                        id={`team-${teamName.toLowerCase().replace(/\s+/g, '-')}`}
                        className="text-lg font-semibold text-foreground"
                      >
                        {teamName}
                      </h3>
                      <span
                        className="bg-muted text-foreground text-sm font-medium px-3 py-1 rounded-full"
                        aria-label={`${injuriesByTeam[teamName].length} ${injuriesByTeam[teamName].length === 1 ? 'injury' : 'injuries'}`}
                      >
                        {injuriesByTeam[teamName].length}{' '}
                        {injuriesByTeam[teamName].length === 1 ? 'injury' : 'injuries'}
                      </span>
                    </div>
                  </div>

                  {/* Players */}
                  <section
                    aria-labelledby={`team-${teamName.toLowerCase().replace(/\s+/g, '-')}`}
                    className="divide-y divide-slate-100"
                  >
                    <ul className="divide-y divide-slate-100">
                      {injuriesByTeam[teamName].map((injury, playerIndex) => (
                        <motion.li
                          key={injury.id}
                          initial={
                            shouldDisableAnimations ? { opacity: 0 } : { opacity: 0, x: -10 }
                          }
                          animate={shouldDisableAnimations ? { opacity: 1 } : { opacity: 1, x: 0 }}
                          transition={
                            shouldDisableAnimations
                              ? {}
                              : { delay: teamIndex * 0.1 + playerIndex * 0.05 }
                          }
                          className="p-6 hover:bg-muted transition-colors"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center space-x-3 mb-2">
                                <h4 className="text-base font-medium text-foreground">
                                  {injury.name}
                                </h4>
                                {injury.position && injury.position !== 'Unknown' && (
                                  <span className="bg-info/10 text-info text-xs font-medium px-2 py-1 rounded">
                                    {injury.position}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center space-x-4 text-sm">
                                <div className="flex items-center space-x-2">
                                  <div
                                    className="w-2 h-2 bg-destructive rounded-full"
                                    aria-hidden="true"
                                  ></div>
                                  <span className="font-medium text-destructive">{injury.injury}</span>
                                </div>

                                <div
                                  className={`px-2 py-1 rounded text-xs font-medium border ${getStatusColor(injury.status, injury.expectedReturn)}`}
                                >
                                  {injury.expectedReturn || injury.status}
                                </div>
                              </div>

                              {injury.details && injury.details !== injury.injury && (
                                <p className="mt-2 text-sm text-muted-foreground">{injury.details}</p>
                              )}
                            </div>
                          </div>
                        </motion.li>
                      ))}
                    </ul>
                  </section>
                </motion.div>
              ))}
            </motion.div>
          ) : (
            /* List View */
            <motion.div
              key="list"
              initial={shouldDisableAnimations ? { opacity: 0 } : { opacity: 0, y: 10 }}
              animate={shouldDisableAnimations ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={shouldDisableAnimations ? { opacity: 0 } : { opacity: 0, y: -10 }}
              className="space-y-3"
            >
              <ul className="space-y-3">
                {injuries.map((injury, index) => (
                  <InjuryListItem
                    key={injury.id}
                    injury={injury}
                    index={index}
                    disableMotion={!!shouldDisableAnimations}
                  />
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
