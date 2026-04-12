'use client';

import { X, AlertTriangle, User } from 'lucide-react';

import { TeamLogo } from '@/components/TeamLogo';

interface DraftedPlayer {
  id: string;
  name: string;
  position: string;
  club: string;
  draftedBy?: string;
  draftedAt?: string;
  pickNumber?: number;
}

interface WatchlistPlayerAlertProps {
  alerts: DraftedPlayer[];
  onDismiss: (playerId: string) => void;
  onDismissAll: () => void;
}

export const WatchlistPlayerAlert = ({
  alerts,
  onDismiss,
  onDismissAll,
}: WatchlistPlayerAlertProps) => {
  if (alerts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
      {alerts.length > 1 && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <AlertTriangle className="h-5 w-5 text-orange-500 mr-2" />
              <span className="text-sm font-medium text-orange-800">
                {alerts.length} watchlist players drafted
              </span>
            </div>
            <button
              onClick={onDismissAll}
              className="text-orange-400 hover:text-orange-600 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={onDismissAll}
            className="mt-2 text-xs text-orange-600 hover:text-orange-800 underline"
          >
            Dismiss all
          </button>
        </div>
      )}

      {alerts.map((player) => (
        <div
          key={player.id}
          className="bg-red-50 border border-red-200 rounded-lg p-4 shadow-lg animate-slide-in-right"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center mb-2">
                <User className="h-4 w-4 text-red-500 mr-2" />
                <h4 className="text-sm font-semibold text-red-800">Watchlist Player Drafted!</h4>
              </div>
              <div className="text-sm text-red-700">
                <p className="font-medium">{player.name}</p>
                <p className="flex flex-wrap items-center gap-2 text-red-600">
                  <span>{player.position}</span>
                  <span className="inline-flex items-center gap-1">
                    <TeamLogo team={player.club} size={14} withCircle decorative />
                    {player.club}
                  </span>
                </p>
                {player.draftedBy && (
                  <p className="text-xs text-red-500 mt-1">
                    Drafted by {player.draftedBy}
                    {player.pickNumber && ` (Pick #${player.pickNumber})`}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={() => onDismiss(player.id)}
              className="text-red-400 hover:text-red-600 transition-colors ml-2"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
