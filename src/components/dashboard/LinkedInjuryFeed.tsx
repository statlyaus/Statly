import { useState } from 'react';

import Link from 'next/link';

import { motion, AnimatePresence } from 'framer-motion';

import {
  useEnhancedInjuryData,
  type EnhancedNormalizedInjuryData,
} from '@/hooks/useEnhancedInjuryData';
import { getFormattedETA, STATUS_DISPLAY } from '@/types/injuries';

interface LinkedInjuryFeedProps {
  teamFilter?: string;
  autoRefresh?: boolean;
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

// Narrow status safely to a valid STATUS_DISPLAY key
function isValidStatusKey(value: unknown): value is keyof typeof STATUS_DISPLAY {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STATUS_DISPLAY, value);
}

const getStatusColor = (status: EnhancedNormalizedInjuryData['status'] | undefined) => {
  const key = isValidStatusKey(status) ? status : 'UNKNOWN';
  const statusInfo = STATUS_DISPLAY[key] ?? STATUS_DISPLAY.UNKNOWN;
  switch (statusInfo.color) {
    case 'green':
      return 'bg-success/10 text-success border-success/20';
    case 'yellow':
      return 'bg-warning/10 text-warning border-warning/20';
    case 'red':
      return 'bg-destructive/10 text-destructive border-destructive/20';
    case 'orange':
      return 'bg-warning/10 text-warning border-warning/20';
    case 'blue':
      return 'bg-info/10 text-info border-info/20';
    case 'purple':
      return 'bg-primary/10 text-primary border-primary/20';
    case 'gray':
      // Map gray to the neutral slate palette used elsewhere for visual consistency
      return 'bg-muted text-foreground border-border';
    default:
      return 'bg-muted text-foreground border-border';
  }
};

const getConfidenceBadge = (confidence: EnhancedNormalizedInjuryData['matchConfidence']) => {
  switch (confidence) {
    case 'exact':
      return (
        <span className="bg-success/10 text-success text-xs px-2 py-1 rounded-full">
          ✓ Verified
        </span>
      );
    case 'high':
      return (
        <span className="bg-info/10 text-info text-xs px-2 py-1 rounded-full">High Match</span>
      );
    case 'medium':
      return (
        <span className="bg-warning/10 text-warning text-xs px-2 py-1 rounded-full">
          Likely Match
        </span>
      );
    case 'low':
      return (
        <span className="bg-warning/10 text-warning text-xs px-2 py-1 rounded-full">
          Possible Match
        </span>
      );
    default:
      return null;
  }
};

// Helper function to generate unique keys for injury records
const generateInjuryKey = (injury: EnhancedNormalizedInjuryData, index: number): string => {
  // Sanitize strings to prevent React key issues
  const sanitize = (val: unknown) =>
    String(val ?? '')
      .replace(/[^\w-]/g, '_')
      .substring(0, 50);

  return `${sanitize(injury.team_id)}-${sanitize(injury.player)}-${sanitize(injury.injury_raw)}-${index}`;
};

function InjuryPlayerCard({
  injury,
  teamIndex,
  playerIndex,
}: {
  injury: EnhancedNormalizedInjuryData;
  teamIndex: number;
  playerIndex: number;
}) {
  const hasLinkedPlayer = !!injury.linkedPlayer;

  const cardContent = (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: teamIndex * 0.1 + playerIndex * 0.05 }}
      className={`p-4 transition-all duration-200 ${
        hasLinkedPlayer
          ? 'hover:bg-info/10 hover:shadow-md cursor-pointer border-l-4 border-l-blue-400'
          : 'hover:bg-muted'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-3 mb-2">
            <div className="flex items-center space-x-2">
              <h4
                className={`text-base font-medium ${hasLinkedPlayer ? 'text-info' : 'text-foreground'}`}
              >
                {injury.player}
                {hasLinkedPlayer && (
                  <svg
                    className="w-4 h-4 inline ml-1 text-info"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                )}
              </h4>
              {getConfidenceBadge(injury.matchConfidence)}
            </div>
            <span className="bg-info/10 text-info text-xs font-medium px-2 py-1 rounded">
              {injury.team_id}
            </span>
          </div>

          <div className="flex items-center space-x-4 text-sm mb-2">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-destructive rounded-full"></div>
              <span className="font-medium text-destructive">{injury.injury_raw}</span>
            </div>

            <div
              className={`px-2 py-1 rounded text-xs font-medium border ${getStatusColor(injury.status)}`}
            >
              {getFormattedETA(injury)}
            </div>
          </div>

          {/* Player database info if linked */}
          {injury.linkedPlayer && (
            <div className="mt-2 p-2 bg-info/10 rounded-md border border-info/20">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-sm font-medium text-info">
                    Database Profile: {injury.linkedPlayer.name}
                  </p>
                  <div className="flex items-center space-x-4 text-xs text-info mt-1">
                    {injury.linkedPlayer.team && <span>Team: {injury.linkedPlayer.team}</span>}
                    {injury.linkedPlayer.position && (
                      <span>Position: {injury.linkedPlayer.position}</span>
                    )}
                    {injury.linkedPlayer.avg && <span>Avg: {injury.linkedPlayer.avg}</span>}
                  </div>
                </div>
                <div className="text-info text-xs">Click to view →</div>
              </div>
            </div>
          )}

          {injury.notes && injury.notes !== injury.injury_raw && (
            <p className="mt-2 text-sm text-muted-foreground">{injury.notes}</p>
          )}
        </div>
      </div>
    </motion.div>
  );

  if (hasLinkedPlayer && injury.linkedPlayer) {
    return (
      <Link href={`/players/${injury.linkedPlayer.id}`} className="block hover:no-underline">
        {cardContent}
      </Link>
    );
  }

  return cardContent;
}

export default function LinkedInjuryFeed({
  teamFilter,
  autoRefresh = true,
}: LinkedInjuryFeedProps) {
  const [selectedTeam, setSelectedTeam] = useState<string>(teamFilter || '');
  const [viewMode, setViewMode] = useState<'teams' | 'list'>('teams');
  const [showLinkingStats, setShowLinkingStats] = useState(false);

  const { injuries, loading, error, lastUpdated, refresh, count, linkingStats } =
    useEnhancedInjuryData({
      teamFilter: selectedTeam || undefined,
      autoRefresh,
      refreshInterval: 300000, // 5 minutes
      enablePlayerLinking: true,
    });

  // Calculate unique injured players count
  const uniquePlayersCount = new Set(
    injuries.map((injury) =>
      (typeof injury.player === 'string' ? injury.player : '').toLowerCase().trim()
    )
  ).size;

  // Group injuries by team
  const injuriesByTeam = injuries.reduce(
    (acc, injury) => {
      if (!acc[injury.team_name]) {
        acc[injury.team_name] = [];
      }
      acc[injury.team_name].push(injury);
      return acc;
    },
    {} as Record<string, EnhancedNormalizedInjuryData[]>
  );

  const teamNames = Object.keys(injuriesByTeam).sort();

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <h2 className="text-xl font-bold text-foreground">AFL Injury Report</h2>
            {uniquePlayersCount > 0 && (
              <span className="bg-destructive/10 text-destructive text-sm font-medium px-3 py-1 rounded-full">
                {uniquePlayersCount} injured {uniquePlayersCount === 1 ? 'player' : 'players'}
              </span>
            )}
            {count > 0 && count !== uniquePlayersCount && (
              <span className="bg-warning/10 text-warning text-sm font-medium px-3 py-1 rounded-full">
                {count} total {count === 1 ? 'injury' : 'injuries'}
              </span>
            )}
            {linkingStats.totalLinked > 0 && (
              <span className="bg-info/10 text-info text-sm font-medium px-3 py-1 rounded-full">
                {linkingStats.totalLinked} linked profiles
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowLinkingStats(!showLinkingStats)}
              className="px-3 py-2 text-sm font-medium text-foreground bg-white border border-border rounded-md hover:bg-muted transition-colors"
              title="Show linking statistics"
            >
              📊 Stats
            </button>
            <button
              onClick={refresh}
              disabled={loading}
              className="flex items-center space-x-2 px-3 py-2 text-sm font-medium text-foreground bg-white border border-border rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Refresh injury data"
            >
              <svg
                className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
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
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Linking Stats Panel */}
        <AnimatePresence>
          {showLinkingStats && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-muted border border-border rounded-lg p-4"
            >
              <h3 className="font-medium text-foreground mb-3">Injuries by Club</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 text-sm">
                {teamNames.map((teamName) => {
                  const teamInjuries = injuriesByTeam[teamName];
                  const teamPlayersCount = new Set(
                    teamInjuries.map((injury) =>
                      (typeof injury.player === 'string' ? injury.player : '').toLowerCase().trim()
                    )
                  ).size;
                  return (
                    <div
                      key={teamName}
                      className="text-center p-3 bg-white rounded-lg border border-border"
                    >
                      <div className="text-lg font-bold text-foreground">{teamPlayersCount}</div>
                      <div className="text-xs text-muted-foreground font-medium mb-1">{teamName}</div>
                      <div className="text-xs text-muted-foreground">
                        {teamInjuries.length} {teamInjuries.length === 1 ? 'injury' : 'injuries'}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                Shows injured players per team. Click on linked players (blue border) to view their
                profiles.
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            {/* Team filter */}
            <select
              value={selectedTeam}
              onChange={(e) => setSelectedTeam(e.target.value)}
              className="text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-info focus:border-transparent"
            >
              <option value="">All Teams</option>
              {AFL_TEAMS.map((team) => (
                <option key={team} value={team}>
                  {team}
                </option>
              ))}
            </select>

            {/* View mode toggle */}
            <div className="flex bg-muted rounded-md p-1">
              <button
                onClick={() => setViewMode('teams')}
                className={`px-3 py-1 text-sm font-medium rounded transition-colors ${
                  viewMode === 'teams'
                    ? 'bg-white text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                By Team
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1 text-sm font-medium rounded transition-colors ${
                  viewMode === 'list'
                    ? 'bg-white text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                List View
              </button>
            </div>
          </div>

          {/* Last updated */}
          {lastUpdated && (
            <div className="text-xs text-muted-foreground">
              Updated: {new Date(lastUpdated).toLocaleTimeString()}
            </div>
          )}
        </div>

        {/* Data source */}
        <div className="text-xs text-muted-foreground border-t border-border pt-2">
          <span>Data source: Footywire AFL Injury List • Player profiles from Statly database</span>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-info/20 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-sm text-muted-foreground">Loading injury data and linking players...</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-warning/10 border border-warning/20 rounded-lg"
        >
          <div className="flex items-start space-x-3">
            <div className="w-6 h-6 bg-warning/10 rounded-full flex items-center justify-center">
              <svg
                className="w-4 h-4 text-warning"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
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
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="text-center py-12"
            >
              <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-success"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
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
                  ? 'This team is currently injury-free.'
                  : 'All players are healthy and available.'}
              </p>
            </motion.div>
          ) : viewMode === 'teams' ? (
            /* Team View */
            <motion.div
              key="teams"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              {teamNames.map((teamName, teamIndex) => (
                <motion.div
                  key={teamName}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: teamIndex * 0.1 }}
                  className="bg-white border border-border rounded-lg overflow-hidden shadow-sm"
                >
                  {/* Team Header */}
                  <div className="bg-muted px-6 py-4 border-b border-border">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-foreground">{teamName}</h3>
                      <div className="flex items-center space-x-2">
                        <span className="bg-muted text-foreground text-sm font-medium px-3 py-1 rounded-full">
                          {injuriesByTeam[teamName].length}{' '}
                          {injuriesByTeam[teamName].length === 1 ? 'injury' : 'injuries'}
                        </span>
                        {injuriesByTeam[teamName].filter((i) => i.linkedPlayer).length > 0 && (
                          <span className="bg-info/10 text-info text-sm font-medium px-3 py-1 rounded-full">
                            {injuriesByTeam[teamName].filter((i) => i.linkedPlayer).length} linked
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Players */}
                  <div className="divide-y divide-slate-100">
                    {injuriesByTeam[teamName].map((injury, playerIndex) => (
                      <InjuryPlayerCard
                        key={generateInjuryKey(injury, playerIndex)}
                        injury={injury}
                        teamIndex={teamIndex}
                        playerIndex={playerIndex}
                      />
                    ))}
                  </div>
                </motion.div>
              ))}
            </motion.div>
          ) : (
            /* List View */
            <motion.div
              key="list"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-3"
            >
              {injuries.map((injury, index) => (
                <div
                  key={generateInjuryKey(injury, index)}
                  className="bg-white border border-border rounded-lg overflow-hidden shadow-sm"
                >
                  <InjuryPlayerCard injury={injury} teamIndex={0} playerIndex={index} />
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
