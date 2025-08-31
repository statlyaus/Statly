'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Alert } from '@/components/ui';
import type { LobbyState, WatchlistItem, PreDraftQueueItem } from '@/lib/draftLobby';

// Basic player type for draft lobby
interface Player {
  id: string;
  name: string;
  position: string;
  club: string;
  value?: number;
}

interface DraftLobbyProps {
  draftId: string;
  memberId: string;
  onDraftStart: () => void;
  forcedLobbyState?: LobbyState; // Optional forced state to bypass API
}

export default function DraftLobby({ draftId, memberId, onDraftStart, forcedLobbyState }: DraftLobbyProps) {
  const [lobbyState, setLobbyState] = useState<LobbyState | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [preDraftQueue, setPreDraftQueue] = useState<PreDraftQueueItem[]>([]);
  const [activeTab, setActiveTab] = useState<'players' | 'queue' | 'watchlist'>('players');
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [excludedPlayers, setExcludedPlayers] = useState<Set<string>>(new Set());
  const [playerOrder, setPlayerOrder] = useState<string[]>([]);
  const [searchTerm, _setSearchTerm] = useState('');
  const [positionFilter, _setPositionFilter] = useState<string>('ALL');
  const [clubFilter, _setClubFilter] = useState<string>('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftStartCalled, setDraftStartCalled] = useState(false);
  const [mockDraftPicks, setMockDraftPicks] = useState<Player[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const initialSave = useRef(true);

  // Countdown timer
  const [timeRemaining, setTimeRemaining] = useState(0);

  useEffect(() => {
    if (forcedLobbyState) {
      // Use forced state instead of fetching from API
      console.log('Using forced lobby state:', forcedLobbyState);
      setLobbyState(forcedLobbyState);
      setIsLoading(false);
      return; // Don't set up interval
    }

    void fetchLobbyData();
    const interval = setInterval(() => void fetchLobbyData(), 5000); // Update every 5 seconds instead of 1
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, memberId, forcedLobbyState]);

  // Fetch all players on component mount
  useEffect(() => {
    fetchAllPlayers();
    void loadSavedPreferences();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, memberId]);

  useEffect(() => {
    if (lobbyState?.timeRemaining !== undefined) {
      setTimeRemaining(lobbyState.timeRemaining);
    }
  }, [lobbyState?.timeRemaining]);

  useEffect(() => {
    if (timeRemaining > 0) {
      const timer = setTimeout(() => {
        setTimeRemaining(prev => Math.max(0, prev - 1));
      }, 1000);
      return () => clearTimeout(timer);
    } else if (timeRemaining === 0 && lobbyState?.status === 'COUNTDOWN' && !draftStartCalled) {
      // Only trigger draft start once, and prevent multiple calls
      console.log('Countdown complete, starting draft...');
      setDraftStartCalled(true);
      setTimeout(() => {
        onDraftStart();
      }, 100); // Small delay to prevent race conditions
    }
  }, [timeRemaining, lobbyState?.status, onDraftStart, draftStartCalled]);

  const fetchLobbyData = useCallback(async () => {
    try {
      console.log('Fetching lobby data for draft:', draftId);

      // Only fetch lobby state, skip watchlist and queue for now to reduce complexity
      const lobbyResponse = await fetch(`/api/drafts/${draftId}/lobby`);

      if (lobbyResponse.ok) {
        const lobbyData = await lobbyResponse.json();
        console.log('Lobby data received:', lobbyData.data);
        setLobbyState(lobbyData.data);
        setError(null); // Clear any previous errors
      } else {
        const errorText = await lobbyResponse.text();
        console.error('Lobby API error:', errorText);
        setError(`Failed to load lobby data: ${lobbyResponse.status}`);
      }

      setIsLoading(false);
    } catch (err) {
      console.error('Lobby fetch error:', err);
      setError('Failed to load lobby data');
      setIsLoading(false);
    }
  }, [draftId]);

  const fetchAllPlayers = useCallback(async () => {
    try {
      const response = await fetch('/api/players?limit=1000');
      if (response.ok) {
        const data = await response.json();
        setAllPlayers(data.players || []);

        // Initialize player order if not already set
        if (playerOrder.length === 0) {
          setPlayerOrder(data.players?.map((p: Player) => p.id) || []);
        }
      }
    } catch (err) {
      console.error('Failed to fetch players:', err);
    }
  }, [playerOrder.length]);

  const loadSavedPreferences = useCallback(async () => {
    try {
      // Try backend first
      const res = await fetch(
        `/api/user/rankings?draftId=${draftId}&memberId=${memberId}`
      );
      if (res.ok) {
        const data = await res.json();
        setExcludedPlayers(new Set(data.excludedPlayers || []));
        setPlayerOrder(data.playerOrder || []);
        setWatchlist(data.watchlist || []);
        setPreDraftQueue(data.preDraftQueue || []);
        return;
      }
    } catch (err) {
      console.error('Failed to fetch saved preferences from server:', err);
    }
    // Fallback to local storage
    try {
      const saved = localStorage.getItem(`draft-preferences-${draftId}-${memberId}`);
      if (saved) {
        const preferences = JSON.parse(saved);
        setExcludedPlayers(new Set(preferences.excludedPlayers || []));
        setPlayerOrder(preferences.playerOrder || []);
        setWatchlist(preferences.watchlist || []);
        setPreDraftQueue(preferences.preDraftQueue || []);
      }
    } catch (err) {
      console.error('Failed to load saved preferences:', err);
    } finally {
      setPreferencesLoaded(true);
    }
  }, [draftId, memberId]);

  const savePreferences = useCallback(() => {
    try {
      const preferences = {
        draftId,
        memberId,
        excludedPlayers: Array.from(excludedPlayers),
        playerOrder,
        watchlist,
        preDraftQueue,
        timestamp: Date.now()
      };
      localStorage.setItem(
        `draft-preferences-${draftId}-${memberId}`,
        JSON.stringify(preferences)
      );
      // Persist to backend (fire and forget)
      fetch('/api/user/rankings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences)
      }).catch(err => console.error('Failed to persist rankings:', err));
    } catch (err) {
      console.error('Failed to save preferences:', err);
    }
  }, [draftId, memberId, excludedPlayers, playerOrder, watchlist, preDraftQueue]);

  const fetchAiSuggestions = useCallback(async () => {
    setAiLoading(true);
    try {
      const res = await fetch('/api/rankings/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ players: allPlayers })
      });
      const data = (await res.json()) as { suggestions: { playerId: string }[] };
      if (Array.isArray(data.suggestions)) {
        const suggestionOrder = data.suggestions.map((s) => s.playerId);
        setPlayerOrder(prev => {
          const remaining = prev.filter(id => !suggestionOrder.includes(id));
          return [...suggestionOrder, ...remaining];
        });
      }
    } catch (err) {
      console.error('AI suggestion error:', err);
    } finally {
      setAiLoading(false);
    }
  }, [allPlayers]);

  const allPlayersById = useMemo(() => new Map(allPlayers.map(p => [p.id, p])), [allPlayers]);

  const runMockDraft = useCallback(() => {
    const availableIds = playerOrder.filter(id => !excludedPlayers.has(id));
    const picks = availableIds
      .slice(0, 10)
      .map(id => allPlayersById.get(id))
      .filter((p): p is Player => !!p);
    setMockDraftPicks(picks);
  }, [playerOrder, excludedPlayers, allPlayersById]);

  // Auto-save preferences when they change
  useEffect(() => {
    if (!preferencesLoaded) return;
    if (initialSave.current) {
      initialSave.current = false;
      return;
    }
    savePreferences();
  }, [savePreferences, preferencesLoaded]);

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${remainingSeconds}s`;
    }
  };

  const _togglePlayerExclusion = (playerId: string) => {
    const newExcluded = new Set(excludedPlayers);
    if (newExcluded.has(playerId)) {
      newExcluded.delete(playerId);
    } else {
      newExcluded.add(playerId);
    }
    setExcludedPlayers(newExcluded);
  };

  const _movePlayerInOrder = (playerId: string, direction: 'up' | 'down') => {
    const currentIndex = playerOrder.indexOf(playerId);
    if (currentIndex === -1) return;

    const newOrder = [...playerOrder];
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

    if (targetIndex >= 0 && targetIndex < newOrder.length) {
      [newOrder[currentIndex], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[currentIndex]];
      setPlayerOrder(newOrder);
    }
  };

  const _addToWatchlist = (player: Player) => {
    if (!watchlist.find(w => w.playerId === player.id)) {
      const newItem = {
        id: `watchlist-${Date.now()}`,
        playerId: player.id,
        priority: watchlist.length + 1,
        notes: '',
        player
      };
      setWatchlist([...watchlist, newItem]);
    }
  };

  const _addToQueue = (player: Player) => {
    if (!preDraftQueue.find(q => q.playerId === player.id)) {
      const newItem = {
        id: `queue-${Date.now()}`,
        playerId: player.id,
        rank: preDraftQueue.length + 1,
        notes: '',
        player
      };
      setPreDraftQueue([...preDraftQueue, newItem]);
    }
  };

  // Filter and sort players
  const _filteredPlayers = allPlayers
    .filter(player => {
      const matchesSearch = player.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           player.club.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesPosition = positionFilter === 'ALL' || player.position === positionFilter;
      const matchesClub = clubFilter === 'ALL' || player.club === clubFilter;
      return matchesSearch && matchesPosition && matchesClub;
    })
    .sort((a, b) => {
      const aIndex = playerOrder.indexOf(a.id);
      const bIndex = playerOrder.indexOf(b.id);
      return aIndex - bIndex;
    });

  // Get unique positions and clubs for filters
  const _positions = [...new Set(allPlayers.map(p => p.position))].sort();
  const _clubs = [...new Set(allPlayers.map(p => p.club))].sort();

  if (isLoading && !lobbyState) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-6"></div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Loading Draft Lobby</h2>
          <p className="text-gray-600 mb-4">Preparing your draft experience...</p>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <p className="text-sm text-gray-500">Draft ID: <span className="font-mono">{draftId}</span></p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="text-red-500 text-5xl mb-4">⚠️</div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Connection Error</h2>
            <Alert type="error" className="mb-6 text-left">{error}</Alert>
            
            <div className="space-y-3">
              <button
                onClick={() => {
                  setError(null);
                  setIsLoading(true);
                  fetchLobbyData();
                }}
                className="w-full bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 font-medium transition-colors"
              >
                🔄 Try Again
              </button>
              <button
                onClick={onDraftStart}
                className="w-full bg-green-600 text-white px-4 py-3 rounded-lg hover:bg-green-700 font-medium transition-colors"
              >
                🚀 Skip to Draft Room
              </button>
            </div>
            
            <div className="mt-6 pt-4 border-t border-gray-200">
              <p className="text-xs text-gray-500">
                Draft ID: <span className="font-mono">{draftId}</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (lobbyState?.status === 'CLOSED') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-6">🚪</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Draft Lobby Closed</h2>
          <div className="bg-white rounded-lg p-6 border border-gray-200">
            <p className="text-gray-600 mb-4">
              The draft lobby will open 5 minutes before the scheduled start time.
            </p>
            <p className="text-sm text-gray-500">
              Check back closer to your draft time or enable notifications to be alerted when the lobby opens.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Forced state indicator */}
      {forcedLobbyState && (
        <div className="bg-yellow-100 border-b border-yellow-300 px-4 py-2">
          <p className="text-center text-yellow-800 text-sm font-medium">
            🔧 DEMO MODE - Using forced lobby state (Status: {lobbyState?.status})
          </p>
        </div>
      )}

      {/* Header with countdown - Enhanced UI */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-4 gap-4 sm:gap-0 sm:h-20">
            <div className="flex-1">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
                🏟️ Draft Lobby
              </h1>
              <p className="text-sm sm:text-base text-gray-600 mt-1">
                Prepare your strategy for the upcoming draft
              </p>
            </div>
            
            {/* Countdown Timer - Enhanced */}
            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
              <div className="text-center">
                <div className={`text-2xl sm:text-3xl font-bold ${
                  timeRemaining <= 60 
                    ? 'text-red-600 animate-pulse' 
                    : timeRemaining <= 300 
                    ? 'text-yellow-600' 
                    : 'text-blue-600'
                }`}>
                  {formatTime(timeRemaining)}
                </div>
                <div className="text-xs sm:text-sm text-gray-500 font-medium">
                  {lobbyState?.status === 'COUNTDOWN' ? 'Until draft starts' : 'Remaining'}
                </div>
              </div>

              {/* Online Status */}
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-full">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" 
                     aria-hidden="true"></div>
                <span className="text-sm text-gray-700 font-medium">
                  {lobbyState?.participantsOnline.length || 0} online
                </span>
              </div>

              {/* Status Badge */}
              <div className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${
                lobbyState?.status === 'COUNTDOWN' 
                  ? 'bg-red-100 text-red-800' 
                  : lobbyState?.status === 'OPEN'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-gray-100 text-gray-800'
              }`}>
                {lobbyState?.status || 'Loading'}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main content - Enhanced Layout */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          {/* Left column - Instructions & Tips */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 h-fit">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                📋 Pre-Draft Setup
              </h2>
              
              <div className="space-y-4">
                {/* Step 1 */}
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-blue-600 font-bold text-sm">1</span>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900 mb-1">Build Your Queue</h3>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      Prioritize players in your preferred draft order. Auto-picks will use this queue.
                    </p>
                  </div>
                </div>
                
                {/* Step 2 */}
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-blue-600 font-bold text-sm">2</span>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900 mb-1">Create Watchlist</h3>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      Star players you&apos;re interested in to track them during the draft.
                    </p>
                  </div>
                </div>
                
                {/* Step 3 */}
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-blue-600 font-bold text-sm">3</span>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900 mb-1">Stay Ready</h3>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      The draft begins automatically when the countdown ends.
                    </p>
                  </div>
                </div>
              </div>

              {/* AI tools and mock draft */}
              <div className="mt-4 flex flex-col gap-2">
                <button
                  onClick={fetchAiSuggestions}
                  disabled={aiLoading}
                  className="w-full bg-purple-600 text-white px-3 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50"
                >
                  🤖 {aiLoading ? 'Getting Suggestions...' : 'AI Suggest Rankings'}
                </button>
                <button
                  onClick={runMockDraft}
                  className="w-full bg-gray-800 text-white px-3 py-2 rounded-lg hover:bg-gray-900"
                >
                  🧪 Run Mock Draft
                </button>
              </div>
              {mockDraftPicks.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-medium text-gray-900 mb-2">Mock Draft Picks</h3>
                  <ol className="list-decimal list-inside space-y-1">
                    {mockDraftPicks.map((p, i) => (
                      <li key={p.id}>{i + 1}. {p.name}</li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Draft starting soon alert */}
              {timeRemaining <= 120 && lobbyState?.status === 'COUNTDOWN' && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="mt-6 p-4 bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200 rounded-lg"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
                    <span className="text-sm font-medium text-yellow-800">
                      Draft starting in {formatTime(timeRemaining)}! Finalize your preparations.
                    </span>
                  </div>
                </motion.div>
              )}

              {/* Stats Summary */}
              <div className="mt-6 pt-4 border-t border-gray-100">
                <h3 className="text-sm font-medium text-gray-900 mb-3">Your Progress</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-3 bg-blue-50 rounded-lg">
                    <div className="text-lg font-bold text-blue-600">{preDraftQueue.length}</div>
                    <div className="text-xs text-blue-600 font-medium">Queue Players</div>
                  </div>
                  <div className="text-center p-3 bg-yellow-50 rounded-lg">
                    <div className="text-lg font-bold text-yellow-600">{watchlist.length}</div>
                    <div className="text-xs text-yellow-600 font-medium">Watchlist</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right columns - Interactive Tabs */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              {/* Enhanced Tabs */}
              <div className="border-b border-gray-200 bg-gray-50">
                <div className="flex" role="tablist" aria-label="Draft preparation options">
                  <button
                    onClick={() => setActiveTab('queue')}
                    className={`flex-1 py-4 px-6 text-sm font-medium transition-all duration-200 ${
                      activeTab === 'queue'
                        ? 'border-b-2 border-blue-500 text-blue-600 bg-white'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
                    }`}
                    role="tab"
                    aria-selected={activeTab === 'queue'}
                    aria-controls="queue-panel"
                  >
                    <span className="flex items-center justify-center gap-2">
                      🎯 Draft Queue 
                      {preDraftQueue.length > 0 && (
                        <span className="bg-blue-100 text-blue-600 text-xs px-2 py-0.5 rounded-full font-semibold">
                          {preDraftQueue.length}
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    onClick={() => setActiveTab('watchlist')}
                    className={`flex-1 py-4 px-6 text-sm font-medium transition-all duration-200 ${
                      activeTab === 'watchlist'
                        ? 'border-b-2 border-blue-500 text-blue-600 bg-white'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
                    }`}
                    role="tab"
                    aria-selected={activeTab === 'watchlist'}
                    aria-controls="watchlist-panel"
                  >
                    <span className="flex items-center justify-center gap-2">
                      ⭐ Watchlist
                      {watchlist.length > 0 && (
                        <span className="bg-yellow-100 text-yellow-600 text-xs px-2 py-0.5 rounded-full font-semibold">
                          {watchlist.length}
                        </span>
                      )}
                    </span>
                  </button>
                </div>
              </div>

              {/* Tab content with better spacing */}
              <div className="p-6">
                <AnimatePresence mode="wait">
                  {activeTab === 'queue' ? (
                    <motion.div
                      key="queue"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      transition={{ duration: 0.2 }}
                      id="queue-panel"
                      role="tabpanel"
                      aria-labelledby="queue-tab"
                    >
                      <QueueManager
                        draftId={draftId}
                        memberId={memberId}
                        queue={preDraftQueue}
                        onQueueUpdate={setPreDraftQueue}
                      />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="watchlist"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      transition={{ duration: 0.2 }}
                      id="watchlist-panel"
                      role="tabpanel"
                      aria-labelledby="watchlist-tab"
                    >
                      <WatchlistManager
                        draftId={draftId}
                        memberId={memberId}
                        watchlist={watchlist}
                        onWatchlistUpdate={setWatchlist}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// Enhanced Queue Manager Component
function QueueManager({ draftId, memberId, queue, onQueueUpdate }: {
  draftId: string;
  memberId: string;
  queue: PreDraftQueueItem[];
  onQueueUpdate: (queue: PreDraftQueueItem[]) => void;
}) {
  const [localQueue, setLocalQueue] = useState(queue);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setLocalQueue(queue);
  }, [queue]);

  const saveQueue = useCallback(async (queueToSave: PreDraftQueueItem[]) => {
    setIsSaving(true);
    setSaveError(null);
    
    try {
      const response = await fetch(`/api/drafts/${draftId}/pre-queue`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId,
          queue: queueToSave.map(item => ({
            playerId: item.playerId,
            rank: item.rank,
            notes: item.notes,
          })),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        onQueueUpdate(data.data.queue);
      } else {
        setSaveError('Failed to save queue changes');
      }
    } catch (error) {
      console.error('Failed to save queue:', error);
      setSaveError('Network error while saving');
    } finally {
      setIsSaving(false);
    }
  }, [draftId, memberId, onQueueUpdate]);

  const movePlayer = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    
    const newQueue = [...localQueue];
    const [movedPlayer] = newQueue.splice(fromIndex, 1);
    newQueue.splice(toIndex, 0, movedPlayer);

    // Update ranks
    const updatedQueue = newQueue.map((item, index) => ({
      ...item,
      rank: index + 1,
    }));

    setLocalQueue(updatedQueue);
    saveQueue(updatedQueue);
  }, [localQueue, saveQueue]);

  const removePlayer = useCallback((playerId: string) => {
    const newQueue = localQueue
      .filter(item => item.playerId !== playerId)
      .map((item, index) => ({ ...item, rank: index + 1 }));

    setLocalQueue(newQueue);
    saveQueue(newQueue);
  }, [localQueue, saveQueue]);

  return (
    <div className="space-y-4">
      {/* Header with status */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Your Draft Queue</h3>
          <p className="text-sm text-gray-600 mt-1">
            Drag to reorder • Players will be auto-drafted in this order
          </p>
        </div>
        
        {/* Save status indicator */}
        <div className="flex items-center gap-2">
          {isSaving && (
            <div className="flex items-center text-sm text-blue-600">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
              Saving...
            </div>
          )}
          {saveError && (
            <div className="text-sm text-red-600 flex items-center gap-1">
              <span>⚠️</span>
              {saveError}
            </div>
          )}
        </div>
      </div>

      {/* Queue content */}
      {localQueue.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
          <div className="text-4xl mb-3">🎯</div>
          <h4 className="text-lg font-medium text-gray-900 mb-2">No players in queue</h4>
          <p className="text-gray-600 text-sm max-w-md mx-auto">
            Add players to your queue to set your draft priorities. The first player will be auto-drafted when it&apos;s your turn.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {localQueue.map((item, index) => (
            <motion.div
              key={item.playerId}
              layout
              className="group relative bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-all duration-200"
            >
              <div className="flex items-center gap-4">
                {/* Rank and controls */}
                <div className="flex flex-col items-center gap-1">
                  <button
                    onClick={() => index > 0 && movePlayer(index, index - 1)}
                    disabled={index === 0 || isSaving}
                    className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label={`Move ${item.player.name} up in queue`}
                  >
                    ↑
                  </button>
                  
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                    <span className="text-sm font-bold text-blue-600">#{item.rank}</span>
                  </div>
                  
                  <button
                    onClick={() => index < localQueue.length - 1 && movePlayer(index, index + 1)}
                    disabled={index === localQueue.length - 1 || isSaving}
                    className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label={`Move ${item.player.name} down in queue`}
                  >
                    ↓
                  </button>
                </div>

                {/* Player info */}
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-gray-900 truncate">{item.player.name}</h4>
                  <p className="text-sm text-gray-600">{item.player.position} • {item.player.club}</p>
                  {item.notes && (
                    <p className="text-xs text-gray-500 mt-1 italic">{item.notes}</p>
                  )}
                </div>

                {/* Priority badge */}
                <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                  index === 0 
                    ? 'bg-green-100 text-green-800' 
                    : index < 3 
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {index === 0 ? 'Next Pick' : index < 3 ? 'High Priority' : 'Queued'}
                </div>

                {/* Remove button */}
                <button
                  onClick={() => removePlayer(item.playerId)}
                  disabled={isSaving}
                  className="opacity-0 group-hover:opacity-100 p-2 text-red-400 hover:text-red-600 transition-all duration-200 disabled:opacity-50"
                  aria-label={`Remove ${item.player.name} from queue`}
                >
                  ✕
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Queue tips */}
      {localQueue.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-blue-900 mb-2">💡 Queue Tips</h4>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• Your #{localQueue[0]?.rank} player will be auto-drafted first</li>
            <li>• Reorder by clicking the ↑ ↓ buttons</li>
            <li>• Changes are saved automatically</li>
          </ul>
        </div>
      )}
    </div>
  );
}

// Enhanced Watchlist Manager Component
function WatchlistManager({ draftId, memberId, watchlist, onWatchlistUpdate }: {
  draftId: string;
  memberId: string;
  watchlist: WatchlistItem[];
  onWatchlistUpdate: (watchlist: WatchlistItem[]) => void;
}) {
  const [isRemoving, setIsRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const removeFromWatchlist = useCallback(async (playerId: string) => {
    setIsRemoving(playerId);
    setRemoveError(null);
    
    try {
      const response = await fetch(
        `/api/drafts/${draftId}/watchlist?memberId=${memberId}&playerId=${playerId}`,
        { method: 'DELETE' }
      );

      if (response.ok) {
        onWatchlistUpdate(watchlist.filter(item => item.playerId !== playerId));
      } else {
        setRemoveError('Failed to remove player from watchlist');
      }
    } catch (error) {
      console.error('Failed to remove from watchlist:', error);
      setRemoveError('Network error while removing player');
    } finally {
      setIsRemoving(null);
    }
  }, [draftId, memberId, watchlist, onWatchlistUpdate]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Your Watchlist</h3>
        <p className="text-sm text-gray-600 mt-1">
          Players you&apos;re interested in • Track availability during the draft
        </p>
      </div>

      {/* Error display */}
      {removeError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <span className="text-red-600">⚠️</span>
            <span className="text-sm text-red-700">{removeError}</span>
            <button 
              onClick={() => setRemoveError(null)}
              className="ml-auto text-red-400 hover:text-red-600"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Watchlist content */}
      {watchlist.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
          <div className="text-4xl mb-3">⭐</div>
          <h4 className="text-lg font-medium text-gray-900 mb-2">No players in watchlist</h4>
          <p className="text-gray-600 text-sm max-w-md mx-auto">
            Add players you&apos;re interested in to track their availability during the draft.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {watchlist.map((item) => (
            <motion.div
              key={item.playerId}
              layout
              className="group relative bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-all duration-200"
            >
              <div className="flex items-center gap-4">
                {/* Star icon */}
                <div className="w-10 h-10 bg-gradient-to-br from-yellow-100 to-yellow-200 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-lg">⭐</span>
                </div>

                {/* Player info */}
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-gray-900 truncate">{item.player.name}</h4>
                  <p className="text-sm text-gray-600">{item.player.position} • {item.player.club}</p>
                  {item.notes && (
                    <p className="text-xs text-gray-500 mt-1 italic">{item.notes}</p>
                  )}
                </div>

                {/* Priority indicator */}
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">Priority</div>
                  <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center">
                    <span className="text-sm font-medium text-yellow-700">#{item.priority}</span>
                  </div>
                </div>

                {/* Remove button */}
                <button
                  onClick={() => removeFromWatchlist(item.playerId)}
                  disabled={isRemoving === item.playerId}
                  className="opacity-0 group-hover:opacity-100 p-2 text-red-400 hover:text-red-600 transition-all duration-200 disabled:opacity-50"
                  aria-label={`Remove ${item.player.name} from watchlist`}
                >
                  {isRemoving === item.playerId ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600"></div>
                  ) : (
                    '✕'
                  )}
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Watchlist tips */}
      {watchlist.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-yellow-900 mb-2">⭐ Watchlist Tips</h4>
          <ul className="text-sm text-yellow-800 space-y-1">
            <li>• Starred players will be highlighted during the draft</li>
            <li>• You&apos;ll get notifications when watchlist players are drafted</li>
            <li>• Use this to track backup options for each position</li>
          </ul>
        </div>
      )}
    </div>
  );
}
