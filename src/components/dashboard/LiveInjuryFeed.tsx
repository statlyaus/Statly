import { useState } from 'react';
import { motion } from 'framer-motion';
import { useInjuryData } from '@/hooks/useInjuryData';
import InjuryListDisplay from './InjuryListDisplay';

interface LiveInjuryFeedProps {
  refreshTrigger: number;
  teamFilter?: string;
  userTeamPlayers?: string[];
  autoRefresh?: boolean;
}

const AFL_TEAMS = [
  'Adelaide', 'Brisbane', 'Carlton', 'Collingwood', 'Essendon', 'Fremantle',
  'Geelong', 'Gold Coast', 'GWS', 'Hawthorn', 'Melbourne', 'North Melbourne',
  'Port Adelaide', 'Richmond', 'St Kilda', 'Sydney', 'West Coast', 'Western Bulldogs'
];

export default function LiveInjuryFeed({ 
  refreshTrigger: _refreshTrigger, 
  teamFilter, 
  userTeamPlayers: _userTeamPlayers,
  autoRefresh = true 
}: LiveInjuryFeedProps) {
  const [selectedTeam, setSelectedTeam] = useState<string>(teamFilter || '');
  
  const { 
    injuries, 
    loading, 
    error, 
    lastUpdated, 
    refresh, 
    count 
  } = useInjuryData({
    teamFilter: selectedTeam || undefined,
    autoRefresh,
    refreshInterval: 300000 // 5 minutes
  });

  // Debug logging to console
  console.log('LiveInjuryFeed - injuries data:', injuries);
  console.log('LiveInjuryFeed - count:', count);
  console.log('LiveInjuryFeed - loading:', loading);
  console.log('LiveInjuryFeed - error:', error);

  return (
    <div className="space-y-4">
      {/* Header with controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <h3 className="text-lg font-semibold text-slate-900">Live Injury Feed</h3>
          {count > 0 && (
            <span className="bg-red-100 text-red-800 text-xs font-medium px-2 py-1 rounded-full">
              {count} injuries
            </span>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          {/* Team filter dropdown */}
          <select
            value={selectedTeam}
            onChange={(e) => setSelectedTeam(e.target.value)}
            className="text-sm border border-slate-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Teams</option>
            {AFL_TEAMS.map(team => (
              <option key={team} value={team}>{team}</option>
            ))}
          </select>
          
          {/* Refresh button */}
          <button
            onClick={refresh}
            disabled={loading}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md disabled:opacity-50"
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
          </button>
        </div>
      </div>

      {/* Data source and last updated info */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Source: Footywire AFL Injury List</span>
        {lastUpdated && (
          <span>
            Updated: {new Date(lastUpdated).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="text-center py-6">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
          <p className="text-sm text-slate-600">Loading injury data...</p>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg"
        >
          <div className="flex items-start space-x-3">
            <div className="w-6 h-6 bg-yellow-100 rounded-full flex items-center justify-center">
              <svg className="w-4 h-4 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 18.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <div>
              <h4 className="font-medium text-yellow-900">Data fetch issue</h4>
              <p className="text-sm text-yellow-700 mt-1">{error}</p>
              <p className="text-sm text-yellow-600 mt-1">Showing cached or sample data</p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Injury data display */}
      {!loading && (
        <InjuryListDisplay 
          injuries={injuries}
          groupByTeam={true}
        />
      )}

      {/* Empty state for filtered results */}
      {!loading && !error && injuries.length === 0 && selectedTeam && (
        <div className="text-center py-6">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h4 className="font-medium text-slate-900 mb-1">No injuries for {selectedTeam}!</h4>
          <p className="text-sm text-slate-600">Great news - no current injury concerns</p>
        </div>
      )}
    </div>
  );
}
