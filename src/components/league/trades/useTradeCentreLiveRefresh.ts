'use client';

import { useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { useSocket } from '@/providers/SocketProvider';

// Catch-up cadence while no live room is delivering events (no socket, a disconnected socket, or a
// join the server never answers). One small revision request per tick; the snapshot reloads only
// when the revision changed.
export const TRADE_CATCH_UP_INTERVAL_MS = 10_000;
const TRADE_JOIN_TIMEOUT_MS = 5_000;

interface TradeCentreLiveRefreshOptions {
  leagueId: string;
  currentUserId?: string;
  /** The revision the rendered snapshot was built at; null when there is no snapshot. */
  revision: string | null;
  /** Reloads the server-rendered snapshot. */
  onChange: () => void;
}

/**
 * Keeps the Trade Centre current. With a live league room it refreshes on each `trade:update` and
 * after a reconnect; without one it polls the viewer's trade revision. Mirrors useLeagueSocial.
 */
export function useTradeCentreLiveRefresh({
  leagueId,
  currentUserId,
  revision,
  onChange,
}: TradeCentreLiveRefreshOptions): { live: boolean } {
  const socket = useSocket();
  const [live, setLive] = useState(false);
  const onChangeRef = useRef(onChange);
  const revisionRef = useRef(revision);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);

  useEffect(() => {
    if (!socket) return;

    let cancelled = false;
    let joinTimeoutId: number | null = null;
    const clearJoinTimeout = () => {
      if (joinTimeoutId !== null) window.clearTimeout(joinTimeoutId);
      joinTimeoutId = null;
    };
    // The league members' room is the one the social widget joins; joining twice is harmless.
    const join = () => {
      clearJoinTimeout();
      joinTimeoutId = window.setTimeout(() => {
        joinTimeoutId = null;
        if (!cancelled) setLive(false);
      }, TRADE_JOIN_TIMEOUT_MS);
      socket.emit('social:join', { leagueId }, (acknowledgement: { ok?: boolean } | undefined) => {
        clearJoinTimeout();
        if (!cancelled) setLive(acknowledgement?.ok === true);
      });
    };
    const handleTradeUpdate = (envelope: { leagueId?: unknown } | undefined) => {
      if (envelope?.leagueId === leagueId) onChangeRef.current();
    };
    const handleConnect = () => {
      join();
      // Events may have been missed while disconnected.
      onChangeRef.current();
    };
    const handleDisconnect = () => setLive(false);

    socket.on('trade:update', handleTradeUpdate);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    if (socket.connected) join();

    return () => {
      cancelled = true;
      clearJoinTimeout();
      setLive(false);
      socket.off('trade:update', handleTradeUpdate);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, [socket, leagueId]);

  useEffect(() => {
    if (live) return;

    let inFlight = false;
    const path = `/api/leagues/${encodeURIComponent(leagueId)}/trades/revision`;
    const intervalId = window.setInterval(() => {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      void (async () => {
        try {
          const response = await authenticatedFetch(path, { cache: 'no-store' }, currentUserId);
          if (!response.ok) return;
          const body = (await response.json()) as { revision?: unknown };
          if (typeof body.revision !== 'string' || body.revision === revisionRef.current) return;
          // Remember it now so the next tick does not refresh again before the new snapshot lands.
          revisionRef.current = body.revision;
          onChangeRef.current();
        } catch {
          // The next tick retries; a transient failure must not disturb what is on screen.
        } finally {
          inFlight = false;
        }
      })();
    }, TRADE_CATCH_UP_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [live, leagueId, currentUserId]);

  return { live };
}
