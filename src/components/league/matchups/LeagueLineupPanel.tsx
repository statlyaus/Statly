'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { authenticatedFetch } from '@/lib/authenticatedFetch';

import { LineupFieldBoard } from './LineupFieldBoard';
import {
  assignPlayerToSpot,
  buildLineupFieldSpots,
  buildInterchangeSpots,
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

interface LineupRoundContext {
  source: 'PUBLISHED' | 'SETUP_FALLBACK';
  round: number;
  aflRound: number | null;
  phase: 'REGULAR' | 'FINALS';
  lockState: 'OPEN' | 'LOCKED' | 'PUBLISHED_PENDING' | 'NO_MATCHUP';
  lockAt: string | null;
  fallbackLockAt: string | null;
  opponent: { id: string; teamName: string } | null;
}

function isLineupAssignment(player: LineupApiPlayer): player is LineupAssignment {
  return (
    player.playerId.length > 0 &&
    (player.slot === 'FWD' ||
      player.slot === 'DEF' ||
      player.slot === 'MID' ||
      player.slot === 'RUC' ||
      player.slot === 'UTIL' ||
      player.slot === 'INTERCHANGE') &&
    Number.isInteger(player.slotIndex) &&
    player.slotIndex >= 0
  );
}

export function LeagueLineupPanel({ leagueId, currentUserId }: LeagueLineupPanelProps) {
  const [assignments, setAssignments] = useState<LineupAssignment[]>([]);
  const [rosterPlayers, setRosterPlayers] = useState<LineupRosterPlayer[]>([]);
  const [lineupSlots, setLineupSlots] = useState(() => normalizeLineupBuilderSlots(null));
  const [interchangeSlots, setInterchangeSlots] = useState(0);
  const [context, setContext] = useState<LineupRoundContext | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [canManageCompetition, setCanManageCompetition] = useState(false);
  const [hasSavedLineup, setHasSavedLineup] = useState(false);
  const dragPlayerIdRef = useRef<string | null>(null);
  const persistedAssignmentsRef = useRef('');
  const round = 'current';

  const fieldSpots = useMemo(() => buildLineupFieldSpots(lineupSlots), [lineupSlots]);
  const interchangeFieldSpots = useMemo(
    () => buildInterchangeSpots(interchangeSlots),
    [interchangeSlots]
  );
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
      const nextAssignments = savedPlayers
        .map((player: LineupApiPlayer) => ({
          playerId: player.playerId,
          slot: player.slot,
          slotIndex: player.slotIndex,
          lockedAt: player.lockedAt ?? null,
        }))
        .filter(isLineupAssignment);

      setLineupSlots(normalizeLineupBuilderSlots(payload.data?.lineupSlots));
      setInterchangeSlots(Math.max(0, Number(payload.data?.interchangeSlots) || 0));
      setContext((payload.data?.context as LineupRoundContext | null) ?? null);
      setSetupRequired(Boolean(payload.data?.setupRequired));
      setCanManageCompetition(Boolean(payload.data?.canManageCompetition));
      setHasSavedLineup(Boolean(payload.data?.savedRound));
      setRosterPlayers(
        nextRosterPlayers.map((player: LineupRosterPlayer) => ({
          playerId: player.playerId,
          name: player.name,
          position: player.position ?? null,
          club: player.club ?? null,
        }))
      );
      persistedAssignmentsRef.current = JSON.stringify(nextAssignments);
      setAssignments(nextAssignments);
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

  async function saveLineup({ silent = false }: { silent?: boolean } = {}) {
    setMessage(null);
    setIsSaving(true);
    try {
      const response = await authenticatedFetch(
        `/api/leagues/${leagueId}/lineups/${round}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            players: assignments.map((player) => ({
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
      persistedAssignmentsRef.current = JSON.stringify(assignments);
      setHasSavedLineup(true);
      if (!silent) setMessage('Lineup saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save lineup.');
    } finally {
      setIsSaving(false);
    }
  }

  useEffect(() => {
    if (isLoading || isSaving) return;
    const serializedAssignments = JSON.stringify(assignments);
    if (serializedAssignments === persistedAssignmentsRef.current) return;

    const timeoutId = window.setTimeout(() => {
      void saveLineup({ silent: true });
    }, 500);
    return () => window.clearTimeout(timeoutId);
  }, [assignments, isLoading, isSaving]);

  const deadline = context?.lockAt ?? context?.fallbackLockAt;
  const deadlineText = deadline
    ? new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(deadline))
    : context?.lockState === 'PUBLISHED_PENDING'
      ? setupRequired
        ? 'Competition dates pending'
        : 'Official fixture timing pending'
      : 'Each player locks at official AFL game start';

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
            {context
              ? setupRequired
                ? `Round ${context.round} lineup · Schedule pending`
                : `Round ${context.round}${context.aflRound ? ` · AFL Round ${context.aflRound}` : ''} · ${
                    context.opponent ? `vs ${context.opponent.teamName}` : 'No matchup'
                  }`
              : 'Published round unavailable'}
          </p>
          <p className="mt-1 text-xs text-[color:var(--league-text-muted)]">
            {deadlineText}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void saveLineup()}
          disabled={isSaving || isLoading || context?.lockState === 'LOCKED'}
          className="rounded-md bg-[color:var(--league-primary)] px-3 py-2 text-sm font-semibold text-[color:var(--league-primary-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving
            ? 'Saving'
            : context?.lockState === 'LOCKED'
              ? 'Locked'
              : hasSavedLineup
                ? 'Saved'
                : 'Draft'}
        </button>
      </div>

      {setupRequired ? (
        <aside className="flex flex-col gap-3 border-l-4 border-[color:var(--league-primary)] bg-[color:var(--league-surface-muted)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[color:var(--league-text)]">
              {canManageCompetition ? 'Finish competition setup' : 'Competition schedule pending'}
            </h3>
            <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
              {canManageCompetition
                ? 'You can prepare this lineup now. Publish the competition to add opponents, dates, and lock times.'
                : 'You can prepare this lineup now. Opponents, dates, and lock times will appear after a commissioner publishes the competition.'}
            </p>
          </div>
          {canManageCompetition ? (
            <Link
              href={`/leagues/${encodeURIComponent(leagueId)}?tab=league-settings#competition-rules`}
              className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-md bg-[color:var(--league-primary)] px-4 text-sm font-semibold text-[color:var(--league-primary-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2"
            >
              Set competition rules
            </Link>
          ) : null}
        </aside>
      ) : null}

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
            interchangeSpots={interchangeFieldSpots}
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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 text-sm text-[color:var(--league-text-muted)]">
          <span>No roster players are available to set a lineup yet.</span>
          <Link
            href={`/leagues/${encodeURIComponent(leagueId)}?tab=roster`}
            className="font-semibold text-[color:var(--league-primary)] underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
          >
            View my roster
          </Link>
        </div>
      )}
    </section>
  );
}
