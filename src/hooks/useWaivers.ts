/**
 * useWaivers Hook
 * React hook for managing waiver claims and processing
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  waiverService,
  type WaiverRequest,
  type WaiverPriority,
  type WaiverProcessingResult,
} from '@/services/waiverService';

interface UseWaiversOptions {
  leagueId: string;
  userId: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface UseWaiversReturn {
  // State
  waiverRequests: WaiverRequest[];
  userPriority: WaiverPriority | null;
  loading: boolean;
  submitting: boolean;
  processing: boolean;
  error: string | null;

  // Actions
  submitClaim: (params: {
    targetPlayerId: string;
    dropPlayerId?: string;
    bidAmount?: number;
    claimReason?: string;
  }) => Promise<WaiverRequest>;

  cancelRequest: (requestId: string) => Promise<void>;
  processQueue: () => Promise<WaiverProcessingResult>;
  refreshData: () => Promise<void>;

  // Computed values
  pendingRequests: WaiverRequest[];
  userRequests: WaiverRequest[];
  canSubmitClaim: boolean;
}

export function useWaivers(options: UseWaiversOptions): UseWaiversReturn {
  const { leagueId, userId, autoRefresh = false, refreshInterval = 30000 } = options;

  // State
  const [waiverRequests, setWaiverRequests] = useState<WaiverRequest[]>([]);
  const [userPriority, setUserPriority] = useState<WaiverPriority | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load initial data
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [requests, priority] = await Promise.all([
        waiverService.getPendingWaiverRequests(leagueId),
        waiverService.getUserWaiverPriority(leagueId, userId),
      ]);

      setWaiverRequests(requests);
      setUserPriority(priority);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load waiver data');
      console.error('Failed to load waiver data:', err);
    } finally {
      setLoading(false);
    }
  }, [leagueId, userId]);

  // Refresh data
  const refreshData = useCallback(async () => {
    if (!loading) {
      await loadData();
    }
  }, [loadData, loading]);

  // Submit waiver claim
  const submitClaim = useCallback(
    async (params: {
      targetPlayerId: string;
      dropPlayerId?: string;
      bidAmount?: number;
      claimReason?: string;
    }) => {
      try {
        setSubmitting(true);
        setError(null);

        const request = await waiverService.submitWaiverClaim({
          leagueId,
          userId,
          ...params,
        });

        // Add new request to state
        setWaiverRequests((prev) => [...prev, request]);

        return request;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to submit waiver claim';
        setError(errorMessage);
        throw new Error(errorMessage);
      } finally {
        setSubmitting(false);
      }
    },
    [leagueId, userId]
  );

  // Cancel waiver request
  const cancelRequest = useCallback(
    async (requestId: string) => {
      try {
        setError(null);

        await waiverService.cancelWaiverRequest(leagueId, requestId, userId);

        // Update request status in state
        setWaiverRequests((prev) =>
          prev.map((req) =>
            req.id === requestId
              ? { ...req, status: 'REJECTED' as const, reason: 'Cancelled by user' }
              : req
          )
        );
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to cancel waiver request';
        setError(errorMessage);
        throw new Error(errorMessage);
      }
    },
    [leagueId, userId]
  );

  // Process waiver queue
  const processQueue = useCallback(async () => {
    try {
      setProcessing(true);
      setError(null);

      const result = await waiverService.processWaiverQueue(leagueId);

      // Update waiver requests with processing results
      setWaiverRequests((prev) => {
        const updatedMap = new Map(result.processed.map((req) => [req.id, req]));
        return prev.map((req) => updatedMap.get(req.id) || req);
      });

      // Update user priority if changed
      const userPriorityUpdate = result.priorityUpdates.find((p) => p.userId === userId);
      if (userPriorityUpdate) {
        setUserPriority(userPriorityUpdate);
      }

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to process waiver queue';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setProcessing(false);
    }
  }, [leagueId, userId]);

  // Load user's waiver history
  const _loadUserHistory = useCallback(async () => {
    try {
      const history = await waiverService.getUserWaiverHistory(leagueId, userId);
      return history;
    } catch (err) {
      console.error('Failed to load user waiver history:', err);
      return [];
    }
  }, [leagueId, userId]);

  // Auto-refresh effect
  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    if (autoRefresh && refreshInterval > 0) {
      intervalId = setInterval(() => {
        if (!loading && !submitting && !processing) {
          refreshData();
        }
      }, refreshInterval);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [autoRefresh, refreshInterval, loading, submitting, processing, refreshData]);

  // Initial load effect
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Computed values
  const pendingRequests = waiverRequests.filter((req) => req.status === 'PENDING');
  const userRequests = waiverRequests.filter((req) => req.userId === userId);
  const canSubmitClaim = !submitting && !processing && !!userPriority;

  return {
    // State
    waiverRequests,
    userPriority,
    loading,
    submitting,
    processing,
    error,

    // Actions
    submitClaim,
    cancelRequest,
    processQueue,
    refreshData,

    // Computed values
    pendingRequests,
    userRequests,
    canSubmitClaim,
  };
}

export default useWaivers;
