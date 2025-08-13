import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useEnhancedInjuryData, type EnhancedNormalizedInjuryData } from '@/hooks/useEnhancedInjuryData';
import { getFormattedETA, STATUS_DISPLAY } from '@/types/injuries';

interface LinkedInjuryFeedProps {
  teamFilter?: string;
  autoRefresh?: boolean;
}

const AFL_TEAMS = [
  'Adelaide', 'Brisbane', 'Carlton', 'Collingwood', 'Essendon', 'Fremantle',
  'Geelong', 'Gold Coast', 'GWS', 'Hawthorn', 'Melbourne', 'North Melbourne',
  'Port Adelaide', 'Richmond', 'St Kilda', 'Sydney', 'West Coast', 'Western Bulldogs'
];

const getStatusColor = (status: EnhancedNormalizedInjuryData['status']) => {
  const statusInfo = STATUS_DISPLAY[status];
  switch (statusInfo.color) {
    case 'green':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'yellow':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'red':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'orange':
      return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'blue':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'purple':
      return 'bg-purple-100 text-purple-800 border-purple-200';
    default:
      return 'bg-slate-100 text-slate-800 border-slate-200';
  }
};

const getConfidenceBadge = (confidence: EnhancedNormalizedInjuryData['matchConfidence']) => {
  switch (confidence) {
    case 'exact':
      return <span className="bg-green-100 text-green-700 text-xs px-2 py-1 rounded-full">✓ Verified</span>;
    case 'high':
      return <span className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full">High Match</span>;
    case 'medium':
      return <span className="bg-yellow-100 text-yellow-700 text-xs px-2 py-1 rounded-full">Likely Match</span>;
    case 'low':
      return <span className="bg-orange-100 text-orange-700 text-xs px-2 py-1 rounded-full">Possible Match</span>;
    default:
      return null;
  }
};

// Helper function to generate unique keys for injury records
const generateInjuryKey = (injury: EnhancedNormalizedInjuryData, index: number): string => {
  // Sanitize strings to prevent React key issues
  const sanitize = (str: string) => str.replace(/[^\w-]/g, '_').substring(0, 50);
  
  return `${injury.team_id}-${sanitize(injury.player)}-${sanitize(injury.injury_raw)}-${index}`;
};

function InjuryPlayerCard({ injury, teamIndex, playerIndex }: { 
  injury: EnhancedNormalizedInjuryData, 
  teamIndex: number, 
  playerIndex: number 
}) {
  const hasLinkedPlayer = !!injury.linkedPlayer;

  const cardContent = (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: (teamIndex * 0.1) + (playerIndex * 0.05) }}
      className={`p-4 transition-all duration-200 ${
        hasLinkedPlayer 
          ? 'hover:bg-blue-50 hover:shadow-md cursor-pointer border-l-4 border-l-blue-400' 
          : 'hover:bg-slate-50'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-3 mb-2">
            <div className="flex items-center space-x-2">
              <h4 className={`text-base font-medium ${hasLinkedPlayer ? 'text-blue-900' : 'text-slate-900'}`}>
                {injury.player}
                {hasLinkedPlayer && (
                  <svg className="w-4 h-4 inline ml-1 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                )}
              </h4>
              {getConfidenceBadge(injury.matchConfidence)}
            </div>
            <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-1 rounded">
              {injury.team_id}
            </span>
          </div>
          
          <div className="flex items-center space-x-4 text-sm mb-2">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-red-500 rounded-full"></div>
              <span className="font-medium text-red-700">{injury.injury_raw}</span>
            </div>
            
            <div className={`px-2 py-1 rounded text-xs font-medium border ${getStatusColor(injury.status)}`}>
              {getFormattedETA(injury)}
            </div>
          </div>

          {/* Player database info if linked */}
          {injury.linkedPlayer && (
            <div className="mt-2 p-2 bg-blue-50 rounded-md border border-blue-200">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-sm font-medium text-blue-900">
                    Database Profile: {injury.linkedPlayer.name}
                  </p>
                  <div className="flex items-center space-x-4 text-xs text-blue-700 mt-1">
                    {injury.linkedPlayer.team && (
                      <span>Team: {injury.linkedPlayer.team}</span>
                    )}
                    {injury.linkedPlayer.position && (
                      <span>Position: {injury.linkedPlayer.position}</span>
                    )}
                    {injury.linkedPlayer.avg && (
                      <span>Avg: {injury.linkedPlayer.avg}</span>
                    )}
                  </div>
                </div>
                <div className="text-blue-600 text-xs">
                  Click to view →
                </div>
              </div>
            </div>
          )}

          {injury.notes && injury.notes !== injury.injury_raw && (
            <p className="mt-2 text-sm text-slate-600">{injury.notes}</p>
          )}
        </div>
      </div>
    </motion.div>
  );

  if (hasLinkedPlayer && injury.linkedPlayer) {
    return (
      <Link 
        href={`/players/${injury.linkedPlayer.id}`}
        className="block hover:no-underline"
      >
        {cardContent}
      </Link>
    );
  }

  return cardContent;
}

export default function LinkedInjuryFeed({ 
  teamFilter, 
  autoRefresh = true 
}: LinkedInjuryFeedProps) {
  const [selectedTeam, setSelectedTeam] = useState<string>(teamFilter || '');
  const [viewMode, setViewMode] = useState<'teams' | 'list'>('teams');
  const [showLinkingStats, setShowLinkingStats] = useState(false);
  
  const { 
    injuries, 
    loading, 
    error, 
    lastUpdated, 
    refresh, 
    count,
    linkingStats
  } = useEnhancedInjuryData({
    teamFilter: selectedTeam || undefined,
    autoRefresh,
    refreshInterval: 300000, // 5 minutes
    enablePlayerLinking: true
  });

  // Group injuries by team
  const injuriesByTeam = injuries.reduce((acc, injury) => {
    if (!acc[injury.team_name]) {
      acc[injury.team_name] = [];
    }
    acc[injury.team_name].push(injury);
    return acc;
  }, {} as Record<string, EnhancedNormalizedInjuryData[]>);

  const teamNames = Object.keys(injuriesByTeam).sort();

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <h2 className="text-xl font-bold text-slate-900">AFL Injury Report</h2>
            {count > 0 && (
              <span className="bg-red-100 text-red-800 text-sm font-medium px-3 py-1 rounded-full">
                {count} injured {count === 1 ? 'player' : 'players'}
              </span>
            )}
            {linkingStats.totalLinked > 0 && (
              <span className="bg-blue-100 text-blue-800 text-sm font-medium px-3 py-1 rounded-full">
                {linkingStats.totalLinked} linked profiles
              </span>
            )}
          </div>
          
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowLinkingStats(!showLinkingStats)}
              className="px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
              title="Show linking statistics"
            >
              📊 Stats
            </button>
            <button
              onClick={refresh}
              disabled={loading}
              className="flex items-center space-x-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
              className="bg-slate-50 border border-slate-200 rounded-lg p-4"
            >
              <h3 className="font-medium text-slate-900 mb-3">Player Linking Statistics</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{linkingStats.exactMatches}</div>
                  <div className="text-slate-600">Exact Matches</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{linkingStats.highConfidenceMatches}</div>
                  <div className="text-slate-600">High Confidence</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-slate-600">{linkingStats.totalLinked}</div>
                  <div className="text-slate-600">Total Linked</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-slate-900">{linkingStats.totalInjuries}</div>
                  <div className="text-slate-600">Total Injuries</div>
                </div>
              </div>
              <div className="mt-3 text-xs text-slate-500">
                Click on linked players (blue border) to view their full profile, stats, and fantasy value.
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
              className="text-sm border border-slate-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Teams</option>
              {AFL_TEAMS.map(team => (
                <option key={team} value={team}>{team}</option>
              ))}
            </select>

            {/* View mode toggle */}
            <div className="flex bg-slate-100 rounded-md p-1">
              <button
                onClick={() => setViewMode('teams')}
                className={`px-3 py-1 text-sm font-medium rounded transition-colors ${
                  viewMode === 'teams'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                By Team
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1 text-sm font-medium rounded transition-colors ${
                  viewMode === 'list'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                List View
              </button>
            </div>
          </div>

          {/* Last updated */}
          {lastUpdated && (
            <div className="text-xs text-slate-500">
              Updated: {new Date(lastUpdated).toLocaleTimeString()}
            </div>
          )}
        </div>

        {/* Data source */}
        <div className="text-xs text-slate-400 border-t border-slate-200 pt-2">
          <span>Data source: Footywire AFL Injury List • Player profiles from Statly database</span>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-sm text-slate-600">Loading injury data and linking players...</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-amber-50 border border-amber-200 rounded-lg"
        >
          <div className="flex items-start space-x-3">
            <div className="w-6 h-6 bg-amber-100 rounded-full flex items-center justify-center">
              <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 18.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <div>
              <h4 className="font-medium text-amber-900">Unable to fetch live data</h4>
              <p className="text-sm text-amber-700 mt-1">{error}</p>
              <p className="text-sm text-amber-600 mt-1">Showing sample data for demonstration</p>
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
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-slate-900 mb-2">
                {selectedTeam ? `No injuries for ${selectedTeam}!` : 'No injuries reported!'}
              </h3>
              <p className="text-slate-600">
                {selectedTeam ? 'This team is currently injury-free.' : 'All players are healthy and available.'}
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
                  className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm"
                >
                  {/* Team Header */}
                  <div className="bg-slate-50 px-6 py-4 border-b border-slate-200">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-slate-900">{teamName}</h3>
                      <div className="flex items-center space-x-2">
                        <span className="bg-slate-100 text-slate-700 text-sm font-medium px-3 py-1 rounded-full">
                          {injuriesByTeam[teamName].length} {injuriesByTeam[teamName].length === 1 ? 'injury' : 'injuries'}
                        </span>
                        {injuriesByTeam[teamName].filter(i => i.linkedPlayer).length > 0 && (
                          <span className="bg-blue-100 text-blue-700 text-sm font-medium px-3 py-1 rounded-full">
                            {injuriesByTeam[teamName].filter(i => i.linkedPlayer).length} linked
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
                <div key={generateInjuryKey(injury, index)} className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                  <InjuryPlayerCard
                    injury={injury}
                    teamIndex={0}
                    playerIndex={index}
                  />
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
