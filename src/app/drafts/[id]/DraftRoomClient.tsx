'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/AuthContext';
import { throttledReload } from '@/lib/throttledReload';
import { computeSnakeState } from '@/lib/snakeDraft';
import Tabs from '@/components/Tabs';
import Table from '@/components/Table';
import Modal from '@/components/Modal';
import { useAlert, useConfirmation, AlertContainer } from '@/components/ui';
import ConnectionStatus from '@/components/draft/ConnectionStatus';
import Button from '@/components/Button';
import LivePickHeader from '@/components/LivePickHeader';
import PickFeed from '@/components/PickFeed';
import DraftWatchlist, { useWatchlist } from '@/components/DraftWatchlist';
import { calculateTotalValue, FANTASY_CATEGORIES } from '@/types/fantasyCategories';
import FantasyLeagueSettings from '@/components/FantasyLeagueSettings';
import { useRealtimeDraft } from '@/hooks/useRealtimeDraft';
import { useDraftedPlayerAlerts } from '@/hooks/useDraftedPlayerAlerts';
import { WatchlistPlayerAlert } from '@/components/alerts/WatchlistPlayerAlert';
import type { PlayerStats, LeagueSettings } from '@/types/fantasyCategories';

interface DraftPlayer {
  id: string;
  name: string;
  position: string;
  club: string;
  stats?: PlayerStats;
  injuryStatus?: 'healthy' | 'questionable' | 'injured' | 'out';
  isAvailable?: boolean;
  recommendationScore?: number;
  draftedBy?: string;
}

interface Pick {
  id: string;
  overall: number;
  round: number;
  slot: number;
  player: DraftPlayer;
  member: {
    id: string;
    displayName: string;
  };
  auto: boolean;
  madeAt: string;
}

interface DraftParticipant {
  slot: number;
  member: {
    id: string;
    userId: string;
    displayName: string;
    email: string;
    role?: 'OWNER' | 'MANAGER' | 'MEMBER';
  };
}

interface DraftData {
  id: string;
  currentPick: number;
  totalPicks: number;
  round: number;
  direction: string;
  status: string;
  participants: DraftParticipant[];
  picks: Pick[];
  draftOrder?: string[]; // Array of user IDs in draft order
  maxRounds?: number;
  type?: 'snake' | 'linear';
}

interface DraftRoomClientProps {
  players: DraftPlayer[];
  draftData: DraftData;
}

const POSITIONS = ['ALL', 'DEF', 'MID', 'RUC', 'FWD'];
const CLUBS = [
  'ALL',
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

export default function DraftRoomClient({ players, draftData }: DraftRoomClientProps) {
  // Real-time draft sync - derive current user from AuthContext when available; fallback to first participant
  const { user } = useAuth?.() || { user: undefined } as any;
  const currentUserId = user?.uid || draftData.participants?.[0]?.member?.userId || '';
  
  // Development mode detection
  const isDevelopment = 
    process.env.NODE_ENV === 'development' ||
    (typeof window !== 'undefined' && window.location.hostname === 'localhost') ||
    (typeof window !== 'undefined' && window.location.hostname.includes('codespaces'));
  
  if (isDevelopment) console.log('🎮 DraftRoomClient mounting with draftData:', draftData?.id);
  
  // Find the current user's slot in the draft
  const currentUserParticipant = draftData.participants.find(p => p.member.userId === currentUserId);
  if (isDevelopment) console.log('👤 Current user slot:', currentUserParticipant?.slot, 'User ID:', currentUserId);
  
  const {
    draftData: liveDraftData,
    liveDraftState,
    connectionState,
    lastPickMade,
    recentActivity,
    makePick: _realtimeMakePick,
    updateQueue: _updateQueue,
    forceRefresh,
  } = useRealtimeDraft(draftData, currentUserId, true);

  const [tab, setTab] = useState('available');
  const [confirmModal, setConfirmModal] = useState<{ open: boolean; player?: DraftPlayer }>({
    open: false,
  });
  const [fantasySettingsModal, setFantasySettingsModal] = useState(false);
  const [leagueSettings, setLeagueSettings] = useState<LeagueSettings>({
    id: liveDraftData?.id || draftData.id,
    name: 'Default League',
    selectedCategories: [
      'goals',
      'kicks',
      'handballs',
      'marks',
      'tackles',
      'contestedPossessions',
      'effectiveDisposals',
      'inside50s',
      'intercepts',
    ],
    maxCategories: 5,
    scoringType: 'total',
  });

  // Use shared watchlist hook
  const { watchlistItems, isInWatchlist, toggleWatchlist, removeFromWatchlist } = useWatchlist();

  // Scroll position preservation for watchlist toggles
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  // Enhanced toggle function that preserves scroll position
  const handleWatchlistToggleWithScroll = useCallback((playerId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    // Store scroll position from the closest scrollable container
    const target = event.target as HTMLElement;
    const scrollContainer = target.closest('.overflow-x-auto') || 
                          target.closest('.overflow-y-auto') || 
                          scrollContainerRef.current || 
                          document.documentElement;
    const scrollTop = scrollContainer.scrollTop;
    const scrollLeft = scrollContainer.scrollLeft;
    
    toggleWatchlist(playerId);
    
    // Restore scroll position after state change
    requestAnimationFrame(() => {
      scrollContainer.scrollTop = scrollTop;
      scrollContainer.scrollLeft = scrollLeft;
    });
  }, [toggleWatchlist]);

  // Drafted player alerts system
  const draftedPlayerIds = useMemo(() => 
    (liveDraftData?.picks || []).map(pick => pick.player.id),
    [liveDraftData?.picks]
  );

  const { alerts, dismissAlert, dismissAllAlerts, hasActiveAlerts: _hasActiveAlerts } = useDraftedPlayerAlerts({
    draftedPlayerIds,
    allPlayers: players,
    watchlistItems,
    onWatchlistPlayerDrafted: (player) => {
      if (isDevelopment) console.log('🚨 Watchlist player drafted:', player.name);
      // Could add additional logic here like auto-removing from watchlist
      // removeFromWatchlist(player.id);
    },
  });

  const [search, setSearch] = useState('');
  const [positionFilter, setPositionFilter] = useState('ALL');
  const [clubFilter, setClubFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState<'name' | 'position' | 'club'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isLoading, setIsLoading] = useState(false);

  // Advanced filter states
  const [injuryFilter, setInjuryFilter] = useState('ALL');
  const [quickFilters, setQuickFilters] = useState<string[]>([]);

  // Keyboard shortcuts state
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);

  // League customization options
  const [leagueCustomization, setLeagueCustomization] = useState({
    autoPickTime: 120, // seconds
    showFantasyScores: true,
    defaultSort: 'fantasy' as 'name' | 'position' | 'club' | 'fantasy',
    positionLimits: {
      DEF: 6,
      MID: 8,
      RUC: 2,
      FWD: 6,
    },
    draftStyle: 'snake' as 'snake' | 'linear',
    showPlayerStats: ['goals', 'kicks', 'handballs', 'marks', 'tackles'] as string[],
  });

  // Player recommendation system
  const [showRecommendations, setShowRecommendations] = useState(true);
  const [recommendationCriteria, setRecommendationCriteria] = useState({
    prioritizePositions: [] as string[],
    avoidInjured: true,
    focusOnValue: true,
    considerTeamNeeds: true,
  });

  // Map draft status to consistent badge styles
  const renderStatusBadge = (status: string) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      SCHEDULED: { bg: 'bg-indigo-100', text: 'text-indigo-800', label: 'Scheduled' },
      LIVE: { bg: 'bg-green-100', text: 'text-green-800', label: 'Live' },
      PAUSED: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Paused' },
      COMPLETED: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Completed' },
    };
    const s = map[status] || { bg: 'bg-yellow-100', text: 'text-yellow-800', label: status };
    return (
      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
        {s.label}
      </span>
    );
  };

  // Auto-pick timer state
  const [timeRemaining, setTimeRemaining] = useState(leagueCustomization.autoPickTime);
  const [isMyTurn, setIsMyTurn] = useState(false);
  const [autoPickEnabled, setAutoPickEnabled] = useState(true);

  // Legacy error state (now handled by real-time hook)
  const [draftError, setDraftError] = useState<string | null>(null);

  // Filter and sort players
  const filteredPlayers = useMemo(() => {
    let filtered = players.filter((player) => {
      // Filter out already picked players using live data
      const isPicked = (liveDraftData?.picks || []).some((pick) => pick.player.id === player.id);
      if (isPicked) return false;

      // Search filter
      if (search && !player.name.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }

      // Position filter
      if (positionFilter !== 'ALL' && player.position !== positionFilter) {
        return false;
      }

      // Club filter
      if (clubFilter !== 'ALL' && player.club !== clubFilter) {
        return false;
      }

      // Injury status filter
      if (injuryFilter !== 'ALL') {
        const playerInjuryStatus = player.injuryStatus || 'healthy';
        if (injuryFilter === 'HEALTHY' && playerInjuryStatus !== 'healthy') {
          return false;
        }
        if (
          injuryFilter === 'INJURED' &&
          !['questionable', 'injured', 'out'].includes(playerInjuryStatus)
        ) {
          return false;
        }
      }

      // Fantasy score range filter - REMOVED since we're not using fantasy score sorting
      // The fantasy score range filter was causing issues and is no longer needed

      // Quick filters
      if (quickFilters.includes('WATCHLIST_ONLY') && !isInWatchlist(player.id)) {
        return false;
      }
      if (quickFilters.includes('HIGH_SCORERS')) {
        if (player.stats) {
          const playerScore = calculateTotalValue(player.stats);
          if (playerScore < 75) return false; // Simplified threshold
        } else {
          // Players without stats are not considered high scorers
          return false;
        }
      }

      return true;
    });

    // Sort players
    filtered.sort((a, b) => {
      let aValue: string | number = a[sortBy];
      let bValue: string | number = b[sortBy];

      // Handle different data types for sorting
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        if (sortOrder === 'desc') {
          return bValue.localeCompare(aValue);
        }
        return aValue.localeCompare(bValue);
      } else if (typeof aValue === 'number' && typeof bValue === 'number') {
        if (sortOrder === 'desc') {
          return bValue - aValue;
        }
        return aValue - bValue;
      } else {
        // Fallback to string comparison
        const aString = String(aValue || '');
        const bString = String(bValue || '');
        if (sortOrder === 'desc') {
          return bString.localeCompare(aString);
        }
        return aString.localeCompare(bString);
      }
    });

    if (isDevelopment) console.log('🔍 Filter Debug:', {
      totalPlayers: players.length,
      filteredCount: filtered.length,
      search,
      positionFilter,
      clubFilter,
      injuryFilter,
      quickFilters,
      pickedPlayers: (liveDraftData?.picks || []).length,
    });

    return filtered;
  }, [
    players,
    liveDraftData?.picks,
    search,
    positionFilter,
    clubFilter,
    sortBy,
    sortOrder,
    injuryFilter,
    quickFilters,
    isInWatchlist,
  ]);

  // Calculate current draft state and turn information
  const getDraftState = useCallback(() => {
    if (!liveDraftData) return null;
    if (!liveDraftData.participants || !Array.isArray(liveDraftData.participants)) return null;
    if (!liveDraftData.picks || !Array.isArray(liveDraftData.picks)) return null;

    const totalParticipants = liveDraftData.participants.length;
    const maxRounds = 22; // Default 22 rounds for AFL fantasy
    const draftType = leagueCustomization.draftStyle;
    const currentPickIndex = liveDraftData.picks.length;

    // Calculate current round (1-based)
    const currentRound = Math.floor(currentPickIndex / totalParticipants) + 1;

    // For snake draft, calculate direction and position in round
    let currentTurnIndex: number;
    let isForwardDirection: boolean;

    if (draftType === 'snake') {
      const roundIndex = currentRound - 1; // 0-based round
      isForwardDirection = roundIndex % 2 === 0; // Even rounds go forward, odd go backward
      const pickInRound = currentPickIndex % totalParticipants;

      if (isForwardDirection) {
        currentTurnIndex = pickInRound;
      } else {
        currentTurnIndex = totalParticipants - 1 - pickInRound;
      }
    } else {
      // Linear draft - always forward
      isForwardDirection = true;
      currentTurnIndex = currentPickIndex % totalParticipants;
    }

    // Get current drafting participant
    const draftOrder = liveDraftData.participants.map((p) => p.member.id);
    const currentDrafterId =
      currentTurnIndex < draftOrder.length ? draftOrder[currentTurnIndex] : null;
    const currentDrafter = liveDraftData.participants.find((p) => p.member.id === currentDrafterId);

    // Calculate next few picks for preview
    const nextPicks = [];
    for (let i = 1; i <= 3; i++) {
      const nextPickIndex = currentPickIndex + i;
      const nextRound = Math.floor(nextPickIndex / totalParticipants) + 1;

      if (nextRound > maxRounds) break;

      let nextTurnIndex: number;
      if (draftType === 'snake') {
        const nextRoundIndex = nextRound - 1;
        const nextIsForward = nextRoundIndex % 2 === 0;
        const nextPickInRound = nextPickIndex % totalParticipants;

        if (nextIsForward) {
          nextTurnIndex = nextPickInRound;
        } else {
          nextTurnIndex = totalParticipants - 1 - nextPickInRound;
        }
      } else {
        nextTurnIndex = nextPickIndex % totalParticipants;
      }

      const nextDrafterId = nextTurnIndex < draftOrder.length ? draftOrder[nextTurnIndex] : null;
      const nextDrafter = liveDraftData.participants.find((p) => p.member.id === nextDrafterId);

      if (nextDrafter) {
        nextPicks.push({
          pickNumber: nextPickIndex + 1,
          round: nextRound,
          participant: nextDrafter,
          turnIndex: nextTurnIndex,
        });
      }
    }

    return {
      currentRound,
      maxRounds,
      currentPickNumber: currentPickIndex + 1,
      totalPossiblePicks: totalParticipants * maxRounds,
      currentTurnIndex,
      currentDrafter,
      isForwardDirection,
      draftType,
      draftOrder,
      nextPicks,
      isComplete: currentRound > maxRounds || liveDraftData.status === 'COMPLETED',
      picksRemaining: Math.max(0, totalParticipants * maxRounds - currentPickIndex),
    };
  }, [liveDraftData, leagueCustomization.draftStyle]);

  // Auto-pick timer functionality with proper turn detection
  // Note: This useEffect is moved after handlePlayerSelect to avoid dependency issues

  // Draft order management state
  const [draftOrderManagement, setDraftOrderManagement] = useState({
    showOrderModal: false,
    isRandomizing: false,
    tempOrder: [] as string[],
  });

  // Draft order management functions
  const randomizeDraftOrder = useCallback(() => {
    setDraftOrderManagement((prev) => ({ ...prev, isRandomizing: true }));

    // Simulate randomization with animation
    const participants = [...draftData.participants];
    let shuffled = [...participants];

    // Fisher-Yates shuffle
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    setTimeout(() => {
      const newOrder = shuffled.map((p) => p.member.id);
      setDraftOrderManagement((prev) => ({
        ...prev,
        tempOrder: newOrder,
        isRandomizing: false,
      }));
    }, 1500); // Animation time
  }, [draftData.participants]);

  const saveDraftOrder = useCallback(async () => {
    try {
      const response = await fetch(`/api/drafts/${draftData.id}/order`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftOrder: draftOrderManagement.tempOrder,
        }),
      });

      if (!response.ok) throw new Error('Failed to save draft order');

      // Close modal and refresh (guarded to avoid reload loops)
      setDraftOrderManagement((prev) => ({ ...prev, showOrderModal: false }));
      throttledReload('draft-reload-once');
    } catch (error) {
      console.error('Error saving draft order:', error);
      showError('Failed to save draft order');
    }
  }, [draftData.id, draftOrderManagement.tempOrder]);

  // Core fantasy categories for analysis (most important for AFL fantasy)
  const CORE_FANTASY_CATEGORIES = [
    { key: 'goals' as const, name: 'Goals', weight: 6, target: 'medium' },
    { key: 'kicks' as const, name: 'Kicks', weight: 0.5, target: 'high' },
    { key: 'handballs' as const, name: 'Handballs', weight: 0.5, target: 'high' },
    { key: 'marks' as const, name: 'Marks', weight: 2.5, target: 'medium' },
    { key: 'tackles' as const, name: 'Tackles', weight: 4, target: 'high' },
    { key: 'hitouts' as const, name: 'Hitouts', weight: 1.5, target: 'low' },
    { key: 'clearances' as const, name: 'Clearances', weight: 4, target: 'medium' },
    { key: 'inside50s' as const, name: 'Inside 50s', weight: 2, target: 'medium' },
    { key: 'intercepts' as const, name: 'Intercepts', weight: 4, target: 'medium' },
  ];

  // Calculate team category analysis
  const getTeamCategoryAnalysis = useCallback(() => {
    const myPicks = draftData.picks.filter((pick) => pick.member.id === currentUserId);

    if (myPicks.length === 0) {
      return {
        categories: CORE_FANTASY_CATEGORIES.map((cat) => ({
          ...cat,
          teamTotal: 0,
          teamAverage: 0,
          leagueAverage: 0,
          strength: 0,
          rating: 'neutral' as const,
          percentile: 50,
        })),
        strongCategories: [],
        weakCategories: [],
        needsImprovement: [],
        strengths: [],
      };
    }

    // Calculate team totals and averages
    const categoryAnalysis = CORE_FANTASY_CATEGORIES.map((category) => {
      const teamTotal = myPicks.reduce((sum, pick) => {
        const games = pick.player.stats?.games || 1;
        const statValue = pick.player.stats?.[category.key] || 0;
        return sum + statValue / games; // Per game average
      }, 0);

      const teamAverage = teamTotal / myPicks.length;

      // Calculate league percentile for this category
      const allPlayerAverages = filteredPlayers
        .filter((p: DraftPlayer) => p.stats && p.stats.games > 0)
        .map((p: DraftPlayer) => {
          const games = p.stats!.games;
          return (p.stats![category.key] || 0) / games;
        })
        .sort((a: number, b: number) => a - b);

      let percentile = 50;
      if (allPlayerAverages.length > 0) {
        const rank = allPlayerAverages.filter((avg: number) => avg <= teamAverage).length;
        percentile = Math.round((rank / allPlayerAverages.length) * 100);
      }

      // Determine strength rating
      let rating: 'strong' | 'average' | 'weak' | 'neutral';
      if (percentile >= 75) rating = 'strong';
      else if (percentile >= 40) rating = 'average';
      else if (percentile < 40) rating = 'weak';
      else rating = 'neutral';

      return {
        ...category,
        teamTotal,
        teamAverage,
        leagueAverage:
          allPlayerAverages.length > 0
            ? allPlayerAverages[Math.floor(allPlayerAverages.length * 0.5)]
            : 0,
        strength: teamAverage,
        rating,
        percentile,
      };
    });

    // Sort by percentile to identify strengths and weaknesses
    const sortedByPercentile = [...categoryAnalysis].sort((a, b) => b.percentile - a.percentile);

    return {
      categories: categoryAnalysis,
      strongCategories: sortedByPercentile.filter((cat) => cat.rating === 'strong'),
      weakCategories: sortedByPercentile.filter((cat) => cat.rating === 'weak'),
      needsImprovement: sortedByPercentile.slice(-3).filter((cat) => cat.percentile < 60),
      strengths: sortedByPercentile.slice(0, 3).filter((cat) => cat.percentile > 60),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftData.picks, filteredPlayers]);

  // Enhanced recommendation system that considers category needs
  const getPlayerRecommendations = useCallback(
    (count: number = 5): DraftPlayer[] => {
      if (!recommendationCriteria.considerTeamNeeds) {
        return filteredPlayers
          .filter(
            (player) =>
              !recommendationCriteria.avoidInjured ||
              !player.injuryStatus ||
              player.injuryStatus === 'healthy'
          )
          .slice(0, count);
      }

      const teamAnalysis = getTeamCategoryAnalysis();
      const myPicks = draftData.picks.filter((pick) => pick.member.id === currentUserId);
      const positionCounts = myPicks.reduce(
        (acc, pick) => {
          acc[pick.player.position] = (acc[pick.player.position] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      // Score players based on team category needs and value
      const scoredPlayers = filteredPlayers
        .filter(
          (player) =>
            !recommendationCriteria.avoidInjured ||
            !player.injuryStatus ||
            player.injuryStatus === 'healthy'
        )
        .map((player) => {
          let score = 0;

          // Category improvement score - prioritize players who strengthen weak categories
          if (player.stats && teamAnalysis.needsImprovement.length > 0) {
            const games = player.stats.games || 1;

            teamAnalysis.needsImprovement.forEach((weakCategory) => {
              const playerCategoryAverage = (player.stats![weakCategory.key] || 0) / games;
              const leagueAverage = weakCategory.leagueAverage;

              if (playerCategoryAverage > leagueAverage) {
                // Bonus for players who are strong in our weak categories
                const improvementScore =
                  (playerCategoryAverage / leagueAverage) * weakCategory.weight * 15;
                score += improvementScore;
              }
            });

            // Maintain strong categories - smaller bonus for reinforcing strengths
            teamAnalysis.strongCategories.forEach((strongCategory) => {
              const playerCategoryAverage = (player.stats![strongCategory.key] || 0) / games;
              const leagueAverage = strongCategory.leagueAverage;

              if (playerCategoryAverage > leagueAverage) {
                const maintenanceScore =
                  (playerCategoryAverage / leagueAverage) * strongCategory.weight * 5;
                score += maintenanceScore;
              }
            });
          }

          // Position need bonus
          const currentCount = positionCounts[player.position] || 0;
          const maxForPosition =
            leagueCustomization.positionLimits[
              player.position as keyof typeof leagueCustomization.positionLimits
            ] || 8;
          const needScore = Math.max(0, ((maxForPosition - currentCount) / maxForPosition) * 30);
          score += needScore;

          // Priority position bonus
          if (recommendationCriteria.prioritizePositions.includes(player.position)) {
            score += 20;
          }

          // Base value score (reduced weight since we focus on category fit)
          if (player.stats && recommendationCriteria.focusOnValue) {
            score += calculateTotalValue(player.stats) * 0.3;
          }

          return { ...player, recommendationScore: score };
        })
        .sort((a, b) => (b.recommendationScore || 0) - (a.recommendationScore || 0))
        .slice(0, count);

      return scoredPlayers;
    },
    [
      filteredPlayers,
      recommendationCriteria,
      draftData.picks,
      leagueCustomization,
      getTeamCategoryAnalysis,
    ]
  );

  // League customization modal state
  const [showCustomizationModal, setShowCustomizationModal] = useState(false);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle shortcuts when not typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
        return;
      }

      switch (e.key) {
        case '/':
          e.preventDefault();
          document.getElementById('search')?.focus();
          break;
        case '?':
          e.preventDefault();
          setShowKeyboardHelp(true);
          break;
        case 'Escape':
          setSearch('');
          setConfirmModal({ open: false });
          setShowKeyboardHelp(false);
          break;
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
          if (!e.ctrlKey && !e.altKey) {
            const tabIndex = parseInt(e.key) - 1;
            const tabs = ['available', 'watchlist', 'picks', 'pick-feed', 'my-team'];
            if (tabs[tabIndex]) {
              setTab(tabs[tabIndex]);
            }
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setTab, setSearch, setConfirmModal, setShowKeyboardHelp]);

  // Get current picking team
  const currentPickingTeam = useMemo(() => {
    if (draftData.status === 'COMPLETED') return null;
    if (!draftData.participants || !Array.isArray(draftData.participants)) return null;

    const teamCount = draftData.participants.length;
    const { slot } = computeSnakeState(draftData.currentPick, teamCount);
    return draftData.participants.find((p) => p.slot === slot) || null;
  }, [draftData]);

  // Check if it's your turn to pick
  const yourSlot = useMemo(() => {
    return draftData.participants.find(p => p.member.userId === currentUserId)?.slot;
  }, [draftData.participants, currentUserId]);

  const isYourTurn = useMemo(() => {
    if (!currentPickingTeam?.slot || yourSlot == null) return false;
    return currentPickingTeam.slot === yourSlot;
  }, [currentPickingTeam?.slot, yourSlot]);

  // Pick validation state
  const [pickValidation, setPickValidation] = useState({
    isValidating: false,
    isPicking: false,
    validationErrors: [] as string[],
    lastValidationTime: 0,
  });

  // Comprehensive pick validation
  const validatePick = useCallback(
    (player: DraftPlayer): { isValid: boolean; errors: string[] } => {
      const errors: string[] = [];
      const currentTime = Date.now();
      const draftState = getDraftState();

      // Check if we have valid draft state
      if (!draftState) {
        errors.push('Draft state is not available');
        return { isValid: false, errors };
      }

      // 1. Check if draft is active
      if (draftData.status !== 'ACTIVE' && draftData.status !== 'LIVE') {
        errors.push('Draft is not currently active');
      }

      // 2. Check if draft is complete
      if (draftState.isComplete) {
        errors.push('Draft has been completed');
      }

      // 3. Check if player is already picked
      const isAlreadyPicked = draftData.picks.some((pick) => pick.player.id === player.id);
      if (isAlreadyPicked) {
        errors.push(`${player.name} has already been drafted`);
      }

      // 4. Check if it's the user's turn (relaxed in development for testing)
      if (!isDevelopment) {
        const isUsersTurn = draftState.currentDrafter?.member.userId === currentUserId;
        if (!isUsersTurn) {
          const currentDrafterName = draftState.currentDrafter?.member.displayName || 'Unknown';
          errors.push(`It's not your turn. Currently ${currentDrafterName}'s pick`);
        }
      } else {
        // In development mode, allow the first drafter to pick
        const firstDrafterId = draftData.participants?.[0]?.member?.id || 'cmeilycnh00077gue7snq8u0g';
        const isUsersTurn = draftState.currentDrafter?.member.id === firstDrafterId;
        if (!isUsersTurn) {
          const currentDrafterName = draftState.currentDrafter?.member.displayName || 'Unknown';
          errors.push(`It's not your turn. Currently ${currentDrafterName}'s pick`);
        }
        if (isDevelopment) console.log('🧪 Development mode: Turn validation for first drafter:', {
          currentDrafter: draftState.currentDrafter?.member.id,
          firstDrafter: firstDrafterId,
          isUsersTurn
        });
      }

      // 5. Check for recent pick validation attempts (prevent spam)
      if (currentTime - pickValidation.lastValidationTime < 1000) {
        // 1 second cooldown
        errors.push('Please wait before making another pick attempt');
      }

      // 6. Check if player exists and is valid
      if (!player.id || !player.name) {
        errors.push('Invalid player selection');
      }

      // 7. Check if already in process of making a pick
      if (pickValidation.isPicking) {
        errors.push('Pick already in progress');
      }

      return {
        isValid: errors.length === 0,
        errors,
      };
    },
    [draftData, getDraftState, pickValidation]
  );

  // Enhanced player selection with validation
  const handlePlayerSelect = useCallback(
    (player: DraftPlayer) => {
      // Run initial validation
      const validation = validatePick(player);

      setPickValidation((prev) => ({
        ...prev,
        validationErrors: validation.errors,
        lastValidationTime: Date.now(),
      }));

      if (!validation.isValid) {
        // Show validation errors
        const errorMessage = validation.errors.join('\n');
        showError(`Cannot draft ${player.name}`, errorMessage);
        return;
      }

      // If validation passes, show confirmation modal
      setConfirmModal({ open: true, player });
    },
    [validatePick]
  );

  // Enhanced pick confirmation with race condition protection
  const handleConfirmPick = useCallback(async () => {
    if (!confirmModal.player) return;

    // Re-validate just before making the pick (race condition protection)
    const finalValidation = validatePick(confirmModal.player);

    if (!finalValidation.isValid) {
      const errorMessage = finalValidation.errors.join('\n');
      showError('Cannot complete pick', errorMessage);
      setConfirmModal({ open: false });
      return;
    }

    // Set picking state to prevent concurrent picks
    setPickValidation((prev) => ({ ...prev, isPicking: true }));
    setIsLoading(true);

    try {
      // Get current draft state for pick validation
      const draftState = getDraftState();

      // Use the actual authenticated user ID from AuthContext
      const currentUserId = user?.uid || draftData.participants?.[0]?.member?.userId || 'current-user';

      if (!draftState) {
        throw new Error('Draft state is not available');
      }

      console.log('🎯 Making pick request:', {
        playerId: confirmModal.player.id,
        playerName: confirmModal.player.name,
        memberId: currentUserId,
        isDevelopment,
        currentPickNumber: draftState.currentPickNumber,
        currentRound: draftState.currentRound,
      });

      const requestBody = {
        playerId: confirmModal.player.id,
        // memberId removed; server derives from session
      };

      const response = await fetch(`/api/drafts/${draftData.id}/pick`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const responseData = await response.json();

      if (!response.ok) {
        // Extract error message safely, handling both string and object formats
        const getErrorMessage = (error: unknown): string => {
          if (typeof error === 'string') return error;
          if (error && typeof error === 'object') {
            const errorObj = error as Record<string, unknown>;
            return (
              (errorObj.message as string) || (errorObj.error as string) || JSON.stringify(error)
            );
          }
          return 'Unknown error';
        };

        const errorMessage = getErrorMessage(responseData.error);

        // Handle specific error types
        if (response.status === 409) {
          throw new Error(errorMessage || 'Player already drafted or conflicting pick');
        } else if (response.status === 403) {
          throw new Error(errorMessage || 'Not your turn or unauthorized');
        } else if (response.status === 410) {
          throw new Error(errorMessage || 'Pick expired or draft state changed');
        } else {
          throw new Error(errorMessage || 'Failed to make pick');
        }
      }

      // Success - close modal and refresh
      setConfirmModal({ open: false });

      // Use real-time updates; fallback to guarded reload if necessary
      throttledReload('draft-reload-once');
    } catch (error) {
      console.error('Error making pick:', error);

      // Show user-friendly error message
      const errorMessage = error instanceof Error ? error.message : 'Failed to make pick';
      showError('Pick failed', `${errorMessage}. Please try again.`);

      // Reset state on error
      setConfirmModal({ open: false });
    } finally {
      setIsLoading(false);
      setPickValidation((prev) => ({ ...prev, isPicking: false }));
    }
  }, [confirmModal.player, validatePick, getDraftState, draftData.id, draftData.participants, user, isDevelopment]);

  // Draft control functions for league owners (modern confirmations)
  const { error: showError, success: showSuccess, alerts: globalAlerts, removeAlert: removeGlobalAlert } = useAlert();
  const { confirm: confirmAction, ConfirmationModal } = useConfirmation();

  const handlePauseDraft = useCallback(() => {
    confirmAction({
      title: 'Pause Draft',
      message: 'Are you sure you want to pause the draft? This will stop all picks until resumed.',
      variant: 'warning',
      confirmText: 'Pause',
      cancelText: 'Cancel',
      onConfirm: async () => {
        setIsLoading(true);
        try {
          const response = await fetch(`/api/drafts/${draftData.id}/pause`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          if (!response.ok) {
            const error = await response.json().catch(() => ({} as any));
            throw new Error(error?.message || response.statusText || 'Failed to pause draft');
          }
          showSuccess('Draft paused successfully. Only you can resume it.');
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Unknown error';
          console.error('Error pausing draft:', e);
          showError('Failed to pause draft', msg);
        } finally {
          setIsLoading(false);
        }
      },
    });
  }, [confirmAction, draftData.id, showError, showSuccess]);

  const handleResumeDraft = useCallback(() => {
    confirmAction({
      title: 'Resume Draft',
      message: 'Resume the draft from where it paused? Picks will continue immediately.',
      variant: 'info',
      confirmText: 'Resume',
      cancelText: 'Cancel',
      onConfirm: async () => {
        setIsLoading(true);
        try {
          const response = await fetch(`/api/drafts/${draftData.id}/resume`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          if (!response.ok) {
            const error = await response.json().catch(() => ({} as any));
            throw new Error(error?.message || response.statusText || 'Failed to resume draft');
          }
          showSuccess('Draft resumed successfully!');
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Unknown error';
          console.error('Error resuming draft:', e);
          showError('Failed to resume draft', msg);
        } finally {
          setIsLoading(false);
        }
      },
    });
  }, [confirmAction, draftData.id, showError, showSuccess]);

  // Check if current user is league owner
  const isLeagueOwner = useMemo(() => {
    const currentUserParticipant = draftData.participants.find(p => p.member.userId === currentUserId);
    return currentUserParticipant?.member?.role === 'OWNER';
  }, [draftData.participants, currentUserId]);

  // Auto-pick timer functionality with proper turn detection
  useEffect(() => {
    const draftState = getDraftState();

    // Early return if no draft state available
    if (!draftState) {
      setIsMyTurn(false);
      return;
    }

    // Get the current user ID from the real-time draft context
    // Use the authenticated user ID or fallback to first participant
    const currentUserId = user?.uid || draftData.participants?.[0]?.member?.userId || '';
    
    if (isDevelopment) console.log('🔍 Current user ID for turn detection:', currentUserId);
    if (isDevelopment) console.log('🔍 Current drafter:', draftState.currentDrafter);
    
    // Determine if it's the current user's turn - check member ID in development
    const isUsersTurn = (
      draftState.currentDrafter?.member.id === currentUserId && 
      !draftState.isComplete
    );
    
    if (isDevelopment) console.log('🎯 Turn detection:', {
      isUsersTurn,
      currentUserId,
      drafterId: draftState.currentDrafter?.member.id,
      drafterUserId: draftState.currentDrafter?.member.userId,
      isComplete: draftState.isComplete
    });
    
    setIsMyTurn(isUsersTurn);

    // Check for both 'ACTIVE' and 'LIVE' status for compatibility
    const isDraftActive = draftData.status === 'LIVE';
    
    if (isUsersTurn && autoPickEnabled && isDraftActive) {
      if (isDevelopment) console.log('🎯 Starting auto-pick timer for user turn');
      const timer = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            // Auto-pick the highest ranked available player
            if (filteredPlayers.length > 0) {
              if (isDevelopment) console.log('⏰ Auto-picking player due to timer expiry:', filteredPlayers[0]);
              // Use the real-time makePick function to actually draft the player
              _realtimeMakePick(filteredPlayers[0].id).catch((error) => {
                console.error('❌ Auto-pick failed:', error);
              });
            }

            return leagueCustomization.autoPickTime; // Reset timer to league setting
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [
    getDraftState,
    autoPickEnabled,
    draftData.status,
    filteredPlayers,
    setIsMyTurn,
    setTimeRemaining,
    leagueCustomization.autoPickTime,
    _realtimeMakePick,
    liveDraftData?.participants, // Add this dependency to re-check when participants change
    draftData.participants, // Add dependency for user ID resolution
    user, // Add user dependency since we use user.uid
  ]);

  const PlayerRow = ({ player }: { player: DraftPlayer }) => {
    const playerInWatchlist = isInWatchlist(player.id);
    const isAlreadyPicked = draftData.picks.some((pick) => pick.player.id === player.id);

    const handleWatchlistToggle = (e: React.MouseEvent) => {
      if (isDevelopment) console.log('Toggling watchlist for player:', player.name, player.id);
      handleWatchlistToggleWithScroll(player.id, e);
    };

    // Validate if this player can be picked
    const playerValidation = validatePick(player);
    const isPlayerValid = playerValidation.isValid;
    const validationErrors = playerValidation.errors;

    return (
      <tr
        key={player.id}
        className={`border-b transition-colors ${
          isAlreadyPicked
            ? 'bg-red-50 opacity-50'
            : isPlayerValid
              ? 'hover:bg-green-50'
              : 'hover:bg-yellow-50'
        }`}
      >
        <td
          className={`sticky left-0 border-r border-gray-200 z-10 px-4 py-3 ${
            isAlreadyPicked
              ? 'bg-red-50'
              : isPlayerValid
                ? 'bg-white hover:bg-green-50'
                : 'bg-yellow-50 hover:bg-yellow-100'
          }`}
        >
          <div className="flex items-center space-x-3">
            <button
              onClick={handleWatchlistToggle}
              disabled={isAlreadyPicked}
              aria-pressed={playerInWatchlist}
              aria-label={playerInWatchlist ? `Remove ${player.name} from watchlist` : `Add ${player.name} to watchlist`}
              className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                playerInWatchlist
                  ? 'bg-blue-100 text-blue-600 hover:bg-blue-200'
                  : 'bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600'
              }`}
              title={playerInWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
            >
              <svg
                className="w-4 h-4"
                fill="currentColor"
                viewBox="0 0 20 20"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
              </svg>
            </button>
            <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
              <span className="text-sm font-medium text-gray-600">
                {player.name.split(' ')[0]?.[0]}
                {player.name.split(' ')[1]?.[0] || ''}
              </span>
            </div>
            <div>
              <div className="font-medium text-gray-900">{player.name}</div>
              <div className="text-sm text-gray-500">
                {player.club} • {player.position}
              </div>
            </div>
          </div>
        </td>
        <td className="px-3 py-3 text-center">
          <span className="text-sm font-semibold text-green-600">
            {player.stats ? calculateTotalValue(player.stats).toFixed(1) : '0.0'}
          </span>
        </td>
        {leagueSettings.selectedCategories.map((category) => {
          const perGameValue =
            player.stats && player.stats.games > 0
              ? (player.stats[category] || 0) / player.stats.games
              : 0;
          const categoryData = FANTASY_CATEGORIES[category];
          const displayValue =
            categoryData?.format === 'percentage'
              ? `${perGameValue.toFixed(1)}%`
              : perGameValue.toFixed(1);

          return (
            <td key={category} className="px-2 py-3 text-center">
              <span className="text-xs">{player.stats ? displayValue : '0.0'}</span>
            </td>
          );
        })}
        <td className="px-3 py-3 text-center">
          {player.draftedBy ? (
            <span className="text-xs text-gray-500 px-3 py-1 bg-gray-100 rounded">Drafted</span>
          ) : isPlayerValid ? (
            <Button
              onClick={() => handlePlayerSelect(player)}
              disabled={isLoading || pickValidation.isPicking}
              aria-label={`Draft ${player.name}`}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm"
            >
              {pickValidation.isPicking ? 'Drafting...' : 'Draft'}
            </Button>
          ) : (
            <Button
              onClick={() => handlePlayerSelect(player)}
              disabled={true}
              className="bg-gray-400 text-gray-600 px-3 py-1 rounded text-sm cursor-not-allowed"
              title={validationErrors.join(', ')}
            >
              Cannot Draft
            </Button>
          )}
        </td>
      </tr>
    );
  };

  // Function to start draft
  const startDraft = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/drafts/${draftData.id}/start`, {
        method: 'POST',
      });
      
      if (response.ok) {
        // Refresh the page to get the updated draft status
        window.location.reload();
      } else {
        console.error('Failed to start draft');
      }
    } catch (error) {
      console.error('Error starting draft:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Local alert container for confirmations and errors */}
      <AlertContainer alerts={globalAlerts} onRemove={removeGlobalAlert} position="top-right" />
      {/* Draft Status Banner */}
      {draftData.status === 'SCHEDULED' && (
        <div className="w-full px-4 py-3 bg-indigo-600 text-white">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-medium">Draft is scheduled - Waiting for participants</span>
            </div>
            <button
              onClick={startDraft}
              disabled={isLoading}
              className="bg-white text-indigo-600 px-4 py-2 rounded-md font-medium hover:bg-gray-100 disabled:opacity-50"
            >
              {isLoading ? 'Starting...' : 'Start Draft Now'}
            </button>
          </div>
        </div>
      )}

      {/* Real-time Connection Status Indicator */}
      <ConnectionStatus status={connectionState.status as 'connected' | 'connecting' | 'disconnected' | 'reconnecting'} onRefresh={forceRefresh} />

      {/* Draft Control Banner for League Owners */}
      {isLeagueOwner && draftData.status === 'LIVE' && (
        <div className="w-full px-4 py-3 bg-amber-600 text-white">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span className="font-medium">League Owner Controls</span>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handlePauseDraft}
                disabled={isLoading}
                className="bg-amber-700 hover:bg-amber-800 text-white px-4 py-2 rounded-md font-medium disabled:opacity-50 flex items-center space-x-2"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{isLoading ? 'Pausing...' : 'Pause Draft'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Draft Paused Banner */}
      {draftData.status === 'PAUSED' && (
        <div className="w-full px-4 py-3 bg-yellow-600 text-white">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-medium">Draft is paused - Waiting for league owner to resume</span>
            </div>
            {isLeagueOwner && (
              <button
                onClick={handleResumeDraft}
                disabled={isLoading}
                className="bg-yellow-700 hover:bg-yellow-800 text-white px-4 py-2 rounded-md font-medium disabled:opacity-50 flex items-center space-x-2"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{isLoading ? 'Resuming...' : 'Resume Draft'}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Draft Error Alert */}
      {draftError && (
        <div className="w-full px-4 py-3 bg-red-50 border-b border-red-200">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center space-x-2 text-red-800">
              <svg
                className="h-5 w-5 text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 19c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
              <p className="text-sm font-medium">{draftError}</p>
              <button
                onClick={() => setDraftError(null)}
                className="ml-auto text-red-600 hover:text-red-800"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Draft Order & Turn Management */}
      <div className="w-full px-4 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-indigo-200">
        <div className="max-w-7xl mx-auto">
          {(() => {
            const draftState = getDraftState();

            // If no draft state available, show loading or error state
            if (!draftState) {
              return (
                <div className="space-y-3">
                  <div className="text-center text-indigo-600">
                    <div className="animate-pulse">Loading draft state...</div>
                  </div>
                </div>
              );
            }

            return (
              <div className="space-y-3">
                {/* Current Turn & Draft Progress */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <h4 className="text-sm font-semibold text-indigo-800 flex items-center">
                      <svg
                        className="h-4 w-4 mr-2 text-indigo-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012-2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                        />
                      </svg>
                      Draft Order & Turn Management
                    </h4>

                    <div className="flex items-center space-x-2 text-sm">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          draftState.draftType === 'snake'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {draftState.draftType === 'snake' ? '🐍 Snake Draft' : '📊 Linear Draft'}
                      </span>
                      <span className="text-indigo-700">
                        Round {draftState.currentRound} of {draftState.maxRounds}
                      </span>
                      <span className="text-indigo-600">
                        Pick {draftState.currentPickNumber} / {draftState.totalPossiblePicks}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    {draftData.status !== 'COMPLETED' &&
                      draftState.currentRound === 1 &&
                      draftData.picks.length === 0 && (
                        <button
                          onClick={() =>
                            setDraftOrderManagement((prev) => ({ ...prev, showOrderModal: true }))
                          }
                          className="bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-700"
                        >
                          ⚙️ Manage Order
                        </button>
                      )}
                    <div className="text-xs text-indigo-600">
                      {draftState.picksRemaining} picks remaining
                    </div>
                  </div>
                </div>

                {/* Current Turn Display */}
                {!draftState.isComplete && draftState.currentDrafter && (
                  <div
                    className={`p-3 rounded-lg border-2 ${
                      isMyTurn
                        ? 'bg-green-100 border-green-300 text-green-800'
                        : 'bg-gray-100 border-gray-300 text-gray-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div
                          className={`w-3 h-3 rounded-full ${isMyTurn ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}
                        ></div>
                        <span className="font-medium">
                          {isMyTurn
                            ? 'Your Turn!'
                            : `${draftState.currentDrafter.member.displayName}'s Turn`}
                        </span>
                        <span className="text-sm opacity-75">
                          (Position {draftState.currentTurnIndex + 1} in round)
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Next Few Picks Preview */}
                {draftState.nextPicks.length > 0 && (
                  <div className="bg-white/50 rounded-lg p-3">
                    <div className="text-sm font-medium text-indigo-700 mb-2">Coming Up:</div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {draftState.nextPicks.map((nextPick) => (
                        <div
                          key={nextPick.pickNumber}
                          className="flex items-center space-x-2 text-sm"
                        >
                          <span className="text-indigo-600 font-medium">
                            #{nextPick.pickNumber}
                          </span>
                          <span className="text-gray-700">
                            {nextPick.participant.member.displayName}
                          </span>
                          {nextPick.round !== draftState.currentRound && (
                            <span className="text-xs text-gray-500">(R{nextPick.round})</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Team Category Analysis Widget */}
      {draftData.picks.some((pick) => pick.member.id === currentUserId) && (
        <div className="w-full px-4 py-3 bg-gradient-to-r from-green-50 to-blue-50 border-b border-green-200">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-800 flex items-center">
                <svg
                  className="h-4 w-4 mr-2 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 00-2-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
                Team Category Analysis
              </h4>
              <div className="text-xs text-gray-600">
                Focus on <span className="font-medium text-red-600">weak areas</span> • Maintain{' '}
                <span className="font-medium text-green-600">strengths</span>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-9 gap-2">
              {getTeamCategoryAnalysis().categories.map((category) => (
                <div
                  key={category.key}
                  className={`text-center p-2 rounded-md border-2 transition-all ${
                    category.rating === 'strong'
                      ? 'bg-green-100 border-green-300 text-green-800'
                      : category.rating === 'weak'
                        ? 'bg-red-100 border-red-300 text-red-800'
                        : 'bg-gray-100 border-gray-300 text-gray-700'
                  }`}
                >
                  <div className="text-xs font-medium">{category.name}</div>
                  <div className="text-lg font-bold">
                    {category.percentile}
                    <span className="text-xs ml-1">%ile</span>
                  </div>
                  <div className="text-xs opacity-75">
                    {category.rating === 'strong' ? '💪' : category.rating === 'weak' ? '⚠️' : '➖'}
                  </div>
                </div>
              ))}
            </div>

            {/* Category Strategy Summary */}
            <div className="mt-3 flex items-center justify-between text-sm">
              <div className="flex items-center space-x-4">
                {getTeamCategoryAnalysis().needsImprovement.length > 0 && (
                  <div className="flex items-center text-red-700">
                    <span className="font-medium">Target:</span>
                    <span className="ml-1">
                      {getTeamCategoryAnalysis()
                        .needsImprovement.slice(0, 2)
                        .map((cat) => cat.name)
                        .join(', ')}
                    </span>
                  </div>
                )}
                {getTeamCategoryAnalysis().strengths.length > 0 && (
                  <div className="flex items-center text-green-700">
                    <span className="font-medium">Strong:</span>
                    <span className="ml-1">
                      {getTeamCategoryAnalysis()
                        .strengths.slice(0, 2)
                        .map((cat) => cat.name)
                        .join(', ')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Draft Insights Banner */}
      {showRecommendations && isMyTurn && tab === 'available' && (
        <div className="w-full px-4 py-3 bg-gradient-to-r from-purple-50 to-blue-50 border-b border-purple-200">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0">
                <svg
                  className="h-6 w-6 text-purple-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                  />
                </svg>
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-purple-800 mb-1">AI Draft Strategy</h4>
                <p className="text-sm text-purple-700">
                  {(() => {
                    const teamAnalysis = getTeamCategoryAnalysis();
                    const myPicks = draftData.picks.filter(
                      (pick) => pick.member.id === currentUserId
                    );

                    if (myPicks.length === 0) {
                      return 'Start with high-volume players who contribute across multiple categories.';
                    }

                    if (teamAnalysis.needsImprovement.length > 0) {
                      const weakestCategory = teamAnalysis.needsImprovement[0];
                      return `Your team is weak in ${weakestCategory.name} (${weakestCategory.percentile}th percentile). Target players who excel in this category.`;
                    }

                    if (teamAnalysis.strengths.length > 0) {
                      const strongestCategory = teamAnalysis.strengths[0];
                      return `Your ${strongestCategory.name} is strong (${strongestCategory.percentile}th percentile). Consider reinforcing this advantage or diversifying into weaker areas.`;
                    }

                    return 'Your team is well-balanced across categories. Look for players with high upside potential.';
                  })()}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Auto-pick Timer Display */}
      {isMyTurn && autoPickEnabled && timeRemaining > 0 && (
        <div role="status" aria-live="polite" className="w-full px-4 py-2 bg-blue-50 border-b border-blue-200">
          <div className="max-w-7xl mx-auto text-center">
            <div className="flex items-center justify-center space-x-2 text-blue-800">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="font-medium">
                Auto-pick in {Math.floor(timeRemaining / 60)}:
                {(timeRemaining % 60).toString().padStart(2, '0')}
              </span>
              <button
                onClick={() => setAutoPickEnabled(false)}
                className="ml-2 text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"
              >
                Disable
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Smart Draft Assistant - Floating Widget */}
      {showRecommendations && isMyTurn && tab === 'available' && (
        <div className="fixed bottom-4 right-4 w-80 bg-white border border-blue-200 rounded-lg shadow-lg z-50">
          <div className="bg-blue-600 text-white p-3 rounded-t-lg">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold flex items-center">
                <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                  />
                </svg>
                AI Draft Assistant
              </h4>
              <button
                onClick={() => setShowRecommendations(false)}
                className="text-blue-200 hover:text-white"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
          <div className="p-4">
            <div className="text-sm text-gray-600 mb-3">Top recommendations for your draft:</div>
            {getPlayerRecommendations(3).map((player, index) => (
              <div
                key={player.id}
                className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0"
              >
                <div className="flex items-center space-x-2">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      index === 0
                        ? 'bg-yellow-400 text-yellow-900'
                        : index === 1
                          ? 'bg-gray-300 text-gray-700'
                          : 'bg-orange-300 text-orange-700'
                    }`}
                  >
                    {index + 1}
                  </div>
                  <div>
                    <div className="font-medium text-sm">{player.name}</div>
                    <div className="text-xs text-gray-500">
                      {player.position} - {player.club}
                    </div>
                  </div>
                </div>
                <div className="flex space-x-1">
                  <button
                    onClick={(e) => handleWatchlistToggleWithScroll(player.id, e)}
                    className={`text-sm px-2 py-1 rounded ${
                      isInWatchlist(player.id)
                        ? 'bg-red-100 text-red-600'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {isInWatchlist(player.id) ? '★' : '☆'}
                  </button>
                  <button
                    onClick={() => handlePlayerSelect(player)}
                    className="bg-blue-600 text-white text-sm px-2 py-1 rounded hover:bg-blue-700"
                  >
                    Draft
                  </button>
                </div>
              </div>
            ))}
            <div className="mt-3 text-center">
              <button
                onClick={() => setTab('recommendations')}
                className="text-blue-600 text-sm hover:text-blue-800"
              >
                View all recommendations →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live Pick Header */}
      <LivePickHeader
        draftData={liveDraftData}
        timePerPick={120} // You can make this configurable later
        isYourTurn={liveDraftState.isYourTurn}
        yourSlot={yourSlot} // Use the calculated slot
      />

      {/* Real-time Draft Status Bar */}
      {liveDraftData.status === 'LIVE' && (
        <div className="bg-white border-b border-gray-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                {/* Current Turn */}
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-sm font-medium text-gray-900">
                    Current Turn: {liveDraftState.currentTurn?.member.displayName || 'Loading...'}
                  </span>
                </div>

                {/* Live Timer */}
                <div className="flex items-center space-x-2">
                  <svg
                    className="h-4 w-4 text-gray-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span
                    className={`text-sm font-mono ${
                      liveDraftState.timeRemaining <= 30
                        ? 'text-red-600 font-bold'
                        : liveDraftState.timeRemaining <= 60
                          ? 'text-yellow-600 font-medium'
                          : 'text-gray-700'
                    }`}
                  >
                    {Math.floor(liveDraftState.timeRemaining / 60)}:
                    {(liveDraftState.timeRemaining % 60).toString().padStart(2, '0')}
                  </span>
                </div>

                {/* Pick Number */}
                <div className="text-sm text-gray-600">
                  Pick {liveDraftData.currentPick} of {liveDraftData.totalPicks}
                </div>
              </div>

              {/* Next Turn Preview */}
              <div className="flex items-center space-x-4">
                {/* Connection Status Dot */}
                <div className="flex items-center space-x-1">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      connectionState.status === 'connected'
                        ? 'bg-green-500'
                        : connectionState.status === 'reconnecting'
                          ? 'bg-yellow-500'
                          : 'bg-red-500'
                    }`}
                  ></div>
                  <span className="text-xs text-gray-500 capitalize">{connectionState.status}</span>
                </div>

                {!liveDraftState.isYourTurn && liveDraftState.picksUntilYourTurn > 0 && (
                  <div className="text-sm text-gray-600">
                    Your turn in {liveDraftState.picksUntilYourTurn} pick
                    {liveDraftState.picksUntilYourTurn !== 1 ? 's' : ''}
                  </div>
                )}

                {liveDraftState.nextTurn && (
                  <div className="text-sm text-gray-500">
                    Next: {liveDraftState.nextTurn.member.displayName}
                  </div>
                )}

                {/* Real-time Status Badge */}
                <div className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mr-1 animate-pulse"></div>
                  Real-time Sync Ready
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Last Pick Made Banner */}
      {lastPickMade && liveDraftData.status === 'LIVE' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 mx-4">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
              <svg
                className="h-4 w-4 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-blue-900">
                {lastPickMade.member.displayName} just drafted {lastPickMade.player.name}
              </p>
              <p className="text-xs text-blue-600">
                {lastPickMade.player.position} • {lastPickMade.player.club} • Pick #
                {lastPickMade.overall}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {/* Quick Action Prompt */}
        {liveDraftState.isYourTurn && liveDraftData.status === 'LIVE' && (
          <div role="status" aria-live="polite" className="bg-green-600 text-white p-4 rounded-lg shadow-md ring-1 ring-green-700/20">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-yellow-400 rounded-full animate-ping"></div>
              <div>
                <h3 className="font-bold text-lg">🎯 Your Turn to Pick!</h3>
                <p className="text-green-100">
                  Browse the Available Players tab below and select your next draft pick.
                </p>
                <p className="text-green-200 text-sm mt-1">
                  Time remaining: {Math.floor(liveDraftState.timeRemaining / 60)}:
                  {(liveDraftState.timeRemaining % 60).toString().padStart(2, '0')}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Draft Header with Settings */}
        <div className="bg-white rounded-lg border p-4">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center space-y-3 sm:space-y-0">
            <div>
              <h2 className="text-xl font-bold">Draft Room</h2>
              <p className="text-gray-600 text-sm">
                Pick {liveDraftData.currentPick} of {liveDraftData.totalPicks} | Round{' '}
                {Math.ceil(liveDraftData.currentPick / liveDraftData.participants.length)}
              </p>
              <div className="flex items-center space-x-2 mt-1">
                {renderStatusBadge(liveDraftData.status)}
                {connectionState.status === 'connected' && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1 animate-pulse"></div>
                    Live
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-2 sm:space-y-0 sm:space-x-3">
              {/* Fantasy Settings Button */}
              <Button
                onClick={() => setFantasySettingsModal(true)}
                className="w-full sm:w-auto bg-purple-600 text-white hover:bg-purple-700 px-4 py-2 text-sm"
              >
                ⚙️ Fantasy Settings
              </Button>

              {/* League Customization Button */}
              <Button
                onClick={() => setShowCustomizationModal(true)}
                className="w-full sm:w-auto bg-indigo-600 text-white hover:bg-indigo-700 px-4 py-2 text-sm"
              >
                🎛️ League Settings
              </Button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs
          tabs={[
            { value: 'available', label: `Available Players (${filteredPlayers.length})` },
            { value: 'recommendations', label: `🎯 Recommendations` },
            { value: 'watchlist', label: `Watchlist (${watchlistItems.length})` },
            { value: 'picks', label: `Draft Board (${draftData.picks.length})` },
            { value: 'pick-feed', label: 'Pick Feed' },
            { value: 'my-team', label: 'My Team' },
          ]}
          active={tab}
          onChange={setTab}
        />

        {/* Available Players Tab */}
        {tab === 'available' && (
          <div className="space-y-4">
            {/* Enhanced Filters */}
            <div className="bg-white rounded-lg border p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <div className="col-span-1 sm:col-span-2 md:col-span-1">
                  <label htmlFor="search" className="block text-sm font-medium mb-1">
                    Search Players
                  </label>
                  <div className="relative">
                    <input
                      id="search"
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search by name..."
                      className="w-full px-3 py-2 pl-8 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <svg
                      className="absolute left-2 top-2.5 h-4 w-4 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                    {search && (
                      <button
                        onClick={() => setSearch('')}
                        className="absolute right-2 top-2.5 h-4 w-4 text-gray-400 hover:text-gray-600"
                      >
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="position" className="block text-sm font-medium mb-1">
                    Position
                  </label>
                  <select
                    id="position"
                    value={positionFilter}
                    onChange={(e) => setPositionFilter(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    {POSITIONS.map((pos) => (
                      <option key={pos} value={pos}>
                        {pos}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="club" className="block text-sm font-medium mb-1">
                    Club
                  </label>
                  <select
                    id="club"
                    value={clubFilter}
                    onChange={(e) => setClubFilter(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    {CLUBS.map((club) => (
                      <option key={club} value={club}>
                        {club}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="sortBy" className="block text-sm font-medium mb-1">
                    Sort By
                  </label>
                  <select
                    id="sortBy"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as 'name' | 'position' | 'club')}
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="name">Name</option>
                    <option value="position">Position</option>
                    <option value="club">Club</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="sortOrder" className="block text-sm font-medium mb-1">
                    Order
                  </label>
                  <select
                    id="sortOrder"
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="asc">A-Z</option>
                    <option value="desc">Z-A</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="injuryFilter" className="block text-sm font-medium mb-1">
                    Injury Status
                  </label>
                  <select
                    id="injuryFilter"
                    value={injuryFilter}
                    onChange={(e) => setInjuryFilter(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="ALL">All Players</option>
                    <option value="HEALTHY">Healthy Only</option>
                    <option value="INJURED">Injured/Questionable</option>
                  </select>
                </div>
              </div>

              {/* Advanced Filters Row */}
              <div className="mt-4 pt-4 border-t">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="block text-sm font-medium">Quick Filters</div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { id: 'WATCHLIST_ONLY', label: 'Watchlist' },
                        { id: 'HIGH_SCORERS', label: 'Top Scorers' },
                      ].map((filter) => (
                        <button
                          key={filter.id}
                          onClick={() => {
                            if (quickFilters.includes(filter.id)) {
                              setQuickFilters(quickFilters.filter((f) => f !== filter.id));
                            } else {
                              setQuickFilters([...quickFilters, filter.id]);
                            }
                          }}
                          className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                            quickFilters.includes(filter.id)
                              ? 'bg-blue-100 border-blue-300 text-blue-700'
                              : 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {filter.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="block text-sm font-medium">Clear Filters</div>
                    <button
                      onClick={() => {
                        setSearch('');
                        setPositionFilter('ALL');
                        setClubFilter('ALL');
                        setInjuryFilter('ALL');
                        setQuickFilters([]);
                        setSortBy('name');
                        setSortOrder('asc');
                      }}
                      className="w-full px-3 py-2 bg-gray-100 hover:bg-gray-200 border rounded-md text-sm text-gray-700 transition-colors"
                    >
                      Reset All Filters
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Players Table */}
            <div ref={scrollContainerRef} className="bg-white rounded-lg border overflow-x-auto">
              <Table className="text-left w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="sticky left-0 bg-gray-50 px-4 py-3 font-medium text-left border-r border-gray-200 z-10">
                      Player
                    </th>
                    <th className="px-3 py-3 font-medium text-center">Total</th>
                    {leagueSettings.selectedCategories.map((category) => {
                      const categoryData = FANTASY_CATEGORIES[category];
                      return (
                        <th
                          key={category}
                          className="px-2 py-3 font-medium text-center text-xs whitespace-nowrap"
                        >
                          {categoryData?.abbrev || category}
                        </th>
                      );
                    })}
                    <th className="px-3 py-3 font-medium text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPlayers.map((player) => (
                    <PlayerRow key={player.id} player={player} />
                  ))}
                  {filteredPlayers.length === 0 && (
                    <tr>
                      <td
                        colSpan={3 + leagueSettings.selectedCategories.length}
                        className="px-4 py-8 text-center text-gray-500"
                      >
                        No players found matching your filters
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
          </div>
        )}

        {/* Recommendations Tab */}
        {tab === 'recommendations' && (
          <div className="space-y-4">
            {/* Recommendation Settings */}
            <div className="bg-white rounded-lg border p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">🎯 AI Draft Recommendations</h3>
                <Button
                  onClick={() => setShowRecommendations(!showRecommendations)}
                  className={`px-3 py-1 text-sm rounded ${
                    showRecommendations
                      ? 'bg-green-100 text-green-700 border border-green-300'
                      : 'bg-gray-100 text-gray-700 border border-gray-300'
                  }`}
                >
                  {showRecommendations ? 'Enabled' : 'Disabled'}
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <div className="block text-sm font-medium mb-2">Priority Positions</div>
                  <div className="space-y-1">
                    {POSITIONS.filter((pos) => pos !== 'ALL').map((position) => (
                      <label key={position} className="flex items-center">
                        <input
                          type="checkbox"
                          checked={recommendationCriteria.prioritizePositions.includes(position)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setRecommendationCriteria((prev) => ({
                                ...prev,
                                prioritizePositions: [...prev.prioritizePositions, position],
                              }));
                            } else {
                              setRecommendationCriteria((prev) => ({
                                ...prev,
                                prioritizePositions: prev.prioritizePositions.filter(
                                  (p) => p !== position
                                ),
                              }));
                            }
                          }}
                          className="mr-2"
                        />
                        <span className="text-sm">{position}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="block text-sm font-medium mb-2">Recommendation Criteria</div>
                  <div className="space-y-2">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={recommendationCriteria.avoidInjured}
                        onChange={(e) =>
                          setRecommendationCriteria((prev) => ({
                            ...prev,
                            avoidInjured: e.target.checked,
                          }))
                        }
                        className="mr-2"
                      />
                      <span className="text-sm">Avoid Injured Players</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={recommendationCriteria.focusOnValue}
                        onChange={(e) =>
                          setRecommendationCriteria((prev) => ({
                            ...prev,
                            focusOnValue: e.target.checked,
                          }))
                        }
                        className="mr-2"
                      />
                      <span className="text-sm">Focus on Fantasy Value</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={recommendationCriteria.considerTeamNeeds}
                        onChange={(e) =>
                          setRecommendationCriteria((prev) => ({
                            ...prev,
                            considerTeamNeeds: e.target.checked,
                          }))
                        }
                        className="mr-2"
                      />
                      <span className="text-sm">Consider Team Needs</span>
                    </label>
                  </div>
                </div>

                <div className="md:col-span-2">
                  <div className="block text-sm font-medium mb-2">Current Team Composition</div>
                  <div className="grid grid-cols-4 gap-2 text-sm">
                    {POSITIONS.filter((pos) => pos !== 'ALL').map((position) => {
                      const currentCount = draftData.picks
                        .filter((pick) => pick.member.id === currentUserId)
                        .filter((pick) => pick.player.position === position).length;
                      const maxForPosition =
                        leagueCustomization.positionLimits[
                          position as keyof typeof leagueCustomization.positionLimits
                        ] || 8;
                      return (
                        <div key={position} className="bg-gray-50 p-2 rounded text-center">
                          <div className="font-medium">{position}</div>
                          <div
                            className={`text-xs ${currentCount >= maxForPosition ? 'text-red-600' : 'text-green-600'}`}
                          >
                            {currentCount}/{maxForPosition}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Recommended Players */}
            {showRecommendations && (
              <div className="bg-white rounded-lg border overflow-hidden">
                <div className="p-4 bg-blue-50 border-b">
                  <h3 className="font-bold text-blue-800">🎯 Top Recommendations</h3>
                  <p className="text-sm text-blue-600">
                    Based on your team needs and league settings
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <Table className="text-left w-full min-w-max">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="px-4 py-3 font-medium text-center">Rank</th>
                        <th className="px-4 py-3 font-medium text-left">Player</th>
                        <th className="px-4 py-3 font-medium text-center">Position</th>
                        <th className="px-4 py-3 font-medium text-center">Club</th>
                        <th className="px-4 py-3 font-medium text-center">Fantasy Score</th>
                        <th className="px-4 py-3 font-medium text-center">AI Score</th>
                        <th className="px-4 py-3 font-medium text-center">Category Impact</th>
                        <th className="px-4 py-3 font-medium text-left">Reason</th>
                        <th className="px-4 py-3 font-medium text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getPlayerRecommendations(10).map((player, index) => (
                        <tr
                          key={player.id}
                          className={`border-b hover:bg-blue-50 ${index < 3 ? 'bg-yellow-50' : ''}`}
                        >
                          <td className="px-4 py-3 text-center">
                            <div
                              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mx-auto ${
                                index === 0
                                  ? 'bg-yellow-400 text-yellow-900'
                                  : index === 1
                                    ? 'bg-gray-300 text-gray-700'
                                    : index === 2
                                      ? 'bg-orange-300 text-orange-700'
                                      : 'bg-blue-100 text-blue-700'
                              }`}
                            >
                              {index + 1}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-medium">{player.name}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${
                                recommendationCriteria.prioritizePositions.includes(player.position)
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              {player.position}
                            </span>
                          </td>
                          <td className="px-4 py-3">{player.club}</td>
                          <td className="px-4 py-3 text-center">
                            {player.stats ? calculateTotalValue(player.stats).toFixed(1) : 'N/A'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${
                                (player.recommendationScore || 0) > 100
                                  ? 'bg-green-100 text-green-700'
                                  : (player.recommendationScore || 0) > 75
                                    ? 'bg-yellow-100 text-yellow-700'
                                    : 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              {(player.recommendationScore || 0).toFixed(0)}
                            </span>
                          </td>
                          <td className="px-2 py-3 text-xs">
                            {(() => {
                              if (!player.stats)
                                return <div className="text-gray-400">No data</div>;

                              const teamAnalysis = getTeamCategoryAnalysis();
                              const games = player.stats.games || 1;

                              // Show top 3 categories where this player would help
                              const categoryImpacts = CORE_FANTASY_CATEGORIES.map((cat) => {
                                const playerAvg = (player.stats![cat.key] || 0) / games;
                                const teamCat = teamAnalysis.categories.find(
                                  (tc) => tc.key === cat.key
                                );
                                const improvement = teamCat ? playerAvg - teamCat.leagueAverage : 0;
                                const isWeak = teamCat ? teamCat.rating === 'weak' : false;

                                return {
                                  category: cat,
                                  impact: improvement,
                                  isWeak,
                                  playerAvg,
                                  percentile: teamCat?.percentile || 50,
                                };
                              })
                                .filter((imp) => imp.impact > 0)
                                .sort((a, b) => {
                                  // Prioritize helping weak categories
                                  if (a.isWeak && !b.isWeak) return -1;
                                  if (!a.isWeak && b.isWeak) return 1;
                                  return b.impact - a.impact;
                                })
                                .slice(0, 3);

                              if (categoryImpacts.length === 0) {
                                return <div className="text-gray-400">Balanced</div>;
                              }

                              return (
                                <div className="space-y-1">
                                  {categoryImpacts.map((imp) => (
                                    <div
                                      key={imp.category.key}
                                      className={`flex items-center justify-between ${
                                        imp.isWeak ? 'text-red-600' : 'text-green-600'
                                      }`}
                                    >
                                      <span className="font-medium">{imp.category.name}</span>
                                      <span
                                        className={`px-1 rounded text-xs ${
                                          imp.isWeak ? 'bg-red-100' : 'bg-green-100'
                                        }`}
                                      >
                                        {imp.isWeak ? '🎯' : '💪'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {recommendationCriteria.prioritizePositions.includes(player.position) &&
                              '🎯 Priority Position '}
                            {(() => {
                              const currentCount = draftData.picks
                                .filter((pick) => pick.member.id === currentUserId)
                                .filter((pick) => pick.player.position === player.position).length;
                              const maxForPosition =
                                leagueCustomization.positionLimits[
                                  player.position as keyof typeof leagueCustomization.positionLimits
                                ] || 8;
                              if (currentCount < maxForPosition * 0.5) return '🔥 Team Need ';
                              return '';
                            })()}
                            {(() => {
                              if (!player.stats) return '';
                              const teamAnalysis = getTeamCategoryAnalysis();
                              const games = player.stats.games || 1;

                              // Check if player helps with weak categories
                              const helpfulWeakCategories = teamAnalysis.needsImprovement.filter(
                                (weakCat) => {
                                  const playerAvg = (player.stats![weakCat.key] || 0) / games;
                                  return playerAvg > weakCat.leagueAverage * 1.1; // 10% above league average
                                }
                              );

                              if (helpfulWeakCategories.length > 0) {
                                return `🎯 Improves ${helpfulWeakCategories[0].name} `;
                              }

                              // Check if player reinforces strong categories
                              const reinforcesStrengths = teamAnalysis.strengths.filter(
                                (strongCat) => {
                                  const playerAvg = (player.stats![strongCat.key] || 0) / games;
                                  return playerAvg > strongCat.leagueAverage * 1.2; // 20% above league average
                                }
                              );

                              if (reinforcesStrengths.length > 0) {
                                return `💪 Elite ${reinforcesStrengths[0].name} `;
                              }

                              // Fallback to total value
                              if (calculateTotalValue(player.stats) > 80) {
                                return '⭐ High Value ';
                              }

                              return '';
                            })()}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex space-x-2">
                              <Button
                                onClick={() => handlePlayerSelect(player)}
                                disabled={isLoading}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm"
                              >
                                Draft
                              </Button>
                              <Button
                                onClick={(e) => handleWatchlistToggleWithScroll(player.id, e)}
                                className={`px-3 py-1 rounded text-sm ${
                                  isInWatchlist(player.id)
                                    ? 'bg-red-100 text-red-700 hover:bg-red-200'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                              >
                                {isInWatchlist(player.id) ? '★' : '☆'}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Watchlist Tab */}
        {tab === 'watchlist' && (
          <div className="h-[600px]">
            <DraftWatchlist
              players={players}
              draftedPlayerIds={draftData.picks.map((pick) => pick.player.id)}
              onDraftPlayer={handlePlayerSelect}
              canDraft={isYourTurn || true} // Allow admin override
              className="h-full"
              watchlistItems={watchlistItems}
              onRemoveFromWatchlist={removeFromWatchlist}
            />
          </div>
        )}

        {/* Draft Board Tab */}
        {tab === 'picks' && (
          <div className="bg-white rounded-lg border overflow-hidden">
            {(() => {
              // Group picks by round
              const picksByRound = draftData.picks.reduce((acc, pick) => {
                if (!acc[pick.round]) {
                  acc[pick.round] = [];
                }
                acc[pick.round].push(pick);
                return acc;
              }, {} as Record<number, typeof draftData.picks>);

              const rounds = Object.keys(picksByRound).map(Number).sort((a, b) => a - b);
              
              // Generate gradient colors for rounds
              const getGradientForRound = (roundNum: number, totalRounds: number) => {
                const hue = (roundNum - 1) * (360 / Math.max(totalRounds, 1));
                return {
                  background: `linear-gradient(135deg, 
                    hsl(${hue}, 35%, 97%) 0%, 
                    hsl(${hue + 20}, 40%, 95%) 100%)`,
                  border: `hsl(${hue}, 30%, 85%)`,
                  text: `hsl(${hue}, 50%, 25%)`
                };
              };

              const maxRounds = Math.max(...rounds, 1);

              if (draftData.picks.length === 0) {
                return (
                  <div className="p-8 text-center text-gray-500">
                    <svg className="h-12 w-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012-2m-6 9l2 2 4-4" />
                    </svg>
                    <p className="text-lg font-medium">No picks made yet</p>
                    <p className="text-sm">The draft board will show picks organized by round</p>
                  </div>
                );
              }

              return (
                <div className="space-y-6">
                  {rounds.map((roundNum) => {
                    const roundPicks = picksByRound[roundNum];
                    const gradientStyle = getGradientForRound(roundNum, maxRounds);
                    
                    return (
                      <div 
                        key={roundNum} 
                        className="rounded-lg border shadow-sm overflow-hidden"
                        style={{ 
                          background: gradientStyle.background,
                          borderColor: gradientStyle.border 
                        }}
                      >
                        {/* Round Header */}
                        <div 
                          className="px-6 py-4 border-b"
                          style={{ 
                            borderBottomColor: gradientStyle.border,
                            color: gradientStyle.text
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <h3 className="text-lg font-bold flex items-center">
                              <span className="mr-2">🏆</span>
                              Round {roundNum}
                            </h3>
                            <div className="flex items-center space-x-4 text-sm">
                              <span className="opacity-75">
                                {roundPicks.length} pick{roundPicks.length !== 1 ? 's' : ''} made
                              </span>
                              <span 
                                className="px-2 py-1 rounded-full text-xs font-medium"
                                style={{ 
                                  backgroundColor: `hsl(${(roundNum - 1) * (360 / maxRounds)}, 40%, 90%)`,
                                  color: gradientStyle.text
                                }}
                              >
                                {roundNum % 2 === 1 ? '→ Forward' : '← Reverse'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Round Picks Table */}
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead>
                              <tr 
                                className="text-left"
                                style={{ 
                                  backgroundColor: `hsl(${(roundNum - 1) * (360 / maxRounds)}, 25%, 94%)`,
                                  color: gradientStyle.text
                                }}
                              >
                                <th className="px-4 py-3 font-medium">Pick</th>
                                <th className="px-4 py-3 font-medium">Team</th>
                                <th className="px-4 py-3 font-medium">Player</th>
                                <th className="px-4 py-3 font-medium">Position</th>
                                <th className="px-4 py-3 font-medium">Club</th>
                                <th className="px-4 py-3 font-medium">Time</th>
                              </tr>
                            </thead>
                            <tbody>
                              {roundPicks
                                .sort((a, b) => a.overall - b.overall)
                                .map((pick) => (
                                <tr 
                                  key={pick.id} 
                                  className="border-b border-opacity-30 hover:bg-black hover:bg-opacity-5 transition-colors"
                                  style={{ borderColor: gradientStyle.border }}
                                >
                                  <td className="px-4 py-3">
                                    <div className="flex items-center space-x-2">
                                      <span 
                                        className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                                        style={{ 
                                          backgroundColor: `hsl(${(roundNum - 1) * (360 / maxRounds)}, 50%, 85%)`,
                                          color: gradientStyle.text
                                        }}
                                      >
                                        {pick.overall}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 font-medium">{pick.member.displayName}</td>
                                  <td className="px-4 py-3">
                                    <div className="flex items-center space-x-2">
                                      <span className="font-semibold">{pick.player.name}</span>
                                      {pick.auto && (
                                        <span 
                                          className="px-2 py-1 rounded text-xs font-medium"
                                          style={{ 
                                            backgroundColor: 'rgba(245, 158, 11, 0.1)',
                                            color: '#d97706'
                                          }}
                                        >
                                          Auto
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3">
                                    <span 
                                      className="px-2 py-1 rounded text-xs font-medium"
                                      style={{ 
                                        backgroundColor: `hsl(${(roundNum - 1) * (360 / maxRounds)}, 30%, 88%)`,
                                        color: gradientStyle.text
                                      }}
                                    >
                                      {pick.player.position}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-sm">{pick.player.club}</td>
                                  <td className="px-4 py-3 text-sm opacity-75">
                                    {new Date(pick.madeAt).toLocaleTimeString([], { 
                                      hour: '2-digit', 
                                      minute: '2-digit' 
                                    })}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* Pick Feed Tab */}
        {tab === 'pick-feed' && (
          <div className="space-y-4">
            {/* Recent Activity Feed */}
            {recentActivity.length > 0 && (
              <div className="bg-white rounded-lg border p-4">
                <h3 className="font-semibold text-gray-900 mb-3">Recent Activity</h3>
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {recentActivity.slice(0, 10).map((activity) => (
                    <div key={activity.id} className="flex items-start space-x-2 text-sm">
                      <span
                        className={`inline-block w-2 h-2 rounded-full mt-1.5 ${
                          activity.type === 'pick'
                            ? 'bg-green-500'
                            : activity.type === 'join'
                              ? 'bg-blue-500'
                              : activity.type === 'leave'
                                ? 'bg-red-500'
                                : 'bg-gray-500'
                        }`}
                      ></span>
                      <div className="flex-1">
                        <p className="text-gray-900">{activity.message}</p>
                        <p className="text-gray-500 text-xs">
                          {new Date(activity.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Traditional Pick Feed */}
            <div className="h-[400px]">
              <PickFeed
                picks={liveDraftData.picks}
                participants={liveDraftData.participants}
                userMemberId={liveDraftData.participants[0]?.member.id || ''}
                watchlistPlayerIds={watchlistItems.map((item) => item.playerId)}
                className="h-full"
              />
            </div>
          </div>
        )}

        {/* My Team Tab */}
        {tab === 'my-team' && (
          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="p-4 bg-green-50 border-b">
              <h3 className="font-bold text-green-800">Your Team (Slot 1)</h3>
              <p className="text-sm text-green-600">
                {liveDraftData.picks?.filter(
                  (pick) => pick.member.id === liveDraftData.participants?.[0]?.member.id
                ).length || 0}{' '}
                players selected
              </p>
            </div>
            <Table className="text-left">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-3 font-medium">Pick #</th>
                  <th className="px-4 py-3 font-medium">Round</th>
                  <th className="px-4 py-3 font-medium">Player</th>
                  <th className="px-4 py-3 font-medium">Position</th>
                  <th className="px-4 py-3 font-medium">Club</th>
                  <th className="px-4 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {(liveDraftData.picks || [])
                  .filter((pick) => pick.member.id === liveDraftData.participants?.[0]?.member.id)
                  .map((pick) => (
                    <tr key={pick.id} className="odd:bg-green-25 hover:bg-green-50">
                      <td className="px-4 py-2 font-bold text-green-700">#{pick.overall}</td>
                      <td className="px-4 py-2">{pick.round}</td>
                      <td className="px-4 py-2 font-medium">{pick.player.name}</td>
                      <td className="px-4 py-2">{pick.player.position}</td>
                      <td className="px-4 py-2">{pick.player.club}</td>
                      <td className="px-4 py-2 text-sm text-gray-500">
                        {new Date(pick.madeAt).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                {liveDraftData.picks.filter(
                  (pick) => pick.member.id === liveDraftData.participants[0]?.member.id
                ).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      No picks made yet. Make your first pick when it&apos;s your turn!
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </div>
        )}

        {/* Enhanced Confirmation Modal with Validation */}
        <Modal open={confirmModal.open} onClose={() => setConfirmModal({ open: false })}>
          {confirmModal.player && (
            <div className="p-6">
              <h3 className="text-lg font-bold mb-4 flex items-center">
                <svg
                  className="h-5 w-5 mr-2 text-green-600"
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
                {isMyTurn ? 'Confirm Your Draft Pick' : 'Admin Override Pick'}
              </h3>

              {/* Draft State Information */}
              <div className="mb-4 p-3 bg-blue-50 rounded-lg">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-blue-800">
                    {(() => {
                      const draftState = getDraftState();
                      return draftState
                        ? `Round ${draftState.currentRound}, Pick #${draftState.currentPickNumber}`
                        : 'Loading...';
                    })()}
                  </span>
                  <span className="text-blue-600">
                    {(() => {
                      const draftState = getDraftState();
                      return draftState
                        ? draftState.draftType === 'snake'
                          ? '🐍 Snake Draft'
                          : '📊 Linear Draft'
                        : 'Loading...';
                    })()}
                  </span>
                </div>
              </div>

              <div className="mb-6">
                <p className="text-gray-600 mb-2">
                  {isMyTurn
                    ? 'You are about to draft:'
                    : `Making pick for ${(() => {
                        const draftState = getDraftState();
                        return draftState?.currentDrafter?.member.displayName || 'Unknown';
                      })()}:`}
                </p>
                <div
                  className={`p-4 rounded border-2 ${isMyTurn ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-lg">{confirmModal.player.name}</p>
                      <p className="text-gray-600">
                        {confirmModal.player.position} - {confirmModal.player.club}
                      </p>
                      {confirmModal.player.stats && (
                        <p className="text-sm text-gray-500 mt-1">
                          Fantasy Value: {calculateTotalValue(confirmModal.player.stats).toFixed(1)}
                        </p>
                      )}
                    </div>
                    {confirmModal.player.injuryStatus &&
                      confirmModal.player.injuryStatus !== 'healthy' && (
                        <div className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs">
                          ⚠️ {confirmModal.player.injuryStatus}
                        </div>
                      )}
                  </div>
                </div>

                {/* Pick Validation Status */}
                {(() => {
                  const validation = validatePick(confirmModal.player);
                  return (
                    <div
                      className={`mt-3 p-3 rounded-lg ${
                        validation.isValid
                          ? 'bg-green-50 border border-green-200'
                          : 'bg-red-50 border border-red-200'
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        {validation.isValid ? (
                          <>
                            <svg
                              className="h-4 w-4 text-green-600"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                            <span className="text-green-800 font-medium">
                              Pick validated - Ready to draft!
                            </span>
                          </>
                        ) : (
                          <>
                            <svg
                              className="h-4 w-4 text-red-600"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12"
                              />
                            </svg>
                            <span className="text-red-800 font-medium">Validation failed:</span>
                          </>
                        )}
                      </div>
                      {!validation.isValid && (
                        <ul className="mt-2 text-sm text-red-700 space-y-1">
                          {validation.errors.map((error, index) => (
                            <li key={index} className="flex items-start space-x-1">
                              <span>•</span>
                              <span>{error}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-4">
                {(() => {
                  const validation = validatePick(confirmModal.player);
                  return (
                    <Button
                      onClick={handleConfirmPick}
                      disabled={isLoading || !validation.isValid || pickValidation.isPicking}
                      className={`px-6 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed ${
                        validation.isValid && isMyTurn
                          ? 'bg-green-600 text-white hover:bg-green-700'
                          : validation.isValid
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'bg-gray-400 text-white cursor-not-allowed'
                      }`}
                    >
                      {pickValidation.isPicking ? (
                        <span className="flex items-center">
                          <svg
                            className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            ></circle>
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            ></path>
                          </svg>
                          Processing...
                        </span>
                      ) : isLoading ? (
                        'Making Pick...'
                      ) : validation.isValid ? (
                        isMyTurn ? (
                          'Confirm Pick'
                        ) : (
                          'Override Pick'
                        )
                      ) : (
                        'Cannot Draft'
                      )}
                    </Button>
                  );
                })()}
                <Button
                  onClick={() => setConfirmModal({ open: false })}
                  className="bg-gray-600 text-white px-6 py-2 rounded hover:bg-gray-700"
                  disabled={pickValidation.isPicking}
                >
                  Cancel
                </Button>
              </div>

              {/* Time-sensitive warning */}
              {isMyTurn && autoPickEnabled && timeRemaining < 30 && (
                <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-center space-x-2 text-yellow-800">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                      />
                    </svg>
                    <span className="text-sm font-medium">
                      Warning: Auto-pick will trigger in {timeRemaining} seconds
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </Modal>

        {/* Fantasy Settings Modal */}
        <Modal open={fantasySettingsModal} onClose={() => setFantasySettingsModal(false)}>
          <div className="max-w-4xl w-full max-h-[80vh] overflow-y-auto">
            <FantasyLeagueSettings
              initialSettings={leagueSettings}
              onSave={(settings) => {
                setLeagueSettings(settings);
                setFantasySettingsModal(false);
              }}
              onCancel={() => setFantasySettingsModal(false)}
              maxCategories={9}
            />
          </div>
        </Modal>

        {/* League Customization Modal */}
        <Modal open={showCustomizationModal} onClose={() => setShowCustomizationModal(false)}>
          <div className="p-6 max-w-4xl w-full max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-bold mb-6 flex items-center">
              <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              League Customization Settings
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Draft Settings */}
              <div className="space-y-4">
                <h4 className="font-semibold text-gray-900 border-b pb-2">Draft Settings</h4>

                <div>
                  <label htmlFor="autoPickTime" className="block text-sm font-medium mb-1">
                    Auto-pick Timer (seconds)
                  </label>
                  <input
                    id="autoPickTime"
                    type="number"
                    min="30"
                    max="300"
                    value={leagueCustomization.autoPickTime}
                    onChange={(e) =>
                      setLeagueCustomization((prev) => ({
                        ...prev,
                        autoPickTime: Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 border rounded-md"
                  />
                </div>

                <div>
                  <label htmlFor="draftStyle" className="block text-sm font-medium mb-1">
                    Draft Style
                  </label>
                  <select
                    id="draftStyle"
                    value={leagueCustomization.draftStyle}
                    onChange={(e) =>
                      setLeagueCustomization((prev) => ({
                        ...prev,
                        draftStyle: e.target.value as 'snake' | 'linear',
                      }))
                    }
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="snake">Snake Draft</option>
                    <option value="linear">Linear Draft</option>
                  </select>
                </div>

                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={leagueCustomization.showFantasyScores}
                      onChange={(e) =>
                        setLeagueCustomization((prev) => ({
                          ...prev,
                          showFantasyScores: e.target.checked,
                        }))
                      }
                      className="mr-2"
                    />
                    <span className="text-sm">Show Fantasy Scores</span>
                  </label>
                </div>
              </div>

              {/* Position Limits */}
              <div className="space-y-4">
                <h4 className="font-semibold text-gray-900 border-b pb-2">Position Limits</h4>

                {Object.entries(leagueCustomization.positionLimits).map(([position, limit]) => (
                  <div key={position}>
                    <label htmlFor={`limit-${position}`} className="block text-sm font-medium mb-1">
                      {position} Limit
                    </label>
                    <input
                      id={`limit-${position}`}
                      type="number"
                      min="1"
                      max="15"
                      value={limit}
                      onChange={(e) =>
                        setLeagueCustomization((prev) => ({
                          ...prev,
                          positionLimits: {
                            ...prev.positionLimits,
                            [position]: Number(e.target.value),
                          },
                        }))
                      }
                      className="w-full px-3 py-2 border rounded-md"
                    />
                  </div>
                ))}
              </div>

              {/* Display Preferences */}
              <div className="space-y-4 md:col-span-2">
                <h4 className="font-semibold text-gray-900 border-b pb-2">Display Preferences</h4>

                <div>
                  <label htmlFor="defaultSort" className="block text-sm font-medium mb-1">
                    Default Player Sort
                  </label>
                  <select
                    id="defaultSort"
                    value={leagueCustomization.defaultSort}
                    onChange={(e) =>
                      setLeagueCustomization((prev) => ({
                        ...prev,
                        defaultSort: e.target.value as 'name' | 'position' | 'club' | 'fantasy',
                      }))
                    }
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="name">Name</option>
                    <option value="position">Position</option>
                    <option value="club">Club</option>
                    <option value="fantasy">Fantasy Score</option>
                  </select>
                </div>

                <div>
                  <div className="block text-sm font-medium mb-2">Visible Player Stats</div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      'goals',
                      'kicks',
                      'handballs',
                      'marks',
                      'tackles',
                      'hitouts',
                      'clearances',
                      'inside50s',
                      'intercepts',
                    ].map((stat) => (
                      <label key={stat} className="flex items-center">
                        <input
                          type="checkbox"
                          checked={leagueCustomization.showPlayerStats.includes(stat)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setLeagueCustomization((prev) => ({
                                ...prev,
                                showPlayerStats: [...prev.showPlayerStats, stat],
                              }));
                            } else {
                              setLeagueCustomization((prev) => ({
                                ...prev,
                                showPlayerStats: prev.showPlayerStats.filter((s) => s !== stat),
                              }));
                            }
                          }}
                          className="mr-2"
                        />
                        <span className="text-sm capitalize">{stat}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 flex justify-end space-x-3">
              <Button
                onClick={() => setShowCustomizationModal(false)}
                className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  // Save settings logic would go here
                  if (isDevelopment) console.log('Saving league customization:', leagueCustomization);
                  setShowCustomizationModal(false);
                }}
                className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
              >
                Save Settings
              </Button>
            </div>
          </div>
        </Modal>

        {/* Draft Order Management Modal */}
        <Modal
          open={draftOrderManagement.showOrderModal}
          onClose={() => setDraftOrderManagement((prev) => ({ ...prev, showOrderModal: false }))}
        >
          <div className="p-6 max-w-2xl">
            <h3 className="text-lg font-bold mb-4 flex items-center">
              <svg
                className="h-5 w-5 mr-2 text-indigo-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012-2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                />
              </svg>
              Draft Order Management
            </h3>

            <div className="space-y-6">
              {/* Current vs Customized Order */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Current Order */}
                <div>
                  <h4 className="font-medium text-gray-800 mb-3">Current Order</h4>
                  <div className="space-y-2 bg-gray-50 p-3 rounded-lg">
                    {(() => {
                      const draftState = getDraftState();
                      if (!draftState) {
                        return (
                          <div className="text-center text-gray-500 py-4">
                            Loading draft order...
                          </div>
                        );
                      }
                      return draftState.draftOrder.map((userId, index) => {
                        const participant = draftData.participants.find(
                          (p) => p.member.id === userId
                        );
                        return participant ? (
                          <div
                            key={userId}
                            className="flex items-center space-x-3 p-2 bg-white rounded"
                          >
                            <span className="w-6 h-6 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center text-sm font-medium">
                              {index + 1}
                            </span>
                            <span className="text-sm">{participant.member.displayName}</span>
                          </div>
                        ) : null;
                      });
                    })()}
                  </div>
                </div>

                {/* New Order Preview */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-medium text-gray-800">New Order Preview</h4>
                    <button
                      onClick={randomizeDraftOrder}
                      disabled={draftOrderManagement.isRandomizing}
                      className="bg-purple-600 text-white px-3 py-1 rounded text-sm hover:bg-purple-700 disabled:opacity-50"
                    >
                      {draftOrderManagement.isRandomizing ? '🎲 Randomizing...' : '🎲 Randomize'}
                    </button>
                  </div>

                  <div className="space-y-2 bg-purple-50 p-3 rounded-lg">
                    {draftOrderManagement.isRandomizing ? (
                      <div className="text-center py-8">
                        <div className="animate-spin w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full mx-auto mb-2"></div>
                        <p className="text-sm text-purple-600">Shuffling order...</p>
                      </div>
                    ) : draftOrderManagement.tempOrder.length > 0 ? (
                      draftOrderManagement.tempOrder.map((userId, index) => {
                        const participant = draftData.participants.find(
                          (p) => p.member.id === userId
                        );
                        return participant ? (
                          <div
                            key={userId}
                            className="flex items-center space-x-3 p-2 bg-white rounded shadow-sm"
                          >
                            <span className="w-6 h-6 bg-purple-100 text-purple-700 rounded-full flex items-center justify-center text-sm font-medium">
                              {index + 1}
                            </span>
                            <span className="text-sm">{participant.member.displayName}</span>
                            {index === 0 && (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                                First Pick
                              </span>
                            )}
                          </div>
                        ) : null;
                      })
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        <p className="text-sm">
                          Click &ldquo;Randomize&rdquo; to generate a new order
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Draft Type Info */}
              <div className="bg-blue-50 p-4 rounded-lg">
                <h5 className="font-medium text-blue-800 mb-2">Draft Format Information</h5>
                <div className="text-sm text-blue-700 space-y-1">
                  <p>
                    <strong>Snake Draft:</strong> Order reverses each round (1→N, then N→1).
                    Provides balanced pick values.
                  </p>
                  {(() => {
                    const draftState = getDraftState();
                    return draftState ? (
                      <>
                        <p>
                          <strong>Current Format:</strong>{' '}
                          {draftState.draftType === 'snake' ? '🐍 Snake Draft' : '📊 Linear Draft'}
                        </p>
                        <p>
                          <strong>Total Rounds:</strong> {draftState.maxRounds}
                        </p>
                      </>
                    ) : (
                      <p>
                        <strong>Draft information loading...</strong>
                      </p>
                    );
                  })()}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() =>
                    setDraftOrderManagement((prev) => ({ ...prev, showOrderModal: false }))
                  }
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  onClick={saveDraftOrder}
                  disabled={draftOrderManagement.tempOrder.length === 0}
                  className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Apply New Order
                </button>
              </div>
            </div>
          </div>
        </Modal>

        {/* Keyboard Shortcuts Help Modal */}
        <Modal open={showKeyboardHelp} onClose={() => setShowKeyboardHelp(false)}>
          <div className="p-6 max-w-md">
            <h3 className="text-lg font-bold mb-4 flex items-center">
              <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Keyboard Shortcuts
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="font-medium">Search Players</span>
                <kbd className="px-2 py-1 bg-gray-100 rounded text-xs">/</kbd>
              </div>
              <div className="flex justify-between">
                <span className="font-medium">Undo Last Pick</span>
                <kbd className="px-2 py-1 bg-gray-100 rounded text-xs">Ctrl + U</kbd>
              </div>
              <div className="flex justify-between">
                <span className="font-medium">Switch Tabs</span>
                <kbd className="px-2 py-1 bg-gray-100 rounded text-xs">1-5</kbd>
              </div>
              <div className="flex justify-between">
                <span className="font-medium">Close Modals</span>
                <kbd className="px-2 py-1 bg-gray-100 rounded text-xs">Esc</kbd>
              </div>
              <div className="flex justify-between">
                <span className="font-medium">Show This Help</span>
                <kbd className="px-2 py-1 bg-gray-100 rounded text-xs">?</kbd>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <Button
                onClick={() => setShowKeyboardHelp(false)}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              >
                Got it!
              </Button>
            </div>
          </div>
        </Modal>

        {/* Watchlist Player Alerts */}
        <WatchlistPlayerAlert
          alerts={alerts}
          onDismiss={dismissAlert}
          onDismissAll={dismissAllAlerts}
        />

        {/* Global confirmation modal (pause/resume) */}
        {ConfirmationModal}
      </div>
    </div>
  );
}
