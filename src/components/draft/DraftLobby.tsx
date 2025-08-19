'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Button from '@/components/Button';
import { Alert } from '@/components/ui';
import type { LobbyState, WatchlistItem, PreDraftQueueItem } from '@/lib/draftLobby';

interface DraftLobbyProps {
  draftId: string;
  memberId: string;
  onDraftStart: () => void;
}

export default function DraftLobby({ draftId, memberId, onDraftStart }: DraftLobbyProps) {
  const [lobbyState, setLobbyState] = useState<LobbyState | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [preDraftQueue, setPreDraftQueue] = useState<PreDraftQueueItem[]>([]);
  const [activeTab, setActiveTab] = useState<'queue' | 'watchlist'>('queue');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Countdown timer
  const [timeRemaining, setTimeRemaining] = useState(0);

  useEffect(() => {
    fetchLobbyData();
    const interval = setInterval(fetchLobbyData, 5000); // Update every 5 seconds instead of 1
    return () => clearInterval(interval);
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
    } else if (timeRemaining === 0 && lobbyState?.status === 'COUNTDOWN') {
      onDraftStart();
    }
  }, [timeRemaining, lobbyState?.status, onDraftStart]);

  const fetchLobbyData = async () => {
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
  };

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  if (isLoading && !lobbyState) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading draft lobby...</p>
          <p className="text-xs text-gray-400 mt-2">Draft ID: {draftId}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full text-center">
          <Alert type="error" className="mb-4">{error}</Alert>
          <div className="space-y-3">
            <button
              onClick={() => {
                setError(null);
                setIsLoading(true);
                fetchLobbyData();
              }}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 mr-2"
            >
              Retry
            </button>
            <button
              onClick={onDraftStart}
              className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700"
            >
              Skip to Draft Room
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-4">Draft ID: {draftId}</p>
        </div>
      </div>
    );
  }

  if (lobbyState?.status === 'CLOSED') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Draft Lobby Closed</h2>
          <p className="text-gray-600">The draft lobby will open 5 minutes before the scheduled start time.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header with countdown */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Draft Lobby</h1>
              <p className="text-sm text-gray-500">Prepare for your draft</p>
            </div>
            
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-600">
                {formatTime(timeRemaining)}
              </div>
              <div className="text-sm text-gray-500">
                {lobbyState?.status === 'COUNTDOWN' ? 'Until draft starts' : 'Remaining'}
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <div className="flex items-center">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse mr-2"></div>
                <span className="text-sm text-gray-600">
                  {lobbyState?.participantsOnline.length || 0} online
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left column - Instructions */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Pre-Draft Preparation</h3>
              <div className="space-y-4 text-sm text-gray-600">
                <div className="flex items-start">
                  <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mr-3 mt-0.5">
                    <span className="text-blue-600 font-semibold text-xs">1</span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Set Your Queue</p>
                    <p>Arrange players in your preferred draft order. This will be used for auto-picks.</p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mr-3 mt-0.5">
                    <span className="text-blue-600 font-semibold text-xs">2</span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Build Your Watchlist</p>
                    <p>Add players you're interested in to keep track of them during the draft.</p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mr-3 mt-0.5">
                    <span className="text-blue-600 font-semibold text-xs">3</span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Stay Ready</p>
                    <p>The draft will start automatically when the countdown reaches zero.</p>
                  </div>
                </div>
              </div>

              {timeRemaining <= 60 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg"
                >
                  <div className="flex items-center">
                    <svg className="w-5 h-5 text-yellow-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="text-sm font-medium text-yellow-800">
                      Draft starting soon! Make sure your queue is ready.
                    </span>
                  </div>
                </motion.div>
              )}
            </div>
          </div>

          {/* Right columns - Queue and Watchlist */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow">
              {/* Tabs */}
              <div className="border-b border-gray-200">
                <nav className="flex space-x-8 px-6">
                  <button
                    onClick={() => setActiveTab('queue')}
                    className={`py-4 px-1 border-b-2 font-medium text-sm ${
                      activeTab === 'queue'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    Draft Queue ({preDraftQueue.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('watchlist')}
                    className={`py-4 px-1 border-b-2 font-medium text-sm ${
                      activeTab === 'watchlist'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    Watchlist ({watchlist.length})
                  </button>
                </nav>
              </div>

              {/* Tab content */}
              <div className="p-6">
                <AnimatePresence mode="wait">
                  {activeTab === 'queue' ? (
                    <motion.div
                      key="queue"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      transition={{ duration: 0.2 }}
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
      </div>
    </div>
  );
}

// Queue Manager Component
function QueueManager({ draftId, memberId, queue, onQueueUpdate }: {
  draftId: string;
  memberId: string;
  queue: PreDraftQueueItem[];
  onQueueUpdate: (queue: PreDraftQueueItem[]) => void;
}) {
  const [localQueue, setLocalQueue] = useState(queue);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setLocalQueue(queue);
  }, [queue]);

  const movePlayer = (fromIndex: number, toIndex: number) => {
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
  };

  const removePlayer = (playerId: string) => {
    const newQueue = localQueue
      .filter(item => item.playerId !== playerId)
      .map((item, index) => ({ ...item, rank: index + 1 }));

    setLocalQueue(newQueue);
    saveQueue(newQueue);
  };

  const saveQueue = async (queueToSave: PreDraftQueueItem[]) => {
    setIsSaving(true);
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
      }
    } catch (error) {
      console.error('Failed to save queue:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900">Your Draft Queue</h3>
        {isSaving && (
          <div className="flex items-center text-sm text-blue-600">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
            Saving...
          </div>
        )}
      </div>

      {localQueue.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>Your queue is empty. Add players from the available players list.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {localQueue.map((item, index) => (
            <motion.div
              key={item.playerId}
              layout
              className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border"
            >
              <div className="flex items-center space-x-3">
                <div className="flex flex-col space-y-1">
                  <button
                    onClick={() => index > 0 && movePlayer(index, index - 1)}
                    disabled={index === 0}
                    className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => index < localQueue.length - 1 && movePlayer(index, index + 1)}
                    disabled={index === localQueue.length - 1}
                    className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
                  >
                    ↓
                  </button>
                </div>

                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-sm font-medium text-blue-600">{item.rank}</span>
                </div>

                <div>
                  <p className="font-medium text-gray-900">{item.player.name}</p>
                  <p className="text-sm text-gray-500">{item.player.position} • {item.player.club}</p>
                </div>
              </div>

              <button
                onClick={() => removePlayer(item.playerId)}
                className="p-2 text-red-400 hover:text-red-600"
              >
                ✕
              </button>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// Watchlist Manager Component
function WatchlistManager({ draftId, memberId, watchlist, onWatchlistUpdate }: {
  draftId: string;
  memberId: string;
  watchlist: WatchlistItem[];
  onWatchlistUpdate: (watchlist: WatchlistItem[]) => void;
}) {
  const removeFromWatchlist = async (playerId: string) => {
    try {
      const response = await fetch(
        `/api/drafts/${draftId}/watchlist?memberId=${memberId}&playerId=${playerId}`,
        { method: 'DELETE' }
      );

      if (response.ok) {
        onWatchlistUpdate(watchlist.filter(item => item.playerId !== playerId));
      }
    } catch (error) {
      console.error('Failed to remove from watchlist:', error);
    }
  };

  return (
    <div>
      <h3 className="text-lg font-medium text-gray-900 mb-4">Your Watchlist</h3>

      {watchlist.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>Your watchlist is empty. Add players you're interested in.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {watchlist.map((item) => (
            <div
              key={item.playerId}
              className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border"
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center">
                  <span className="text-sm font-medium text-yellow-600">★</span>
                </div>

                <div>
                  <p className="font-medium text-gray-900">{item.player.name}</p>
                  <p className="text-sm text-gray-500">{item.player.position} • {item.player.club}</p>
                  {item.notes && (
                    <p className="text-xs text-gray-400 mt-1">{item.notes}</p>
                  )}
                </div>
              </div>

              <button
                onClick={() => removeFromWatchlist(item.playerId)}
                className="p-2 text-red-400 hover:text-red-600"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
