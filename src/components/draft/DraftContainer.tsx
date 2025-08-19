'use client';

import { useState, useEffect, useCallback } from 'react';
import DraftLobby from './DraftLobby';
import DraftRoomClient from '@/app/drafts/[id]/DraftRoomClient';
import { Alert } from '@/components/ui';
import type { LobbyState } from '@/lib/draftLobby';

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
  draftData
}: DraftContainerProps) {
  const [lobbyState, setLobbyState] = useState<LobbyState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isForced, setIsForced] = useState(false); // Track if user forced entry

  // Feature flag to enable/disable lobby system
  const ENABLE_LOBBY_SYSTEM = true; // Database is ready and working

  const fetchLobbyState = useCallback(async () => {
    try {
      // First try the debug endpoint to see what's available
      console.log('Fetching lobby state for draft:', draftId);
      console.log('Draft ID type:', typeof draftId);
      console.log('Draft ID length:', draftId?.length);

      const response = await fetch(`/api/drafts/${draftId}/lobby`);
      console.log('Lobby API response:', {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: response.url
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Lobby state data:', data);
        setLobbyState(data.data);
        setError(null); // Clear any previous errors
      } else {
        const errorText = await response.text();
        console.error('Lobby API error response:', errorText);

        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || 'Unknown error' };
        }

        console.error('Lobby API error:', {
          status: response.status,
          statusText: response.statusText,
          errorData,
          url: response.url
        });

        const errorMessage = typeof errorData.error === 'string'
          ? errorData.error
          : `HTTP ${response.status}: ${response.statusText}`;
        setError(`Failed to load draft state: ${errorMessage}`);
      }
    } catch (err) {
      console.error('Network error fetching lobby state:', err);
      setError('Network error: Unable to connect to server');
    } finally {
      setIsLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    if (ENABLE_LOBBY_SYSTEM && !isForced) {
      fetchLobbyState();
      const interval = setInterval(() => {
        if (!isForced) { // Only fetch if not forced
          fetchLobbyState();
        }
      }, 5000); // Check every 5 seconds
      return () => clearInterval(interval);
    } else if (!ENABLE_LOBBY_SYSTEM) {
      // Bypass lobby system - go directly to draft room
      setIsLoading(false);
      setLobbyState({ status: 'LIVE', participantsOnline: [] });
    }
  }, [draftId, ENABLE_LOBBY_SYSTEM, isForced, fetchLobbyState]);

  const handleDraftStart = () => {
    // Force refresh to load the live draft room
    window.location.reload();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading draft...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <Alert type="error" className="mb-4">{error}</Alert>
          <div className="text-center">
            <p className="text-gray-600 mb-4">
              There was an issue loading the lobby. You can still access the draft directly.
            </p>
            <button
              onClick={() => {
                // Bypass lobby and go directly to draft room
                setError(null);
                setLobbyState({ status: 'LIVE', participantsOnline: [] });
              }}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 mr-2"
            >
              Enter Draft Room
            </button>
            <button
              onClick={() => window.location.reload()}
              className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700"
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
    console.log('=== ROUTING DECISION ===');
    console.log('Lobby state received:', lobbyState.status);
    console.log('Full lobby state:', lobbyState);
    console.log('Is forced mode:', isForced);

    // Show lobby if draft is in OPEN, COUNTDOWN, or any active lobby state
    const status = String(lobbyState.status).toUpperCase();
    console.log('Checking status:', status, 'Original:', lobbyState.status);

    if (status === 'OPEN' || status === 'COUNTDOWN') {
      console.log('✅ SHOULD SHOW LOBBY for status:', status);
      console.log('Returning DraftLobby component...');
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
      console.log('✅ SHOULD SHOW DRAFT ROOM for status:', liveStatus);
      console.log('Returning DraftRoomClient component...');
      return (
        <DraftRoomClient
          players={players as never}
          draftData={draftData as never}
        />
      );
    }

    // Draft is not yet ready (CLOSED status)
    console.log('Draft not ready, status:', lobbyState.status);
    console.log('This should not happen if status is COUNTDOWN!');

    // EMERGENCY FIX: If we get here but the API says COUNTDOWN, force show lobby
    if (lobbyState.status === 'COUNTDOWN') {
      console.log('EMERGENCY: Forcing lobby display for COUNTDOWN status');
      return (
        <DraftLobby
          draftId={draftId}
          memberId={memberId}
          onDraftStart={handleDraftStart}
        />
      );
    }

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Draft Not Ready</h2>
          <p className="text-gray-600 mb-6">
            This draft is scheduled but the lobby hasn&apos;t opened yet.
            The lobby will open 5 minutes before the scheduled start time.
          </p>
          {lobbyState.draftStartsAt && (
            <p className="text-sm text-gray-500 mb-4">
              Scheduled for: {new Date(lobbyState.draftStartsAt).toLocaleString()}
            </p>
          )}
          <div className="bg-yellow-100 border border-yellow-400 rounded p-3 mb-4">
            <p className="text-sm text-yellow-800">
              Debug: Status = &quot;{lobbyState.status}&quot;
            </p>
            <p className="text-sm text-yellow-800">
              Time remaining: {lobbyState.timeRemaining || 'unknown'}
            </p>
            {isForced && (
              <p className="text-sm text-red-800 font-bold">
                🔧 FORCED MODE - API polling disabled
              </p>
            )}
          </div>
          <button
            onClick={() => {
              // Force show lobby for testing
              console.log('Force entering lobby with COUNTDOWN...');
              setIsForced(true); // Prevent API from overriding
              setLobbyState({
                status: 'COUNTDOWN',
                participantsOnline: [],
                timeRemaining: 300,
                draftStartsAt: new Date(Date.now() + 5 * 60 * 1000)
              });
              setIsLoading(false);
              setError(null);
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 mr-2"
          >
            🚀 Force Lobby (COUNTDOWN)
          </button>
          <button
            onClick={() => {
              // Force show lobby with OPEN status
              console.log('Force entering lobby with OPEN...');
              setIsForced(true); // Prevent API from overriding
              setLobbyState({
                status: 'OPEN',
                participantsOnline: [],
                timeRemaining: 0
              });
              setIsLoading(false);
              setError(null);
            }}
            className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 mr-2"
          >
            🎪 Force Lobby (OPEN)
          </button>
          <button
            onClick={() => {
              // Force show draft room directly
              console.log('Force entering draft room...');
              setIsForced(true); // Prevent API from overriding
              setLobbyState({
                status: 'LIVE',
                participantsOnline: []
              });
              setIsLoading(false);
              setError(null);
            }}
            className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 mr-2"
          >
            🎯 Force Enter Draft Room
          </button>
          <button
            onClick={async () => {
              console.log('Testing API directly...');
              try {
                const response = await fetch(`/api/drafts/${draftId}/lobby`);
                const data = await response.json();
                console.log('Direct API call result:', data);
                alert(`API Status: ${data.data?.status}, Time: ${data.data?.timeRemaining}`);
              } catch (err) {
                console.error('API test failed:', err);
              }
            }}
            className="bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 mr-2"
          >
            Test API
          </button>
          <button
            onClick={() => {
              // Reset to normal API mode
              console.log('Resetting to API mode...');
              setIsForced(false);
              setIsLoading(true);
              setError(null);
              fetchLobbyState();
            }}
            className="bg-yellow-600 text-white px-4 py-2 rounded-md hover:bg-yellow-700 mr-2"
          >
            🔄 Reset to API
          </button>
          <button
            onClick={() => window.location.reload()}
            className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700"
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  // Fallback: If lobby state failed to load, check draft status directly
  console.log('🚨 FALLBACK: No lobby state, checking draftData.status:', (draftData as { status?: string })?.status);
  if ((draftData as { status?: string })?.status === 'LIVE') {
    console.log('🚨 FALLBACK: Showing draft room based on draftData');
    return (
      <DraftRoomClient
        players={players as never}
        draftData={draftData as never}
      />
    );
  }

  // Default fallback - show the live draft room
  console.log('🚨 FINAL FALLBACK: Showing loading screen');
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center max-w-md">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Loading Draft...</h2>
        <p className="text-gray-600 mb-6">
          Preparing your draft experience...
        </p>
        <button
          onClick={() => window.location.reload()}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
