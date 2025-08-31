import { useState, useEffect, useCallback } from 'react';
import { fetchJson } from '@/lib/api';
import type { WatchlistItem, PreDraftQueueItem } from '@/lib/draftLobby';

interface UsePreDraftDataProps {
  draftId: string;
  memberId: string;
}

interface AddWatchlistResponse {
  data: {
    watchlistItem: WatchlistItem;
  };
}

interface UpdateQueueResponse {
  data: {
    queue: PreDraftQueueItem[];
  };
}

export interface WatchlistResponse {
  data: {
    watchlist: WatchlistItem[];
  };
}

export interface QueueResponse {
  data: {
    queue: PreDraftQueueItem[];
  };
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
      const [watchlistData, queueData] = await Promise.all([
        fetchJson<WatchlistResponse>(`/api/drafts/${draftId}/watchlist?memberId=${memberId}`),
        fetchJson<QueueResponse>(`/api/drafts/${draftId}/pre-queue?memberId=${memberId}`),
      ]);

      setWatchlist(watchlistData.data.watchlist);
      setPreDraftQueue(queueData.data.queue);
    } catch (_err) {
      setError('Failed to load pre-draft data');
    } finally {
      setIsLoading(false);
    }
  }, [draftId, memberId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const addToWatchlist = async (playerId: string, priority = 1, notes?: string) => {
    try {
      const data = await fetchJson<AddWatchlistResponse>(`/api/drafts/${draftId}/watchlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId,
          memberId,
          priority,
          notes,
        }),
      });

      setWatchlist(prev => {
        const existing = prev.find(item => item.playerId === playerId);
        if (existing) {
          return prev.map(item => 
            item.playerId === playerId ? data.data.watchlistItem : item
          );
        }
        return [...prev, data.data.watchlistItem];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add to watchlist');
      throw err;
    }
  };

  const removeFromWatchlist = async (playerId: string) => {
    try {
      await fetchJson<void>(
        `/api/drafts/${draftId}/watchlist?memberId=${memberId}&playerId=${playerId}`,
        { method: 'DELETE' }
      );
      setWatchlist(prev => prev.filter(item => item.playerId !== playerId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove from watchlist');
      throw err;
    }
  };

  const updateQueue = async (queue: Array<{ playerId: string; rank: number; notes?: string }>) => {
    try {
      const data = await fetchJson<UpdateQueueResponse>(`/api/drafts/${draftId}/pre-queue`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId,
          queue,
        }),
      });
      setPreDraftQueue(data.data.queue);
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
