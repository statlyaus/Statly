'use client';

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';

import { motion, AnimatePresence } from 'framer-motion';

import { Badge } from '@/components/ui';
import { useLiveData } from '@/hooks/useLiveData';
import { formatInTimezone, getBrowserTimeZone } from '@/lib/timezone';

// Normalize disposals across sources (fallback to kicks + handballs)
function getDisposals(p: { disposals?: number; kicks?: number; handballs?: number }): number {
  if (typeof p?.disposals === 'number') return p.disposals;
  const k = p?.kicks ?? 0;
  const h = p?.handballs ?? 0;
  return k + h;
}

// Types
interface LivePlayer {
  id: string;
  name: string;
  team: string;
  position: string;
  fantasyScore: number;
  realTimeStats: {
    disposals: number;
    marks: number;
    tackles: number;
    goals: number;
    behinds: number;
    hitouts?: number;
  };
  isPlaying: boolean;
  injuryStatus?: 'injured' | 'substituted';
}

interface RealTimeMatchCenterProps {
  selectedLeague?: string;
  favoriteTeams?: string[];
  watchlistPlayers?: string[];
  onPlayerSelect?: (player: LivePlayer) => void;
}

export default function RealTimeMatchCenter({
  selectedLeague: _selectedLeague,
  favoriteTeams: _favoriteTeams = [],
  watchlistPlayers = [],
  onPlayerSelect,
}: RealTimeMatchCenterProps) {
  const [activeTab, setActiveTab] = useState<'matches' | 'live-players' | 'my-players'>('matches');

  // Live data from ETL (polling)
  const { playerStats, liveMatches, isLive, lastUpdate, isLoading, error, refresh } = useLiveData({
    enablePolling: true,
    transformToLegacy: true,
  });

  // Determine and memoize the user's timezone for consistent date formatting
  const timeZone = useMemo(() => getBrowserTimeZone(), []);

  // Stable ref to latest onPlayerSelect to avoid extra deps in callbacks
  const onSelectRef = useRef(onPlayerSelect);
  useEffect(() => {
    onSelectRef.current = onPlayerSelect;
  }, [onPlayerSelect]);

  // Build a Set for O(1) membership checks
  const watchSet = useMemo(() => new Set(watchlistPlayers), [watchlistPlayers]);

  const myPlayers = useMemo(() => {
    if (!watchlistPlayers.length) return [];
    return playerStats.filter((p) => watchSet.has(p.id));
  }, [playerStats, watchSet, watchlistPlayers.length]);

  // Tabs model and keyboard navigation
  const tabs = useMemo(
    () =>
      [
        { id: 'matches', label: 'Live Matches', count: liveMatches.length },
        { id: 'live-players', label: 'Top Performers', count: playerStats.length },
        { id: 'my-players', label: 'My Players', count: myPlayers.length },
      ] as const,
    [liveMatches.length, playerStats.length, myPlayers.length]
  );
  const tabsLength = tabs.length;
  const tabRefs = useRef<HTMLButtonElement[]>([]);
  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent, idx: number) => {
      let targetIdx = idx;
      switch (e.key) {
        case 'ArrowRight':
        case 'Right':
          targetIdx = (idx + 1) % tabsLength;
          e.preventDefault();
          break;
        case 'ArrowLeft':
        case 'Left':
          targetIdx = (idx - 1 + tabsLength) % tabsLength;
          e.preventDefault();
          break;
        case 'Home':
          targetIdx = 0;
          e.preventDefault();
          break;
        case 'End':
          targetIdx = tabsLength - 1;
          e.preventDefault();
          break;
        case 'Enter':
        case ' ': // Space
          setActiveTab(tabs[idx].id as typeof activeTab);
          return; // don't change focus
        default:
          return;
      }
      tabRefs.current[targetIdx]?.focus();
      setActiveTab(tabs[targetIdx].id as typeof activeTab);
    },
    [tabs, tabsLength, setActiveTab]
  );

  // Card component with memoized click handler
  const LivePlayerCard = ({
    p,
    isWatched,
  }: {
    p: (typeof playerStats)[number];
    isWatched: boolean;
  }) => {
    const handleClick = useCallback(() => {
      onSelectRef.current?.({
        id: p.id,
        name: p.name,
        team: p.team,
        position: p.position,
        fantasyScore: p.fantasyScore,
        realTimeStats: {
          disposals: getDisposals(p),
          marks: p.marks,
          tackles: p.tackles,
          goals: p.goals,
          behinds: p.behinds,
          hitouts: p.hitouts,
        },
        isPlaying: true,
      });
    }, [p]);

    return (
      <motion.div
        key={p.id}
        layout
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow cursor-pointer"
        onClick={handleClick}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="font-semibold text-gray-900">{p.name}</div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>{p.team}</span>
              <Badge variant="outline" size="sm">
                {p.position}
              </Badge>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-green-600">{p.fantasyScore}</div>
            <div className="text-xs text-gray-500">Fantasy Pts</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="text-center">
            <div className="font-medium text-gray-900">{getDisposals(p)}</div>
            <div className="text-gray-500">Disposals</div>
          </div>
          <div className="text-center">
            <div className="font-medium text-gray-900">{p.marks}</div>
            <div className="text-gray-500">Marks</div>
          </div>
          <div className="text-center">
            <div className="font-medium text-gray-900">{p.goals}</div>
            <div className="text-gray-500">Goals</div>
          </div>
        </div>

        {isWatched && (
          <div className="mt-3 flex items-center gap-1">
            <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            <span className="text-xs text-yellow-600">Watchlist</span>
          </div>
        )}
      </motion.div>
    );
  };

  const matchesSection = (
    <motion.div
      key="matches"
      id="tabpanel-matches"
      role="tabpanel"
      aria-labelledby="tab-matches"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6"
    >
      {liveMatches.length > 0 ? (
        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Live Now</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {liveMatches.map((m) => (
              <motion.div
                key={`${m.home_team}-${m.away_team}-${m.start_time_utc}`}
                layout
                className="bg-white rounded-lg border-2 p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="success" className="animate-pulse">
                      LIVE
                    </Badge>
                    <span className="text-sm text-gray-600">
                      {formatInTimezone(new Date(m.start_time_utc), timeZone)}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-3 items-center gap-4">
                  <div className="text-right">
                    <div className="font-semibold text-gray-900">{m.home_team}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-gray-400 text-sm">vs</div>
                  </div>
                  <div className="text-left">
                    <div className="font-semibold text-gray-900">{m.away_team}</div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-12">
          <div className="text-gray-400 text-lg mb-2">No live matches</div>
          <div className="text-gray-500">Check back during the AFL season for live updates</div>
        </div>
      )}
    </motion.div>
  );

  const topPerformersSection = (
    <motion.div
      key="live-players"
      id="tabpanel-live-players"
      role="tabpanel"
      aria-labelledby="tab-live-players"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {playerStats.slice(0, 12).map((p) => (
          <LivePlayerCard key={p.id} p={p} isWatched={watchSet.has(p.id)} />
        ))}
      </div>
    </motion.div>
  );

  const myPlayersSection = (
    <motion.div
      key="my-players"
      id="tabpanel-my-players"
      role="tabpanel"
      aria-labelledby="tab-my-players"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="min-h-[200px]"
    >
      {myPlayers.length ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {myPlayers.map((p) => (
            <LivePlayerCard key={p.id} p={p} isWatched={true} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <div className="text-gray-400 text-lg mb-2">Your watchlist is empty</div>
          <div className="text-gray-500">
            Add players to your watchlist to see their live scores here
          </div>
        </div>
      )}
    </motion.div>
  );

  const formattedLastUpdate = useMemo(
    () => (lastUpdate ? formatInTimezone(new Date(lastUpdate), timeZone, 'p') : ''),
    [lastUpdate, timeZone]
  );

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Live Match Center</h1>
          <p className="text-gray-600 mt-1">Real-time scores and fantasy updates</p>
        </div>
        <div className="text-sm text-gray-500">
          {isLoading ? (
            'Loading…'
          ) : error ? (
            <>
              Error loading live data
              <button
                onClick={refresh}
                className="ml-2 text-blue-600 hover:underline disabled:opacity-60"
                disabled={isLoading}
              >
                Retry
              </button>
            </>
          ) : isLive ? (
            <>Live • Updated {formattedLastUpdate}</>
          ) : (
            'Not live'
          )}
        </div>
      </div>

      <div
        className="flex space-x-1 bg-gray-100 p-1 rounded-lg mb-6"
        role="tablist"
        aria-label="Live sections"
      >
        {tabs.map((tab, idx) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`tabpanel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            ref={(el) => {
              if (el) tabRefs.current[idx] = el;
            }}
            onKeyDown={(e) => handleTabKeyDown(e, idx)}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count > 0 && (
              <Badge variant="secondary" size="sm">
                {tab.count}
              </Badge>
            )}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'matches' && matchesSection}
        {activeTab === 'live-players' && topPerformersSection}
        {activeTab === 'my-players' && myPlayersSection}
      </AnimatePresence>
    </div>
  );
}
