import React from 'react';
import { usePersistentDraft } from '@/hooks/usePersistentDraft';

interface PersistentDraftDemoProps {
  draftId: string;
  currentUserId: string;
}

export default function PersistentDraftDemo({ draftId, currentUserId }: PersistentDraftDemoProps) {
  const {
    // Data
    draftState,
    isLoading,
    isRecovering,
    error,
    lastSyncTime,
    recentActivity,
    
    // Actions
    makePick,
    updateQueue,
    forceSync,
    recoverDraftState,
    markOnline: _markOnline,
    markOffline: _markOffline
  } = usePersistentDraft({ draftId, currentUserId });

  const handleMakePick = async () => {
    try {
      await makePick(
        'player-123',
        'Demo Player',
        'MID',
        'Demo FC'
      );
    } catch (error) {
      console.error('Failed to make pick:', error);
    }
  };

  const handleUpdateQueue = async () => {
    const sampleQueue = ['player-456', 'player-789', 'player-012'];
    try {
      await updateQueue(sampleQueue);
    } catch (error) {
      console.error('Failed to update queue:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 bg-white rounded-lg shadow">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
        <p className="text-gray-600 mt-4">Loading draft state from Firestore...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-lg">
        <h3 className="text-red-800 font-semibold mb-2">❌ Error</h3>
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={recoverDraftState}
          disabled={isRecovering}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
        >
          {isRecovering ? 'Recovering...' : 'Retry Recovery'}
        </button>
      </div>
    );
  }

  if (!draftState) {
    return (
      <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-lg">
        <h3 className="text-yellow-800 font-semibold mb-2">⚠️ Draft Not Found</h3>
        <p className="text-yellow-600 mb-4">The draft could not be loaded from Firestore.</p>
        <button
          onClick={forceSync}
          className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700"
        >
          Force Sync
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with connection status */}
      <div className="bg-white p-6 rounded-lg shadow">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">📦 Persistent Draft: {draftState.name}</h2>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span className="text-sm text-gray-600">Synced with Firestore</span>
            </div>
            {lastSyncTime && (
              <span className="text-xs text-gray-500">
                Last sync: {lastSyncTime.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Status:</span>
            <span className={`ml-2 font-semibold ${
              draftState.status === 'LIVE' ? 'text-green-600' : 
              draftState.status === 'PENDING' ? 'text-yellow-600' : 'text-gray-600'
            }`}>
              {draftState.status}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Current Pick:</span>
            <span className="ml-2 font-semibold">{draftState.currentPick}</span>
          </div>
          <div>
            <span className="text-gray-500">Round:</span>
            <span className="ml-2 font-semibold">{draftState.currentRound}</span>
          </div>
          <div>
            <span className="text-gray-500">Picks Made:</span>
            <span className="ml-2 font-semibold">{draftState.picks.length}</span>
          </div>
        </div>
      </div>

      {/* Current turn indicator */}
      <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
        <h3 className="font-semibold text-blue-800 mb-2">🎯 Current Turn</h3>
        {draftState.participants[draftState.currentTurn] ? (
          <div className="flex items-center justify-between">
            <span className="text-blue-700">
              {draftState.participants[draftState.currentTurn].displayName}&apos;s turn
            </span>
            <span className="text-sm text-blue-600">
              {draftState.timeRemaining}s remaining
            </span>
          </div>
        ) : (
          <span className="text-blue-700">Calculating next turn...</span>
        )}
      </div>

      {/* Actions */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="font-semibold mb-4">🎮 Draft Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <button
            onClick={handleMakePick}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
          >
            Make Demo Pick
          </button>
          <button
            onClick={handleUpdateQueue}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Update Queue
          </button>
          <button
            onClick={forceSync}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
          >
            Force Sync
          </button>
          <button
            onClick={recoverDraftState}
            disabled={isRecovering}
            className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            {isRecovering ? 'Recovering...' : 'Recover State'}
          </button>
        </div>
      </div>

      {/* Recent activity */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="font-semibold mb-4">📋 Recent Activity</h3>
        {recentActivity.length > 0 ? (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {recentActivity.slice().reverse().map((activity) => (
              <div key={activity.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                <div className="flex items-center space-x-2">
                  <span className="text-sm">
                    {activity.type === 'pick' && '🎯'}
                    {activity.type === 'join' && '👋'}
                    {activity.type === 'leave' && '👋'}
                    {activity.type === 'recovery' && '🔄'}
                  </span>
                  <span className="text-sm">{activity.message}</span>
                </div>
                <span className="text-xs text-gray-500">
                  {activity.timestamp.toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No recent activity</p>
        )}
      </div>

      {/* Recent picks */}
      {draftState.picks.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="font-semibold mb-4">🏆 Recent Picks</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {draftState.picks.slice(-5).reverse().map((pick) => (
              <div key={pick.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                <div>
                  <span className="font-medium">{pick.player.name}</span>
                  <span className="text-sm text-gray-600 ml-2">
                    ({pick.player.position}, {pick.player.club})
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium">{pick.member.displayName}</div>
                  <div className="text-xs text-gray-500">Pick #{pick.overall}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Participants */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="font-semibold mb-4">👥 Participants</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {draftState.participants.map((participant, index) => (
            <div key={participant.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${
                  participant.isOnline ? 'bg-green-500' : 'bg-gray-400'
                }`}></div>
                <span className="text-sm font-medium">{participant.displayName}</span>
              </div>
              <div className="text-xs text-gray-500">
                Position {index + 1}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
