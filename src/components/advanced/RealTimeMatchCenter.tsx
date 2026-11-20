'use client';

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Badge from '@/components/ui/Badge';
import { useLiveData } from '@/hooks/useLiveData';
import { formatInTimezone, getBrowserTimeZone } from '@/lib/timezone';
import type { LegacyPlayerStat } from '@/lib/etlIntegration';
import { FANTASY_CATEGORIES, REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

// Types
interface LivePlayer {
  id: string;
  name: string;
  team: string;
  position: string;
  /** The nine league categories; null when the provider did not report the stat. */
  categories: LegacyPlayerStat['categories'];
  hitouts: number | null;
  isPlaying: boolean;
  injuryStatus?: 'injured' | 'substituted';
}

interface RealTimeMatchCenterProps {
  favoriteTeams?: string[];
  onPlayerSelect?: (player: LivePlayer) => void;
}

export default function RealTimeMatchCenter({
  favoriteTeams: _favoriteTeams = [],
  onPlayerSelect,
}: RealTimeMatchCenterProps) {
  const [activeTab, setActiveTab] = useState<'matches' | 'live-players'>('matches');

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

  // Tabs model and keyboard navigation
  const tabs = useMemo(
    () =>
      [
        { id: 'matches', label: 'Live Matches', count: liveMatches.length },
        { id: 'live-players', label: 'Players', count: playerStats.length },
      ] as const,
    [liveMatches.length, playerStats.length]
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
  const LivePlayerCard = ({ p }: { p: (typeof playerStats)[number] }) => {
    const handleClick = useCallback(() => {
      onSelectRef.current?.({
        id: p.id,
        name: p.name,
        team: p.team,
        position: p.position,
        categories: p.categories,
        hitouts: p.hitouts,
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
              {p.position && (
                <Badge variant="outline" size="sm">
                  {p.position}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-2 text-sm">
          {REAL_DATA_NINE_CATEGORY_PRESET.map((key) => (
            <div key={key} className="text-center">
              <div className="font-medium text-gray-900">{p.categories[key] ?? '-'}</div>
              <div className="text-gray-500" title={FANTASY_CATEGORIES[key].label}>
                {FANTASY_CATEGORIES[key].shortLabel}
              </div>
            </div>
          ))}
          <div className="text-center">
            <div className="font-medium text-gray-900">{p.hitouts ?? '-'}</div>
            <div className="text-gray-500" title="Hit-outs">
              HO
            </div>
          </div>
        </div>
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
          <LivePlayerCard key={p.id} p={p} />
        ))}
      </div>
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
          <h2 className="text-3xl font-bold text-gray-900">Live Match Centre</h2>
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
                className="ml-2 text-primary hover:underline disabled:opacity-60"
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
        className="flex max-w-full space-x-1 overflow-x-auto overscroll-x-contain rounded-lg bg-gray-100 p-1 mb-6"
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
                ? 'bg-white text-primary shadow-sm'
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
      </AnimatePresence>
    </div>
  );
}
