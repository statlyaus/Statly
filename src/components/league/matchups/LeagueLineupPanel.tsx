'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { authenticatedFetch } from '@/lib/authenticatedFetch';

import { LineupFieldBoard } from './LineupFieldBoard';
import {
  assignPlayerToSpot,
  buildLineupFieldSpots,
  getAvailableRosterPlayers,
  normalizeLineupBuilderSlots,
  removeAssignmentFromSpot,
} from './lineupBuilderUtils';
import type { LineupAssignment, LineupFieldSpot, LineupRosterPlayer } from './lineupBuilderTypes';

interface LeagueLineupPanelProps {
  leagueId: string;
  currentUserId?: string;
}

interface LineupApiPlayer {
  playerId: string;
  slot: string;
  slotIndex: number;
  lockedAt?: string | null;
}

function isLineupAssignment(player: LineupApiPlayer): player is LineupAssignment {
  return (
    player.playerId.length > 0 &&
    (player.slot === 'FWD' ||
      player.slot === 'DEF' ||
      player.slot === 'MID' ||
      player.slot === 'RUC' ||
      player.slot === 'UTIL') &&
    Number.isInteger(player.slotIndex) &&
    player.slotIndex >= 0
  );
}

export function LeagueLineupPanel({ leagueId, currentUserId }: LeagueLineupPanelProps) {
  const [assignments, setAssignments] = useState<LineupAssignment[]>([]);
  const [rosterPlayers, setRosterPlayers] = useState<LineupRosterPlayer[]>([]);
  const [lineupSlots, setLineupSlots] = useState(() => normalizeLineupBuilderSlots(null));
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const dragPlayerIdRef = useRef<string | null>(null);
  const round = 1;

  const fieldSpots = useMemo(() => buildLineupFieldSpots(lineupSlots), [lineupSlots]);
  const availableRosterPlayers = useMemo(
    () => getAvailableRosterPlayers(rosterPlayers, assignments),
    [rosterPlayers, assignments]
  );

  async function loadLineup() {
    setIsLoading(true);
    setMessage(null);
    try {
      const response = await authenticatedFetch(
        `/api/leagues/${leagueId}/lineups/${round}`,
        {},
        currentUserId
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? 'Failed to load lineup.');
      }

      const nextRosterPlayers = Array.isArray(payload.data?.rosterPlayers)
        ? payload.data.rosterPlayers
        : [];
      const savedPlayers = Array.isArray(payload.data?.players) ? payload.data.players : [];

      setLineupSlots(normalizeLineupBuilderSlots(payload.data?.lineupSlots));
      setRosterPlayers(
        nextRosterPlayers.map((player: LineupRosterPlayer) => ({
          playerId: player.playerId,
          name: player.name,
          position: player.position ?? null,
          club: player.club ?? null,
        }))
      );
      setAssignments(
        savedPlayers
          .map((player: LineupApiPlayer) => ({
            playerId: player.playerId,
            slot: player.slot,
            slotIndex: player.slotIndex,
            lockedAt: player.lockedAt ?? null,
          }))
          .filter(isLineupAssignment)
      );
      setSelectedPlayerId(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load lineup.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadLineup();
  }, [leagueId, currentUserId]);

  function setDragPlayer(playerId: string | null) {
    dragPlayerIdRef.current = playerId;
  }

  function assignPlayer(playerId: string, spot: LineupFieldSpot) {
    setAssignments((current) => assignPlayerToSpot(current, playerId, spot));
    setSelectedPlayerId(null);
    setMessage(null);
  }

  function removePlayerFromSlot(spot: LineupFieldSpot) {
    setAssignments((current) => removeAssignmentFromSpot(current, spot));
    setMessage(null);
  }

  async function saveLineup() {
    setMessage(null);
    setIsSaving(true);
    try {
      const response = await authenticatedFetch(
        `/api/leagues/${leagueId}/lineups/${round}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            players: assignments
              .filter((player) => !player.lockedAt)
              .map((player) => ({
                playerId: player.playerId,
                slot: player.slot,
                slotIndex: player.slotIndex,
              })),
          }),
        },
        currentUserId
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.details?.join(', ') ?? payload.error ?? 'Failed to save lineup.');
      }
      await loadLineup();
      setMessage('Lineup saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save lineup.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="league-lineup-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 py-3 shadow-sm">
        <div>
          <h2
            id="league-lineup-heading"
            className="text-xl font-semibold text-[color:var(--league-text)]"
          >
            My Lineup
          </h2>
          <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
            Round 1 on-field roster
          </p>
        </div>
        <button
          type="button"
          onClick={() => void saveLineup()}
          disabled={isSaving || isLoading}
          className="rounded-md bg-[color:var(--league-primary)] px-3 py-2 text-sm font-semibold text-[color:var(--league-primary-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? 'Saving' : 'Save'}
        </button>
      </div>

      {message ? (
        <div className="rounded-md border border-[color:var(--league-border)] p-3 text-sm text-[color:var(--league-text)]">
          {message}
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-md border border-[color:var(--league-border)] p-4 text-sm text-[color:var(--league-text-muted)]">
          Loading lineup
        </div>
      ) : rosterPlayers.length ? (
        <div>
          <LineupFieldBoard
            spots={fieldSpots}
            assignments={assignments}
            rosterPlayers={rosterPlayers}
            availablePlayers={availableRosterPlayers}
            selectedPlayerId={selectedPlayerId}
            getDragPlayerId={() => dragPlayerIdRef.current}
            onSelectPlayer={setSelectedPlayerId}
            setDragPlayer={setDragPlayer}
            onAssignPlayer={assignPlayer}
            onClearSpot={removePlayerFromSlot}
          />
        </div>
      ) : (
        <div className="rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 text-sm text-[color:var(--league-text-muted)]">
          No roster players are available to set a lineup yet.
        </div>
      )}
    </section>
  );
}
