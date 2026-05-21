'use client';

import React, { useState, useEffect, useCallback } from 'react';

import Link from 'next/link';

import DraftRoomClient from '@/app/drafts/[id]/DraftRoomClient';
import { Alert } from '@/components/ui';
import type { LobbyState } from '@/lib/draftLobby';
import { logger } from '@/lib/logger';
import { isAbortError } from '@/lib/utils';

import DraftLobby from './DraftLobby';

interface DraftContainerProps {
  draftId: string;
  memberId: string;
  players: unknown[];
  draftData: unknown; // TODO: Define proper type based on actual API response
}

export default function DraftContainer({
  draftId,
  memberId,
  players,
  draftData,
}: DraftContainerProps): React.ReactElement {
  const [lobbyState, setLobbyState] = useState<LobbyState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isForced, setIsForced] = useState(false); // Track if user forced entry

  // Feature flag to enable/disable lobby system
  const ENABLE_LOBBY_SYSTEM = true; // Database is ready and working

  const fetchLobbyState = useCallback(async () => {
    try {
      logger.debug('Fetching lobby state for draft', {
        draftId,
        draftIdType: typeof draftId,
        draftIdLength: draftId?.length,
        component: 'DraftContainer',
        action: 'fetchLobbyState',
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`/api/drafts/${draftId}/lobby`, { signal: controller.signal });
      clearTimeout(timeoutId);

      logger.debug('Lobby API response received', {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        component: 'DraftContainer',
        action: 'fetchLobbyState',
      });

      if (response.ok) {
        const data = await response.json();
        logger.debug('Lobby state data received', {
          data,
          component: 'DraftContainer',
          action: 'fetchLobbyState',
        });
        setLobbyState(data.data);
        setError(null);
        return;
      }

      const errorText = await response.text();
      let errorData: any;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText || 'Unknown error' };
      }

      logger.error('Lobby API error', new Error(typeof errorText === 'string' ? errorText : ''), {
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        errorData,
      });

      if (
        response.status === 404 ||
        (response.status === 500 &&
          errorData?.error?.message &&
          String(errorData.error.message).includes('Draft not found'))
      ) {
        setError('DRAFT_NOT_FOUND');
      } else {
        setError(errorData?.error?.message || 'Failed to load lobby');
      }
    } catch (e) {
      if (isAbortError(e)) return;
      setError(e instanceof Error ? e.message : 'Failed to load lobby');
    } finally {
      setIsLoading(false);
    }
  }, [draftId]);

  // Polling interval for lobby state
  const LOBBY_POLL_INTERVAL_MS = 5000; // 5 seconds

  useEffect(() => {
    if (ENABLE_LOBBY_SYSTEM && !isForced) {
      void fetchLobbyState();
      const interval = setInterval(() => {
        if (!isForced && error !== 'DRAFT_NOT_FOUND') {
          void fetchLobbyState();
        }
      }, LOBBY_POLL_INTERVAL_MS);
      return () => clearInterval(interval);
    }
    if (!ENABLE_LOBBY_SYSTEM) {
      setIsLoading(false);
      setLobbyState({ status: 'LIVE', participantsOnline: [] });
    }
  }, [draftId, ENABLE_LOBBY_SYSTEM, isForced, fetchLobbyState, error]);

  const handleDraftStart = useCallback((): void => {
    logger.info('Draft start triggered, transitioning to LIVE state', {
      component: 'DraftContainer',
      action: 'handleDraftStart',
    });
    // Instead of reloading, transition to LIVE state
    setLobbyState((prev) =>
      prev ? { ...prev, status: 'LIVE' } : { status: 'LIVE', participantsOnline: [] }
    );
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-info/20 mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading draft...</p>
        </div>
      </div>
    );
  }

  if (error) {
    // Special handling for draft not found
    if (error === 'DRAFT_NOT_FOUND') {
      return (
        <div className="min-h-screen bg-muted flex items-center justify-center p-4">
          <div className="max-w-md w-full text-center">
            <div className="mb-6">
              <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-destructive"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L4.35 16.5c-.77.833-.23 2.5 1.732 2.5z"
                  />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-4">Draft Not Found</h2>
              <p className="text-muted-foreground mb-6">
                The draft you&apos;re looking for doesn&apos;t exist or may have been deleted.
              </p>
              <div className="text-sm text-muted-foreground mb-6">
                Draft ID: <code className="bg-muted px-2 py-1 rounded">{draftId}</code>
              </div>
            </div>

            <div className="space-y-3">
              <a
                href="/test-draft"
                className="block w-full bg-info text-white px-4 py-2 rounded-md hover:bg-info transition-colors"
              >
                View Available Drafts
              </a>
              <Link
                href="/drafts"
                className="block w-full bg-muted text-white px-4 py-2 rounded-md hover:bg-muted transition-colors"
              >
                Draft Center
              </Link>
              <button
                onClick={() => window.location.reload()}
                className="block w-full bg-muted text-foreground px-4 py-2 rounded-md hover:bg-muted transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Regular error handling for other types of errors
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <Alert type="error" className="mb-4">
            {error}
          </Alert>
          <div className="text-center">
            <p className="text-muted-foreground mb-4">
              There was an issue loading the lobby. You can still access the draft directly.
            </p>
            <button
              onClick={() => {
                // Bypass lobby and go directly to draft room
                setError(null);
                setLobbyState({ status: 'LIVE', participantsOnline: [] });
              }}
              className="bg-info text-white px-4 py-2 rounded-md hover:bg-info mr-2"
            >
              Enter Draft Room
            </button>
            <button
              onClick={() => window.location.reload()}
              className="bg-muted text-white px-4 py-2 rounded-md hover:bg-muted"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // If we have lobby state, use it to determine what to show
  if (lobbyState) {
    logger.debug('Routing decision - lobby state received', {
      status: lobbyState.status,
      fullLobbyState: lobbyState,
      isForcedMode: isForced,
      component: 'DraftContainer',
      action: 'routingDecision',
    });

    // Show lobby if draft is in OPEN, COUNTDOWN, or any active lobby state
    const status = String(lobbyState.status).toUpperCase();
    logger.debug('Checking lobby status', {
      normalizedStatus: status,
      originalStatus: lobbyState.status,
      component: 'DraftContainer',
      action: 'routingDecision',
    });

    if (status === 'OPEN' || status === 'COUNTDOWN') {
      logger.debug('Routing to DraftLobby component', {
        status,
        component: 'DraftContainer',
        action: 'routingDecision',
      });
      return (
        <DraftLobby
          draftId={draftId}
          memberId={memberId}
          onDraftStart={handleDraftStart}
          forcedLobbyState={isForced ? lobbyState : undefined}
        />
      );
    }

    // Show live draft room if draft is LIVE
    const liveStatus = String(lobbyState.status).toUpperCase();
    if (liveStatus === 'LIVE') {
      logger.debug('Routing to DraftRoomClient component', {
        status: liveStatus,
        component: 'DraftContainer',
        action: 'routingDecision',
      });
      return <DraftRoomClient players={players as never} draftData={draftData as never} />;
    }

    // Draft is not yet ready (CLOSED status)
    logger.warn('Draft not ready - unexpected status', {
      status: lobbyState.status,
      component: 'DraftContainer',
      action: 'routingDecision',
    });

    // EMERGENCY FIX: If we get here but the API says COUNTDOWN, force show lobby
    if (lobbyState.status === 'COUNTDOWN') {
      logger.warn('Emergency: Forcing lobby display for COUNTDOWN status', {
        status: lobbyState.status,
        component: 'DraftContainer',
        action: 'emergencyFix',
      });
      return <DraftLobby draftId={draftId} memberId={memberId} onDraftStart={handleDraftStart} />;
    }

    return (
      <div className="min-h-screen bg-muted flex items-center justify-center">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-bold text-foreground mb-4">Draft Not Ready</h2>
          <p className="text-muted-foreground mb-6">
            This draft is scheduled but the lobby hasn&apos;t opened yet. The lobby will open 5
            minutes before the scheduled start time.
          </p>
          {lobbyState.draftStartsAt && (
            <p className="text-sm text-muted-foreground mb-4">
              Scheduled for: {new Date(lobbyState.draftStartsAt).toLocaleString()}
            </p>
          )}
          <div className="bg-warning/10 border border-warning/20 rounded p-3 mb-4">
            <p className="text-sm text-warning">
              Debug: Status = &quot;{lobbyState.status}&quot;
            </p>
            <p className="text-sm text-warning">
              Time remaining: {lobbyState.timeRemaining || 'unknown'}
            </p>
            {isForced && (
              <p className="text-sm text-destructive font-bold">
                🔧 FORCED MODE - API polling disabled
              </p>
            )}
          </div>
          <button
            onClick={() => {
              // Force show lobby for testing
              logger.debug('Force entering lobby with COUNTDOWN', {
                component: 'DraftContainer',
                action: 'forceLobbyCountdown',
              });
              setIsForced(true); // Prevent API from overriding
              setLobbyState({
                status: 'COUNTDOWN',
                participantsOnline: [],
                timeRemaining: 300,
                draftStartsAt: new Date(Date.now() + 5 * 60 * 1000),
              });
              setIsLoading(false);
              setError(null);
            }}
            className="bg-info text-white px-4 py-2 rounded-md hover:bg-info mr-2"
          >
            🚀 Force Lobby (COUNTDOWN)
          </button>
          <button
            onClick={() => {
              // Force show lobby with OPEN status
              logger.debug('Force entering lobby with OPEN', {
                component: 'DraftContainer',
                action: 'forceLobbyOpen',
              });
              setIsForced(true); // Prevent API from overriding
              setLobbyState({
                status: 'OPEN',
                participantsOnline: [],
                timeRemaining: 0,
              });
              setIsLoading(false);
              setError(null);
            }}
            className="bg-info text-white px-4 py-2 rounded-md hover:bg-info mr-2"
          >
            🎪 Force Lobby (OPEN)
          </button>
          <button
            onClick={() => {
              // Force show draft room directly
              logger.debug('Force entering draft room', {
                component: 'DraftContainer',
                action: 'forceDraftRoom',
              });
              setIsForced(true); // Prevent API from overriding
              setLobbyState({
                status: 'LIVE',
                participantsOnline: [],
              });
              setIsLoading(false);
              setError(null);
            }}
            className="bg-success text-white px-4 py-2 rounded-md hover:bg-success mr-2"
          >
            🎯 Force Enter Draft Room
          </button>
          <button
            onClick={() => {
              void (async () => {
                logger.debug('Testing API directly', {
                  component: 'DraftContainer',
                  action: 'testApi',
                });
                try {
                  const response = await fetch(`/api/drafts/${draftId}/lobby`);
                  const data = await response.json();
                  logger.debug('Direct API call result', {
                    data,
                    component: 'DraftContainer',
                    action: 'testApi',
                  });
                  alert(`API Status: ${data.data?.status}, Time: ${data.data?.timeRemaining}`);
                } catch (err) {
                  logger.error('API test failed', err, {
                    component: 'DraftContainer',
                    action: 'testApi',
                  });
                }
              })();
            }}
            className="bg-primary text-white px-4 py-2 rounded-md hover:bg-primary mr-2"
          >
            Test API
          </button>
          <button
            onClick={() => {
              // Reset to normal API mode
              logger.debug('Resetting to API mode', {
                component: 'DraftContainer',
                action: 'resetToApi',
              });
              setIsForced(false);
              setIsLoading(true);
              setError(null);
              void fetchLobbyState();
            }}
            className="bg-warning text-white px-4 py-2 rounded-md hover:bg-warning mr-2"
          >
            🔄 Reset to API
          </button>
          <button
            onClick={() => window.location.reload()}
            className="bg-muted text-white px-4 py-2 rounded-md hover:bg-muted"
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  // Fallback: If lobby state failed to load, check draft status directly
  logger.debug('Fallback: No lobby state, checking draftData.status', {
    draftDataStatus: (draftData as { status?: string })?.status,
    component: 'DraftContainer',
    action: 'fallbackCheck',
  });
  if ((draftData as { status?: string })?.status === 'LIVE') {
    logger.debug('Fallback: Showing draft room based on draftData', {
      component: 'DraftContainer',
      action: 'fallbackCheck',
    });
    return <DraftRoomClient players={players as never} draftData={draftData as never} />;
  }

  // Default fallback - show the live draft room
  logger.debug('Final fallback: Showing loading screen', {
    component: 'DraftContainer',
    action: 'finalFallback',
  });
  return (
    <div className="min-h-screen bg-muted flex items-center justify-center">
      <div className="text-center max-w-md">
        <h2 className="text-2xl font-bold text-foreground mb-4">Loading Draft...</h2>
        <p className="text-muted-foreground mb-6">Preparing your draft experience...</p>
        <button
          onClick={() => window.location.reload()}
          className="bg-info text-white px-4 py-2 rounded-md hover:bg-info"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
