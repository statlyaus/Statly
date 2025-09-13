'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

import { fetchApi } from '@/lib/api';
import { logger } from '@/lib/logger';
import type {
  DraftState,
  DraftParticipant,
  DraftPick,
  DraftPlayer,
  DraftSettings,
} from '@/types/draft';

interface DraftService {
  // Core operations
  getDraft(): Promise<DraftState>;
  getParticipants(): Promise<DraftParticipant[]>;
  getPicks(): Promise<DraftPick[]>;
  getAvailablePlayers(): Promise<DraftPlayer[]>;

  // Draft actions
  makePick(playerId: string): Promise<DraftPick>;
  updateQueue(queue: string[]): Promise<void>;
  pauseDraft(): Promise<void>;
  resumeDraft(): Promise<void>;

  // Settings
  updateSettings(settings: Partial<DraftSettings>): Promise<void>;

  // Analytics
  getAnalytics(): Promise<any>;
}

interface UseDraftServiceOptions {
  enableCaching?: boolean;
  cacheTimeout?: number;
  retryAttempts?: number;
}

export function useDraftService(draftId: string, options: UseDraftServiceOptions = {}) {
  const {
    enableCaching = true,
    cacheTimeout = 30000, // 30 seconds
    retryAttempts = 3,
  } = options;

  // State
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cache, setCache] = useState<Map<string, { data: any; timestamp: number }>>(new Map());

  // Cache management
  const getCached = useCallback(
    (key: string) => {
      if (!enableCaching) return null;

      const cached = cache.get(key);
      if (cached && Date.now() - cached.timestamp < cacheTimeout) {
        return cached.data;
      }
      return null;
    },
    [enableCaching, cache, cacheTimeout]
  );

  const setCached = useCallback(
    (key: string, data: any) => {
      if (!enableCaching) return;

      setCache((prev) =>
        new Map(prev).set(key, {
          data,
          timestamp: Date.now(),
        })
      );
    },
    [enableCaching]
  );

  const clearCache = useCallback(() => {
    setCache(new Map());
  }, []);

  // Retry wrapper
  const withRetry = useCallback(
    async <T>(operation: () => Promise<T>, operationName: string): Promise<T> => {
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= retryAttempts; attempt++) {
        try {
          return await operation();
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          if (attempt === retryAttempts) {
            logger.error(`Operation failed after ${retryAttempts} attempts`, {
              operation: operationName,
              draftId,
              error: lastError.message,
            });
            throw lastError;
          }

          // Exponential backoff
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise((resolve) => setTimeout(resolve, delay));

          logger.warn(`Operation failed, retrying...`, {
            operation: operationName,
            draftId,
            attempt,
            nextRetryIn: delay,
          });
        }
      }

      throw lastError ?? new Error('Failed to perform draft operation: no error captured');
    },
    [retryAttempts, draftId]
  );

  // API calls with caching and retry
  const apiCall = useCallback(
    async <T>(endpoint: string, options: RequestInit = {}, cacheKey?: string): Promise<T> => {
      // Check cache first
      if (cacheKey) {
        const cached = getCached(cacheKey);
        if (cached) {
          return cached;
        }
      }

      // Make API call
      const response = await withRetry(
        () => fetchApi(endpoint, options),
        `API call to ${endpoint}`
      );

      if (!response.success) {
        throw new Error(response.error || 'API call failed');
      }

      // Cache result
      if (cacheKey) {
        setCached(cacheKey, response.data);
      }

      return response.data;
    },
    [getCached, setCached, withRetry]
  );

  // Draft service implementation
  const draftService: DraftService = useMemo(
    () => ({
      // Core operations
      getDraft: async () => {
        return apiCall<DraftState>(`drafts/${draftId}`, {}, `draft:${draftId}`);
      },

      getParticipants: async () => {
        return apiCall<DraftParticipant[]>(
          `drafts/${draftId}/participants`,
          {},
          `participants:${draftId}`
        );
      },

      getPicks: async () => {
        return apiCall<DraftPick[]>(`drafts/${draftId}/picks`, {}, `picks:${draftId}`);
      },

      getAvailablePlayers: async () => {
        return apiCall<DraftPlayer[]>(
          `drafts/${draftId}/available-players`,
          {},
          `available-players:${draftId}`
        );
      },

      // Draft actions
      makePick: async (playerId: string) => {
        setIsLoading(true);
        setError(null);

        try {
          const pick = await apiCall<DraftPick>(`drafts/${draftId}/pick`, {
            method: 'POST',
            body: JSON.stringify({ playerId }),
          });

          // Invalidate related cache
          clearCache();

          return pick;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to make pick';
          setError(errorMessage);
          throw error;
        } finally {
          setIsLoading(false);
        }
      },

      updateQueue: async (queue: string[]) => {
        try {
          await apiCall(`drafts/${draftId}/queue`, {
            method: 'PUT',
            body: JSON.stringify({ queue }),
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to update queue';
          setError(errorMessage);
          throw error;
        }
      },

      pauseDraft: async () => {
        try {
          await apiCall(`drafts/${draftId}/pause`, { method: 'POST' });

          // Invalidate draft cache
          setCache((prev) => {
            const newCache = new Map(prev);
            newCache.delete(`draft:${draftId}`);
            return newCache;
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to pause draft';
          setError(errorMessage);
          throw error;
        }
      },

      resumeDraft: async () => {
        try {
          await apiCall(`drafts/${draftId}/resume`, { method: 'POST' });

          // Invalidate draft cache
          setCache((prev) => {
            const newCache = new Map(prev);
            newCache.delete(`draft:${draftId}`);
            return newCache;
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to resume draft';
          setError(errorMessage);
          throw error;
        }
      },

      // Settings
      updateSettings: async (settings: Partial<DraftSettings>) => {
        try {
          await apiCall(`drafts/${draftId}/settings`, {
            method: 'PUT',
            body: JSON.stringify(settings),
          });

          // Invalidate draft cache
          setCache((prev) => {
            const newCache = new Map(prev);
            newCache.delete(`draft:${draftId}`);
            return newCache;
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to update settings';
          setError(errorMessage);
          throw error;
        }
      },

      // Analytics
      getAnalytics: async () => {
        return apiCall(`drafts/${draftId}/analytics`, {}, `analytics:${draftId}`);
      },
    }),
    [draftId, apiCall, clearCache, cache]
  );

  // Refresh all data
  const refreshAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      clearCache();

      const [draft, participants, picks, availablePlayers] = await Promise.all([
        draftService.getDraft(),
        draftService.getParticipants(),
        draftService.getPicks(),
        draftService.getAvailablePlayers(),
      ]);

      return { draft, participants, picks, availablePlayers };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to refresh data';
      setError(errorMessage);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [draftService, clearCache]);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearCache();
    };
  }, [clearCache]);

  return {
    draftService,
    isLoading,
    error,
    refreshAll,
    clearError,
    clearCache,
  };
}
