'use client';

import { useState, useEffect } from 'react';
import DraftLobby from './DraftLobby';
import DraftRoomClient from '@/app/drafts/[id]/DraftRoomClient';
import { Alert } from '@/components/ui';
import type { LobbyState } from '@/lib/draftLobby';

interface DraftContainerProps {
  draftId: string;
  memberId: string;
  players: any[];
  draftData: any;
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

  useEffect(() => {
    fetchLobbyState();
    const interval = setInterval(fetchLobbyState, 5000); // Check every 5 seconds
    return () => clearInterval(interval);
  }, [draftId]);

  const fetchLobbyState = async () => {
    try {
      const response = await fetch(`/api/drafts/${draftId}/lobby`);
      if (response.ok) {
        const data = await response.json();
        setLobbyState(data.data);
        setError(null); // Clear any previous errors
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Lobby API error:', response.status, errorData);
        setError(`Failed to load draft state: ${errorData.error || response.statusText}`);
      }
    } catch (err) {
      console.error('Lobby fetch error:', err);
      setError(`Failed to connect to draft: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

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
    // Show lobby if draft is in OPEN or COUNTDOWN state
    if (lobbyState.status === 'OPEN' || lobbyState.status === 'COUNTDOWN') {
      return (
        <DraftLobby
          draftId={draftId}
          memberId={memberId}
          onDraftStart={handleDraftStart}
        />
      );
    }

    // Show live draft room if draft is LIVE
    if (lobbyState.status === 'LIVE') {
      return (
        <DraftRoomClient
          players={players}
          draftData={draftData}
        />
      );
    }

    // Draft is not yet ready
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Draft Not Ready</h2>
          <p className="text-gray-600 mb-6">
            This draft is scheduled but the lobby hasn't opened yet.
            The lobby will open 5 minutes before the scheduled start time.
          </p>
          {lobbyState.draftStartsAt && (
            <p className="text-sm text-gray-500">
              Scheduled for: {new Date(lobbyState.draftStartsAt).toLocaleString()}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Fallback: If lobby state failed to load, check draft status directly
  if (draftData.status === 'LIVE') {
    return (
      <DraftRoomClient
        players={players}
        draftData={draftData}
      />
    );
  }

  // Default fallback - show the live draft room
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
