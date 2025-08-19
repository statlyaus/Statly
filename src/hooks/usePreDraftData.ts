import { useState, useEffect, useCallback } from 'react';
import type { WatchlistItem, PreDraftQueueItem } from '@/lib/draftLobby';

interface UsePreDraftDataProps {
  draftId: string;
  memberId: string;
}

interface UsePreDraftDataReturn {
  watchlist: WatchlistItem[];
  preDraftQueue: PreDraftQueueItem[];
  isLoading: boolean;
  error: string | null;
  addToWatchlist: (playerId: string, priority?: number, notes?: string) => Promise<void>;
  removeFromWatchlist: (playerId: string) => Promise<void>;
  updateQueue: (queue: Array<{ playerId: string; rank: number; notes?: string }>) => Promise<void>;
  refreshData: () => Promise<void>;
}

export function usePreDraftData({ draftId, memberId }: UsePreDraftDataProps): UsePreDraftDataReturn {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [preDraftQueue, setPreDraftQueue] = useState<PreDraftQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [watchlistResponse, queueResponse] = await Promise.all([
        fetch(`/api/drafts/${draftId}/watchlist?memberId=${memberId}`),
        fetch(`/api/drafts/${draftId}/pre-queue?memberId=${memberId}`),
      ]);

      if (watchlistResponse.ok) {
        const watchlistData = await watchlistResponse.json();
        setWatchlist(watchlistData.data.watchlist);
      }

      if (queueResponse.ok) {
        const queueData = await queueResponse.json();
        setPreDraftQueue(queueData.data.queue);
      }
    } catch (err) {
      setError('Failed to load pre-draft data');
    } finally {
      setIsLoading(false);
    }
  }, [draftId, memberId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const addToWatchlist = async (playerId: string, priority = 1, notes?: string) => {
    try {
      const response = await fetch(`/api/drafts/${draftId}/watchlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId,
          memberId,
          priority,
          notes,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setWatchlist(prev => {
          const existing = prev.find(item => item.playerId === playerId);
          if (existing) {
            return prev.map(item => 
              item.playerId === playerId ? data.data.watchlistItem : item
            );
          }
          return [...prev, data.data.watchlistItem];
        });
      } else {
        throw new Error('Failed to add to watchlist');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add to watchlist');
      throw err;
    }
  };

  const removeFromWatchlist = async (playerId: string) => {
    try {
      const response = await fetch(
        `/api/drafts/${draftId}/watchlist?memberId=${memberId}&playerId=${playerId}`,
        { method: 'DELETE' }
      );

      if (response.ok) {
        setWatchlist(prev => prev.filter(item => item.playerId !== playerId));
      } else {
        throw new Error('Failed to remove from watchlist');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove from watchlist');
      throw err;
    }
  };

  const updateQueue = async (queue: Array<{ playerId: string; rank: number; notes?: string }>) => {
    try {
      const response = await fetch(`/api/drafts/${draftId}/pre-queue`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId,
          queue,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setPreDraftQueue(data.data.queue);
      } else {
        throw new Error('Failed to update queue');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update queue');
      throw err;
    }
  };

  const refreshData = async () => {
    setIsLoading(true);
    await fetchData();
  };

  return {
    watchlist,
    preDraftQueue,
    isLoading,
    error,
    addToWatchlist,
    removeFromWatchlist,
    updateQueue,
    refreshData,
  };
}
