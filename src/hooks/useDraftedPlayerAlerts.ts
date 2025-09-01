'use client';

import { useEffect, useRef, useState } from 'react';

interface DraftedPlayer {
  id: string;
  name: string;
  position: string;
  club: string;
  draftedBy?: string;
  draftedAt?: string;
  pickNumber?: number;
}

interface WatchlistItem {
  playerId: string;
  rank: number;
  addedAt: string;
  notes?: string;
}

interface DraftedPlayerAlertsProps {
  draftedPlayerIds: string[];
  allPlayers: DraftedPlayer[];
  watchlistItems: WatchlistItem[];
  onWatchlistPlayerDrafted?: (player: DraftedPlayer) => void;
}

export const useDraftedPlayerAlerts = ({
  draftedPlayerIds,
  allPlayers,
  watchlistItems,
  onWatchlistPlayerDrafted,
}: DraftedPlayerAlertsProps) => {
  const [alerts, setAlerts] = useState<DraftedPlayer[]>([]);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());
  const previousDraftedIds = useRef<string[]>([]);
  const watchlistPlayerIds = useRef<Set<string>>(new Set());

  // Update watchlist player IDs when watchlist changes
  useEffect(() => {
    watchlistPlayerIds.current = new Set(watchlistItems.map((item) => item.playerId));
  }, [watchlistItems]);

  // Monitor for newly drafted players
  useEffect(() => {
    const newlyDraftedIds = draftedPlayerIds.filter(
      (id) => !previousDraftedIds.current.includes(id)
    );

    if (newlyDraftedIds.length > 0) {
      const newlyDraftedWatchlistPlayers = newlyDraftedIds
        .filter((id) => watchlistPlayerIds.current.has(id))
        .map((id) => allPlayers.find((player) => player.id === id))
        .filter(Boolean) as DraftedPlayer[];

      if (newlyDraftedWatchlistPlayers.length > 0) {
        // Add new alerts
        setAlerts((prev) => [...prev, ...newlyDraftedWatchlistPlayers]);

        // Call callback for each drafted watchlist player
        newlyDraftedWatchlistPlayers.forEach((player) => {
          onWatchlistPlayerDrafted?.(player);

          // Show browser notification if permission granted
          if (
            typeof window !== 'undefined' &&
            'Notification' in window &&
            Notification.permission === 'granted'
          ) {
            new Notification(`Watchlist Player Drafted!`, {
              body: `${player.name} (${player.position} - ${player.club}) has been drafted.`,
              icon: '/favicon.ico',
              tag: `drafted-${player.id}`,
            });
          }
        });
      }
    }

    previousDraftedIds.current = [...draftedPlayerIds];
  }, [draftedPlayerIds, allPlayers, onWatchlistPlayerDrafted]);

  // Request notification permission on first use
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'default'
    ) {
      Notification.requestPermission();
    }
  }, []);

  const dismissAlert = (playerId: string) => {
    setDismissedAlerts((prev) => new Set([...prev, playerId]));
    setAlerts((prev) => prev.filter((alert) => alert.id !== playerId));
  };

  const dismissAllAlerts = () => {
    setAlerts([]);
    setDismissedAlerts(new Set());
  };

  // Filter out dismissed alerts
  const activeAlerts = alerts.filter((alert) => !dismissedAlerts.has(alert.id));

  return {
    alerts: activeAlerts,
    dismissAlert,
    dismissAllAlerts,
    hasActiveAlerts: activeAlerts.length > 0,
  };
};
