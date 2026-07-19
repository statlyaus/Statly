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

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
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
  const failedSaveAssignmentsRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);
  const saveGenerationRef = useRef(0);
  const saveAbortControllerRef = useRef<AbortController | null>(null);
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

  useEffect(() => {
    const controller = new AbortController();
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    saveAbortControllerRef.current?.abort();
    saveAbortControllerRef.current = null;
    saveGenerationRef.current += 1;
    setIsSaving(false);
    setIsLoading(true);
    setAssignments([]);
    setRosterPlayers([]);
    setLineupSlots(normalizeLineupBuilderSlots(null));
    setInterchangeSlots(0);
    setContext(null);
    setSelectedPlayerId(null);
    setSetupRequired(false);
    setCanManageCompetition(false);
    setHasSavedLineup(false);
    persistedAssignmentsRef.current = '';
    failedSaveAssignmentsRef.current = null;

    async function loadLineup() {
      setMessage(null);
      try {
        const response = await authenticatedFetch(
          `/api/leagues/${leagueId}/lineups/${round}`,
          { signal: controller.signal },
          currentUserId
        );
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          throw new Error(payload.error ?? 'Failed to load lineup.');
        }
        if (controller.signal.aborted || generation !== loadGenerationRef.current) return;

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
        const serializedAssignments = JSON.stringify(nextAssignments);
        persistedAssignmentsRef.current = serializedAssignments;
        failedSaveAssignmentsRef.current = null;
        setAssignments(nextAssignments);
        setSelectedPlayerId(null);
      } catch (error) {
        if (
          controller.signal.aborted ||
          generation !== loadGenerationRef.current ||
          isAbortError(error)
        ) {
          return;
        }
        setMessage(error instanceof Error ? error.message : 'Failed to load lineup.');
      } finally {
        if (!controller.signal.aborted && generation === loadGenerationRef.current) {
          setIsLoading(false);
        }
      }
    }

    void loadLineup();
    return () => {
      controller.abort();
      if (generation === loadGenerationRef.current) loadGenerationRef.current += 1;
      saveAbortControllerRef.current?.abort();
      saveGenerationRef.current += 1;
    };
  }, [leagueId, currentUserId]);

  const isLineupEditable =
    context?.lockState === 'OPEN' || context?.lockState === 'PUBLISHED_PENDING';
  const disabledReason = isSaving
    ? 'Lineup changes are being saved.'
    : context?.lockState === 'LOCKED'
      ? 'This lineup is locked.'
      : context?.lockState === 'NO_MATCHUP'
        ? 'No matchup is scheduled for this round.'
        : !context
          ? 'A published round is not available.'
          : undefined;

  function setDragPlayer(playerId: string | null) {
    dragPlayerIdRef.current = isLineupEditable && !isSaving ? playerId : null;
  }

  function assignPlayer(playerId: string, spot: LineupFieldSpot) {
    if (!isLineupEditable || isSaving) return;
    failedSaveAssignmentsRef.current = null;
    setAssignments((current) => assignPlayerToSpot(current, playerId, spot));
    setHasSavedLineup(false);
    setSelectedPlayerId(null);
    setMessage(null);
  }

  function removePlayerFromSlot(spot: LineupFieldSpot) {
    if (!isLineupEditable || isSaving) return;
    failedSaveAssignmentsRef.current = null;
    setAssignments((current) => removeAssignmentFromSpot(current, spot));
    setHasSavedLineup(false);
    setMessage(null);
  }

  async function saveLineup({
    silent = false,
    nextAssignments = assignments,
  }: {
    silent?: boolean;
    nextAssignments?: readonly LineupAssignment[];
  } = {}) {
    if (!isLineupEditable) return;

    const serializedAssignments = JSON.stringify(nextAssignments);
    const controller = new AbortController();
    const generation = saveGenerationRef.current + 1;
    saveGenerationRef.current = generation;
    saveAbortControllerRef.current?.abort();
    saveAbortControllerRef.current = controller;
    if (!silent) setMessage(null);
    setIsSaving(true);
    try {
      const response = await authenticatedFetch(
        `/api/leagues/${leagueId}/lineups/${round}`,
        {
          method: 'PATCH',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            players: nextAssignments.map((player) => ({
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
      if (controller.signal.aborted || generation !== saveGenerationRef.current) return;
      persistedAssignmentsRef.current = serializedAssignments;
      failedSaveAssignmentsRef.current = null;
      setHasSavedLineup(true);
      if (!silent) setMessage('Lineup saved.');
    } catch (error) {
      if (
        controller.signal.aborted ||
        generation !== saveGenerationRef.current ||
        isAbortError(error)
      ) {
        return;
      }
      failedSaveAssignmentsRef.current = serializedAssignments;
      setMessage(error instanceof Error ? error.message : 'Failed to save lineup.');
    } finally {
      if (generation === saveGenerationRef.current) {
        if (saveAbortControllerRef.current === controller) saveAbortControllerRef.current = null;
        setIsSaving(false);
      }
    }
  }

  useEffect(() => {
    if (isLoading || isSaving || !isLineupEditable) return;
    const serializedAssignments = JSON.stringify(assignments);
    if (serializedAssignments === persistedAssignmentsRef.current) return;
    if (serializedAssignments === failedSaveAssignmentsRef.current) return;

    const timeoutId = window.setTimeout(() => {
      void saveLineup({ silent: true, nextAssignments: assignments });
    }, 500);
    return () => window.clearTimeout(timeoutId);
  }, [assignments, isLineupEditable, isLoading, isSaving]);

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
          <p className="mt-1 text-xs text-[color:var(--league-text-muted)]">{deadlineText}</p>
        </div>
        <button
          type="button"
          onClick={() => void saveLineup()}
          disabled={isSaving || isLoading || !isLineupEditable}
          aria-describedby={disabledReason ? 'lineup-disabled-reason' : undefined}
          className="rounded-md bg-[color:var(--league-primary)] px-3 py-2 text-sm font-semibold text-[color:var(--league-primary-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving
            ? 'Saving'
            : context?.lockState === 'LOCKED'
              ? 'Locked'
              : context?.lockState === 'NO_MATCHUP'
                ? 'No matchup'
                : hasSavedLineup
                  ? 'Saved'
                  : 'Draft'}
        </button>
      </div>

      {disabledReason ? (
        <p id="lineup-disabled-reason" role="status" className="text-sm text-muted-foreground">
          {disabledReason}
        </p>
      ) : null}

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
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-3 text-sm text-[color:var(--league-text)]"
        >
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
            disabled={!isLineupEditable || isSaving}
            disabledReason={disabledReason}
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
