'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrophyIcon,
  ChartBarIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '@/AuthContext';
import { logger } from '@/lib/logger';
import { useUserLeagues } from '@/hooks/useUserLeagues';
import { useTeamRoster } from '@/hooks/useTeamRoster';
import PlayerRow from './PlayerRow';
import type { RowKeyHandler } from './PlayerRow';
import { FixedSizeList as List } from 'react-window';
import type { FixedSizeList, ListChildComponentProps } from 'react-window';

// Enhanced Types for Multi-League Support
interface Player {
  id: string;
  name: string;
  position: string;
  team: string;
  averageScore: number;
  lastGameScore: number;
  projectedScore: number;
  form: number[];
  injuryStatus?: 'healthy' | 'questionable' | 'injured';
  priceChange: number;
  ownership: number;
  captain?: boolean;
  viceCaptain?: boolean;
  pickNumber?: number;
  draftRound?: number;
}

interface League {
  id: string;
  name: string;
  teamName: string;
  status: 'active' | 'completed' | 'draft_pending';
  draftCompleted: boolean;
  memberCount: number;
  maxTeams: number;
}

interface TeamStats {
  totalValue: number;
  weeklyScore: number;
  projectedScore: number;
  rank: number;
  totalPlayers: number;
  averageAge: number;
  teamBalance: {
    forwards: number;
    mids: number;
    defenders: number;
    rucks: number;
  };
}

interface TeamAnalyticsDashboardProps {
  teamPlayers?: Player[];
  teamStats?: TeamStats;
  weeklyMatchup?: {
    opponent: string;
    projectedScore: number;
    opponentProjected: number;
  };
}

// Mock data for demo
const mockTeamPlayers: Player[] = [
  {
    id: '1',
    name: 'Marcus Bontempelli',
    position: 'MID',
    team: 'Western Bulldogs',
    averageScore: 118,
    lastGameScore: 142,
    projectedScore: 115,
    form: [142, 98, 135, 110, 128],
    injuryStatus: 'healthy',
    priceChange: 12000,
    ownership: 67,
    captain: true,
  },
  {
    id: '2',
    name: 'Max Gawn',
    position: 'RUC',
    team: 'Melbourne',
    averageScore: 108,
    lastGameScore: 89,
    projectedScore: 105,
    form: [89, 125, 92, 118, 102],
    injuryStatus: 'healthy',
    priceChange: -8000,
    ownership: 45,
  },
  {
    id: '3',
    name: 'Dustin Martin',
    position: 'FWD',
    team: 'Richmond',
    averageScore: 95,
    lastGameScore: 145,
    projectedScore: 98,
    form: [145, 78, 102, 88, 115],
    injuryStatus: 'questionable',
    priceChange: 5000,
    ownership: 23,
    viceCaptain: true,
  },
];

const mockTeamStats: TeamStats = {
  totalValue: 8450000,
  weeklyScore: 2156,
  projectedScore: 2189,
  rank: 15847,
  totalPlayers: 30,
  averageAge: 25.8,
  teamBalance: {
    forwards: 8,
    mids: 10,
    defenders: 8,
    rucks: 4,
  },
};

// Lightweight loading skeletons (local to this component)
function LeagueSelectorSkeleton() {
  return (
    <div className="animate-pulse space-y-2">
      <div className="h-5 w-48 bg-gray-200 rounded" />
      <div className="flex items-center gap-3 mt-2">
        <div className="h-10 w-64 bg-gray-200 rounded" />
        <div className="h-10 w-10 bg-gray-200 rounded-full" />
      </div>
    </div>
  );
}

function PlayerRowSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <div
      className="grid grid-cols-12 gap-4 p-4 border-b border-gray-100"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="col-span-3">
        <div className="h-4 bg-gray-200 rounded w-40" />
        <div className="mt-2 h-3 bg-gray-200 rounded w-24" />
      </div>
      <div className="col-span-2">
        <div className="h-4 bg-gray-200 rounded w-16" />
      </div>
      <div className="col-span-2">
        <div className="h-4 bg-gray-200 rounded w-12" />
      </div>
      <div className="col-span-2">
        <div className="h-4 bg-gray-200 rounded w-12" />
      </div>
      <div className="col-span-2">
        <div className="h-4 bg-gray-200 rounded w-16" />
      </div>
      <div className="col-span-1">
        <div className="h-4 bg-gray-200 rounded w-6" />
      </div>
    </div>
  );
}

function PlayerListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div>
      <div
        className="grid grid-cols-12 gap-4 p-4 bg-gray-50 text-sm font-medium text-gray-600"
        role="rowgroup"
      >
        <div className="col-span-3">Player</div>
        <div className="col-span-2">Position</div>
        <div className="col-span-2">Avg Score</div>
        <div className="col-span-2">Form</div>
        <div className="col-span-2">Price Change</div>
        <div className="col-span-1">Status</div>
      </div>
      {Array.from({ length: count }).map((_, i) => (
        <PlayerRowSkeleton key={`skeleton-${i}`} delay={i * 30} />
      ))}
    </div>
  );
}

export default function TeamAnalyticsDashboard({
  teamPlayers: propTeamPlayers,
  teamStats: propTeamStats,
  weeklyMatchup,
}: TeamAnalyticsDashboardProps) {
  const { user: authUser } = useAuth();
  const [user, setUser] = useState(authUser ?? null);

  // Initialize user selection safely on client only
  useEffect(() => {
    setUser(authUser ?? null);

    if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const requestedUser = urlParams.get('user') || localStorage.getItem('preferredUser');
        if (requestedUser === 'addison' || requestedUser === 'addisonarmadale') {
          // Use a dev preset user object; avoid embedding real PII in code
          const devUser = {
            uid: 'addison_real_user_id',
            email: 'dev-addison@example.test',
            displayName: 'Addison (dev)',
          } as { uid: string; email: string; displayName?: string };
          // Cast intentionally for dev-only override to satisfy auth user shape in state
          setUser(devUser as unknown as typeof authUser);
        }
      } catch (_err) {
        // Non-fatal
        logger.debug('Failed to read dev user param', { error: String(_err) });
      }
    }
  }, [authUser]);

  const [selectedLeague, setSelectedLeague] = useState<string | null>(null);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [teamPlayers, setTeamPlayers] = useState<Player[]>(propTeamPlayers || mockTeamPlayers);
  const [teamStats, setTeamStats] = useState<TeamStats>(propTeamStats || mockTeamStats);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'players' | 'analytics' | 'trades'>(
    'overview'
  );
  const [sortBy, setSortBy] = useState<'score' | 'form' | 'price' | 'projected'>('score');
  const [liveMessage, setLiveMessage] = useState<string>('');

  // Fetch user leagues via hook
  const {
    leagues: fetchedLeagues,
    loading: leaguesLoading,
    error: leaguesError,
  } = useUserLeagues(user?.uid);

  useEffect(() => {
    if (fetchedLeagues.length > 0) {
      setLeagues(fetchedLeagues as League[]);
      if (!selectedLeague) setSelectedLeague(fetchedLeagues[0].id);
    }
    if (leaguesError) {
      logger.error(
        'TeamAnalyticsDashboard: failed to load leagues',
        leaguesError as unknown as Error
      );
      setError(leaguesError);
    }
    setLoading(leaguesLoading);
  }, [fetchedLeagues, leaguesLoading, leaguesError, selectedLeague]);

  // Fetch team roster for selected league
  const {
    players: rosterPlayers,
    loading: rosterLoading,
    error: rosterError,
  } = useTeamRoster(selectedLeague || undefined, user?.uid || undefined);

  useEffect(() => {
    if (propTeamPlayers && propTeamPlayers.length > 0) {
      setTeamPlayers(propTeamPlayers);
      setTeamStats(propTeamStats || mockTeamStats);
      return;
    }

    if (rosterPlayers.length > 0) {
      setTeamPlayers(rosterPlayers as Player[]);
      setTeamStats(calculateTeamStats(rosterPlayers as Player[]));
    } else if (!rosterLoading) {
      setTeamPlayers(mockTeamPlayers);
    }

    if (rosterError) {
      logger.error(
        'TeamAnalyticsDashboard: failed to load roster',
        rosterError as unknown as Error
      );
      setError(rosterError);
    }

    setLoading(rosterLoading || leaguesLoading);
  }, [rosterPlayers, rosterLoading, rosterError, propTeamPlayers, propTeamStats, leaguesLoading]);

  // Calculate team stats from player data
  const calculateTeamStats = (players: Player[]): TeamStats => {
    const totalPlayers = players.length;
    const totalScore = players.reduce((sum, p) => sum + p.lastGameScore, 0);
    const projectedScore = players.reduce((sum, p) => sum + p.projectedScore, 0);

    const positions = players.reduce(
      (acc, p) => {
        const pos = p.position.toLowerCase();
        if (pos.includes('fwd')) acc.forwards++;
        else if (pos.includes('mid')) acc.mids++;
        else if (pos.includes('def')) acc.defenders++;
        else if (pos.includes('ruc')) acc.rucks++;
        return acc;
      },
      { forwards: 0, mids: 0, defenders: 0, rucks: 0 }
    );

    return {
      totalValue: players.reduce((sum, p) => sum + (p.priceChange + 500000), 0), // Estimate
      weeklyScore: totalScore,
      projectedScore,
      rank: 1, // Would need league context
      totalPlayers,
      averageAge: 24, // Would need player age data
      teamBalance: positions,
    };
  };

  // Calculate team insights
  const teamInsights = useMemo(() => {
    const injured = teamPlayers.filter(
      (p) => p.injuryStatus === 'injured' || p.injuryStatus === 'questionable'
    ).length;
    const risingStars = teamPlayers.filter((p) => p.priceChange > 10000).length;
    const concerns = teamPlayers.filter((p) => {
      const recentForm = p.form.slice(-3).reduce((a, b) => a + b, 0) / 3;
      return recentForm < p.averageScore * 0.85;
    }).length;

    return { injured, risingStars, concerns };
  }, [teamPlayers]);

  // Sort players
  const sortedPlayers = useMemo(() => {
    return [...teamPlayers].sort((a, b) => {
      switch (sortBy) {
        case 'score':
          return b.averageScore - a.averageScore;
        case 'form': {
          const aForm = a.form.slice(-3).reduce((acc, val) => acc + val, 0) / 3;
          const bForm = b.form.slice(-3).reduce((acc, val) => acc + val, 0) / 3;
          return bForm - aForm;
        }
        case 'price':
          return b.priceChange - a.priceChange;
        case 'projected':
          return b.projectedScore - a.projectedScore;
        default:
          return 0;
      }
    });
  }, [teamPlayers, sortBy]);

  const getFormTrend = useCallback((form: number[]) => {
    if (form.length <= 3) return 'stable';
    const recent = form.slice(-3).reduce((a, b) => a + b, 0) / 3;
    const previous = form.slice(0, -3).reduce((a, b) => a + b, 0) / (form.length - 3);
    if (recent > previous * 1.1) return 'rising';
    if (recent < previous * 0.9) return 'falling';
    return 'stable';
  }, []);

  const getInjuryIcon = useCallback((status?: string) => {
    switch (status) {
      case 'injured':
        return <ExclamationTriangleIcon className="w-4 h-4 text-red-500" />;
      case 'questionable':
        return <ClockIcon className="w-4 h-4 text-yellow-500" />;
      default:
        return <ShieldCheckIcon className="w-4 h-4 text-green-500" />;
    }
  }, []);

  // Keyboard & focus management for the players list
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const listRef = useRef<FixedSizeList<Player[]> | null>(null);
  const [rowHeight, setRowHeight] = useState<number>(72); // dynamic measured row height
  const sampleRowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (focusedRow !== null) {
      // Ensure the virtualized list scrolls the item into view before focusing
      try {
        // Use a guarded call since the list instance shape is unknown
        const _inst = listRef.current as {
          scrollToItem?: (index: number, align?: 'auto' | 'start' | 'center' | 'end') => void;
        } | null;
        if (_inst && typeof _inst.scrollToItem === 'function')
          _inst.scrollToItem(focusedRow, 'center');
      } catch (_err) {
        // non-fatal if scroll fails in some environments
      }

      // Focus the DOM node after the scroll completes
      requestAnimationFrame(() => {
        const el = rowRefs.current[focusedRow];
        if (el && typeof el.focus === 'function') el.focus();
      });
    }
  }, [focusedRow]);

  // Announce focused player for screen readers
  useEffect(() => {
    if (focusedRow !== null && sortedPlayers[focusedRow]) {
      const p = sortedPlayers[focusedRow];
      setLiveMessage(`${p.name}, ${p.position}, ${p.team || 'Unknown team'}`);
      // clear message after a short delay to allow re-announcements later
      const t = setTimeout(() => setLiveMessage(''), 1000);
      return () => clearTimeout(t);
    }
    setLiveMessage('');
  }, [focusedRow, sortedPlayers]);

  // Ensure the refs array tracks the current list length after render
  useEffect(() => {
    rowRefs.current.length = sortedPlayers.length;
  }, [sortedPlayers.length]);

  // Keyboard handler stable for VirtualizedRow - defined before VirtualizedRow
  const onRowKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, idx: number, player: Player) => {
      const last = sortedPlayers.length - 1;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedRow((prev) => Math.min((prev ?? idx) + 1, last));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedRow((prev) => Math.max((prev ?? idx) - 1, 0));
      } else if (e.key === 'Home') {
        e.preventDefault();
        setFocusedRow(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setFocusedRow(last);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        logger.debug('TeamAnalyticsDashboard: player row activated', {
          playerId: player.id,
          name: player.name,
        });
      }
    },
    [sortedPlayers]
  );

  // Adapter used by react-window to render rows
  const itemData = useMemo(() => sortedPlayers, [sortedPlayers]);

  const VirtualizedRowInner = React.memo(function VirtualizedRowInner({
    index,
    style,
    data,
  }: ListChildComponentProps<Player[]>) {
    const players = data;
    const player: Player = players[index];
    return (
      <div style={style} role="row" aria-rowindex={index + 1}>
        <PlayerRow
          player={player}
          index={index}
          focused={focusedRow === index}
          setRef={(el: HTMLDivElement | null) => {
            rowRefs.current[index] = el;
          }}
          onKeyDown={onRowKeyDown as RowKeyHandler}
          getInjuryIcon={getInjuryIcon}
          getFormTrend={getFormTrend}
        />
      </div>
    );
  });
  VirtualizedRowInner.displayName = 'VirtualizedRowInner';

  // Use the memoized inner renderer directly for the List
  const VirtualizedRow = VirtualizedRowInner;

  // Measure a sample row's height on first render to support variable row sizes
  useEffect(() => {
    if (sampleRowRef.current) {
      const h = sampleRowRef.current.getBoundingClientRect().height;
      if (h && h > 0) setRowHeight(Math.round(h));
    }
    // Re-measure on window resize
    const onResize = () => {
      if (sampleRowRef.current) {
        const h = sampleRowRef.current.getBoundingClientRect().height;
        if (h && h > 0) setRowHeight(Math.round(h));
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Screen reader live region for focus changes */}
      <div aria-live="polite" aria-atomic="true" role="status" className="sr-only">
        {liveMessage}
      </div>

      {/* League Selector - Multi-League Support */}
      {user && !propTeamPlayers && leagues.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">League Selection</h2>
              <p className="text-sm text-gray-600">Switch between your different league teams</p>
            </div>
            <div className="flex items-center gap-3">
              {leaguesLoading ? (
                <LeagueSelectorSkeleton />
              ) : (
                <>
                  <label className="sr-only" htmlFor="league-select">
                    Select League
                  </label>
                  <select
                    id="league-select"
                    aria-label="Select League"
                    value={selectedLeague || ''}
                    onChange={(e) => setSelectedLeague(e.target.value)}
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select a league...</option>
                    {leagues.map((league) => (
                      <option key={league.id} value={league.id}>
                        {league.name} - {league.teamName || 'My Team'}
                        {league.draftCompleted ? ' (Draft Complete)' : ' (Draft Pending)'}
                      </option>
                    ))}
                  </select>
                  {loading && (
                    <ArrowPathIcon
                      role="status"
                      aria-hidden
                      className="w-5 h-5 text-blue-500 animate-spin"
                    />
                  )}
                </>
              )}
            </div>
          </div>

          {error && (
            <div role="alert" className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {selectedLeague && (
            <div className="mt-3 text-sm text-gray-600">
              Showing team for:{' '}
              <span className="font-medium text-gray-900">
                {leagues.find((l) => l.id === selectedLeague)?.name}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">My Team</h1>
          <p className="text-gray-600 mt-1">
            {selectedLeague
              ? `Team analytics for ${leagues.find((l) => l.id === selectedLeague)?.name || 'Selected League'}`
              : 'Comprehensive team overview and analytics'}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-2xl font-bold text-green-600">
              ${(teamStats.totalValue / 1000000).toFixed(2)}M
            </div>
            <div className="text-sm text-gray-500">Team Value</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-blue-600">
              #{teamStats.rank.toLocaleString()}
            </div>
            <div className="text-sm text-gray-500">Overall Rank</div>
          </div>
        </div>
      </div>

      {/* Quick Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-blue-500"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Weekly Score</p>
              <p className="text-2xl font-bold text-gray-900">{teamStats.weeklyScore}</p>
              <p className="text-sm text-green-600">
                ↗ +{teamStats.projectedScore - teamStats.weeklyScore} projected
              </p>
            </div>
            <ChartBarIcon className="w-8 h-8 text-blue-500" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-green-500"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Rising Stars</p>
              <p className="text-2xl font-bold text-gray-900">{teamInsights.risingStars}</p>
              <p className="text-sm text-gray-500">Players increasing in value</p>
            </div>
            <ArrowTrendingUpIcon className="w-8 h-8 text-green-500" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-yellow-500"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Injury Concerns</p>
              <p className="text-2xl font-bold text-gray-900">{teamInsights.injured}</p>
              <p className="text-sm text-gray-500">Players with injury status</p>
            </div>
            <ExclamationTriangleIcon className="w-8 h-8 text-yellow-500" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-red-500"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Form Concerns</p>
              <p className="text-2xl font-bold text-gray-900">{teamInsights.concerns}</p>
              <p className="text-sm text-gray-500">Players below average</p>
            </div>
            <ArrowTrendingDownIcon className="w-8 h-8 text-red-500" />
          </div>
        </motion.div>
      </div>

      {/* Weekly Matchup */}
      {weeklyMatchup && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl p-6 border border-purple-200"
        >
          <h3 className="text-lg font-semibold text-gray-900 mb-4">This Week&apos;s Matchup</h3>
          <div className="flex items-center justify-between">
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {weeklyMatchup.projectedScore}
              </div>
              <div className="text-sm text-gray-600">Your Projected</div>
            </div>
            <div className="text-center">
              <div className="text-lg text-gray-500">VS</div>
              <div className="text-sm text-gray-600">{weeklyMatchup.opponent}</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {weeklyMatchup.opponentProjected}
              </div>
              <div className="text-sm text-gray-600">Opponent Projected</div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Team tabs"
        className="flex space-x-1 bg-gray-100 p-1 rounded-lg"
      >
        {[
          { id: 'overview', label: 'Team Overview' },
          { id: 'players', label: 'Player Analysis' },
          { id: 'analytics', label: 'Performance Analytics' },
          { id: 'trades', label: 'Trade Opportunities' },
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          const classes =
            'flex-1 px-4 py-2 rounded-md font-medium transition-colors ' +
            (isActive ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900');
          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={classes}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'players' && (
          <motion.div
            key="players"
            id={`panel-players`}
            role="tabpanel"
            aria-labelledby={`tab-players`}
            tabIndex={activeTab === 'players' ? 0 : -1}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-4"
          >
            {/* Sort Controls */}
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-700">Sort by:</span>
              <select
                value={sortBy}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  setSortBy(e.target.value as typeof sortBy)
                }
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="score">Average Score</option>
                <option value="form">Recent Form</option>
                <option value="price">Price Change</option>
                <option value="projected">Projected Score</option>
              </select>
            </div>

            {/* Players List */}
            <div className="bg-white rounded-xl shadow-lg overflow-hidden">
              <div
                className="grid grid-cols-12 gap-4 p-4 bg-gray-50 text-sm font-medium text-gray-600"
                role="rowgroup"
              >
                <div className="col-span-3">Player</div>
                <div className="col-span-2">Position</div>
                <div className="col-span-2">Avg Score</div>
                <div className="col-span-2">Form</div>
                <div className="col-span-2">Price Change</div>
                <div className="col-span-1">Status</div>
              </div>
              {/* Virtualized list for large rosters with focus sentinels */}
              <div role="rowgroup" aria-label="Players list" className="relative">
                {/* offscreen sample row used to measure height */}
                <div
                  ref={sampleRowRef}
                  className="absolute left-[-9999px] top-0 opacity-0 pointer-events-none"
                >
                  <PlayerRow
                    player={sortedPlayers[0] || mockTeamPlayers[0]}
                    index={0}
                    focused={false}
                    setRef={() => {}}
                    onKeyDown={() => {}}
                    getInjuryIcon={getInjuryIcon}
                    getFormTrend={getFormTrend}
                  />
                </div>

                {/* sentinel that focuses the active row when tabbing in */}
                <div
                  tabIndex={0}
                  className="sr-only"
                  aria-label="Enter players list"
                  onFocus={() => {
                    if (focusedRow !== null) {
                      const el = rowRefs.current[focusedRow];
                      if (el && typeof el.focus === 'function') el.focus();
                    } else {
                      setFocusedRow(0);
                    }
                  }}
                />

                <List
                  height={Math.min(sortedPlayers.length * rowHeight, 600)}
                  itemCount={sortedPlayers.length}
                  itemSize={rowHeight}
                  width={'100%'}
                  itemData={itemData}
                  overscanCount={8}
                  ref={listRef}
                  itemKey={(index, data) => (data as Player[])[index]?.id ?? index}
                >
                  {VirtualizedRow}
                </List>

                {/* sentinel after list to focus last row when tabbing out backwards */}
                <div
                  tabIndex={0}
                  className="sr-only"
                  aria-label="Exit players list"
                  onFocus={() => {
                    const last = sortedPlayers.length - 1;
                    if (last >= 0) {
                      const el = rowRefs.current[last];
                      if (el && typeof el.focus === 'function') el.focus();
                      setFocusedRow(last);
                    }
                  }}
                />
              </div>

              {/* refs array is resized in a post-render effect: useEffect(() => { rowRefs.current.length = sortedPlayers.length }, [sortedPlayers.length]) */}
            </div>
          </motion.div>
        )}

        {activeTab === 'overview' && (
          <motion.div
            key="overview"
            id={`panel-overview`}
            role="tabpanel"
            aria-labelledby={`tab-overview`}
            tabIndex={activeTab === 'overview' ? 0 : -1}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-6"
          >
            {/* Team Balance */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Team Balance</h3>
              <div className="space-y-4">
                {Object.entries(teamStats.teamBalance as Record<string, number>).map(
                  ([position, count]) => (
                    <div key={position} className="flex items-center justify-between">
                      <span className="text-gray-600 capitalize">{position}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full"
                            style={{ width: `${(count / 10) * 100}%` }}
                          />
                        </div>
                        <span className="font-medium text-gray-900">{count}</span>
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
              <div className="grid grid-cols-1 gap-3">
                <button className="flex items-center justify-between p-3 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">
                  <span className="font-medium text-blue-900">Set Captain & Vice</span>
                  <TrophyIcon className="w-5 h-5 text-blue-600" />
                </button>
                <button className="flex items-center justify-between p-3 bg-green-50 hover:bg-green-100 rounded-lg transition-colors">
                  <span className="font-medium text-green-900">Make Trades</span>
                  <ArrowTrendingUpIcon className="w-5 h-5 text-green-600" />
                </button>
                <button className="flex items-center justify-between p-3 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors">
                  <span className="font-medium text-purple-900">View Projections</span>
                  <ChartBarIcon className="w-5 h-5 text-purple-600" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
