'use client';

import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { TeamMark } from '@/components/scores/MatchupScore';
import { useConfirmDialog } from '@/components/ui/ConfirmDialog';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { autoFillLineup, scorePlayersByStats } from '@/lib/leagues/lineupAutoFill';
import { getTeamAbbreviation, getTeamLogo } from '@/lib/teamLogos';
import type { LineupSlotSettings } from '@/server/leagues/scoringTypes';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import {
  DEFAULT_LINEUP_BUILDER_SLOTS,
  type LineupAssignment,
  type LineupFieldSpot,
} from '../matchups/lineupBuilderTypes';
import { LineupField, type FieldTarget } from './LineupField';
import {
  buildMyTeamSpots,
  canPlacePlayer,
  countLineupChanges,
  findAssignment,
  hasGameStarted,
  placePlayer,
  positionSuitsSlot,
  removeFromSpot,
  SLOT_GROUP_NAMES,
  summarizeLineup,
  type MyTeamSquadPlayer,
} from './myTeamLineup';

type LockState = 'OPEN' | 'LOCKED' | 'PUBLISHED_PENDING' | 'NO_MATCHUP' | 'TIMING_UNAVAILABLE';

interface RoundSummary {
  round: number;
  aflRound: number | null;
  status: string;
  startsAt: string | null;
  lockAt: string | null;
  lockState: Exclude<LockState, 'TIMING_UNAVAILABLE'>;
}

interface SquadPlayer extends MyTeamSquadPlayer {
  opponent?: string | null;
  isHome?: boolean | null;
  bye?: boolean;
  injury?: string | null;
}

interface TeamSummary {
  memberId: string;
  teamName: string;
  logoUrl: string | null;
  record: { wins: number; losses: number; draws: number } | null;
  rank: number | null;
  teams: number | null;
}

interface MyTeamData {
  requestedRound: number;
  savedRound: number | null;
  carriedFromRound: number | null;
  /** Set when no lineup is saved: where the default lineup in `players` came from. */
  defaultSource?: 'CARRIED' | 'AUTO' | null;
  players: Array<{ playerId: string; slot: string; slotIndex: number; lockedAt: string | null }>;
  rosterPlayers: SquadPlayer[];
  rounds: RoundSummary[];
  playerStats: LeaguePlayerStatDatasetDto | null;
  lineupSlots: LineupSlotSettings;
  interchangeSlots: number;
  lockPolicy: string;
  setupRequired: boolean;
  canManageCompetition: boolean;
  team?: TeamSummary | null;
  opponentTeam?: TeamSummary | null;
  context: {
    round: number;
    aflRound: number | null;
    startsAt: string | null;
    lockAt: string | null;
    lockState: LockState;
    opponent: { id: string; teamName: string } | null;
  } | null;
}

/** What the manager is in the middle of: moving a lineup player, filling a spot, or placing a bench player. */
type Selection =
  | { kind: 'spot'; spot: LineupFieldSpot; playerId: string | null }
  | { kind: 'bench'; playerId: string };
type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: Date }
  | { kind: 'error'; message: string };

const FIELD_COLLAPSED_KEY = 'statly.myTeam.fieldCollapsed';

const ACTIVE_SLOTS = new Set(['FWD', 'DEF', 'MID', 'RUC', 'UTIL', 'INTERCHANGE']);

function toAssignments(players: MyTeamData['players']): LineupAssignment[] {
  return players
    .filter((player) => ACTIVE_SLOTS.has(player.slot) && Number.isInteger(player.slotIndex))
    .map((player) => ({
      playerId: player.playerId,
      slot: player.slot as LineupAssignment['slot'],
      slotIndex: player.slotIndex,
      lockedAt: player.lockedAt,
    }));
}

function serialize(assignments: readonly LineupAssignment[]): string {
  return JSON.stringify(
    [...assignments]
      .map(({ playerId, slot, slotIndex }) => ({ playerId, slot, slotIndex }))
      .sort((left, right) =>
        `${left.slot}${left.slotIndex}`.localeCompare(`${right.slot}${right.slotIndex}`)
      )
  );
}

function normalizeSlots(input: unknown): LineupSlotSettings {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const read = (slot: keyof LineupSlotSettings) => {
    const value = source[slot];
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
      ? value
      : DEFAULT_LINEUP_BUILDER_SLOTS[slot];
  };
  return {
    FWD: read('FWD'),
    DEF: read('DEF'),
    MID: read('MID'),
    RUC: read('RUC'),
    UTIL: read('UTIL'),
  };
}

function formatGameTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatWhen(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatStat(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '–';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  return `${value}${['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'}`;
}

function describeRecord(team: TeamSummary | null | undefined): string | null {
  if (!team?.record) return null;
  const { wins, losses, draws } = team.record;
  const record = `${wins}–${losses}${draws ? `–${draws}` : ''}`;
  return team.rank ? `${record} · ${ordinal(team.rank)}` : record;
}

function roundStateLabel(summary: RoundSummary, now: Date): string {
  if (summary.lockState === 'NO_MATCHUP') return 'No matchup';
  if (summary.status === 'FINAL') return 'Final';
  if (summary.lockState === 'LOCKED') return 'Locked';
  if (summary.lockState === 'PUBLISHED_PENDING') return 'Dates pending';
  if (summary.startsAt && new Date(summary.startsAt) <= now) return 'Live';
  return 'Open';
}

export function LeagueMyTeamPanel({
  leagueId,
  currentUserId,
}: {
  leagueId: string;
  currentUserId?: string;
}): React.JSX.Element {
  const [requestedRound, setRequestedRound] = useState<string>('next');
  const [data, setData] = useState<MyTeamData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [assignments, setAssignments] = useState<LineupAssignment[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const [reloadKey, setReloadKey] = useState(0);
  // Phones can fold the field away; remembered per browser. The panel renders client-side after
  // loading, so reading storage up front cannot cause a hydration mismatch.
  const [fieldCollapsed, setFieldCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(FIELD_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  /** The lineup as saved, or the default the team gets if nothing changes. */
  const [baseline, setBaseline] = useState<LineupAssignment[]>([]);
  const saveControllerRef = useRef<AbortController | null>(null);
  const now = useMemo(() => new Date(), [data]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setLoadError(null);
    setSelection(null);
    authenticatedFetch(
      `/api/leagues/${encodeURIComponent(leagueId)}/lineups/${requestedRound}`,
      { signal: controller.signal },
      currentUserId
    )
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as {
          success?: boolean;
          data?: MyTeamData;
          error?: string;
        } | null;
        if (!response.ok || !payload?.success || !payload.data) {
          throw new Error(payload?.error ?? 'Your team could not be loaded.');
        }
        const next = payload.data;
        const nextAssignments = toAssignments(next.players ?? []);
        // The default lineup applies automatically; only changes need confirming.
        setData(next);
        setBaseline(nextAssignments);
        setAssignments(nextAssignments);
        setSaveState({ kind: 'idle' });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : 'Your team could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [leagueId, currentUserId, requestedRound, reloadKey]);

  const spots = useMemo(
    () => (data ? buildMyTeamSpots(normalizeSlots(data.lineupSlots), data.interchangeSlots) : []),
    [data]
  );
  const squadById = useMemo(
    () => new Map((data?.rosterPlayers ?? []).map((player) => [player.playerId, player])),
    [data]
  );
  const lockState = data?.context?.lockState ?? null;
  const editable = lockState === 'OPEN' || lockState === 'PUBLISHED_PENDING';
  const round = data?.requestedRound ?? null;
  const summary = summarizeLineup(assignments, spots);
  const selectedIds = new Set(assignments.map((assignment) => assignment.playerId));
  const bench = (data?.rosterPlayers ?? []).filter((player) => !selectedIds.has(player.playerId));
  const statColumns = data?.playerStats?.columns ?? [];
  const dirty = editable && serialize(assignments) !== serialize(baseline);
  const changeCount = dirty ? countLineupChanges(baseline, assignments) : 0;
  const positionOf = useCallback(
    (playerId: string) => squadById.get(playerId)?.position ?? null,
    [squadById]
  );
  const outOfPosition = assignments.filter((assignment) => {
    const player = squadById.get(assignment.playerId);
    return player ? !positionSuitsSlot(player.position, assignment.slot) : false;
  }).length;

  const isPlayerLocked = useCallback(
    (playerId: string) => {
      const assignment = assignments.find((entry) => entry.playerId === playerId);
      if (assignment?.lockedAt) return true;
      const squadPlayer = squadById.get(playerId);
      return squadPlayer ? hasGameStarted(squadPlayer, now) : false;
    },
    [assignments, squadById, now]
  );

  const save = useCallback(
    async (next: readonly LineupAssignment[]) => {
      if (!editable || round === null) return;
      saveControllerRef.current?.abort();
      const controller = new AbortController();
      saveControllerRef.current = controller;
      setSaveState({ kind: 'saving' });
      try {
        const response = await authenticatedFetch(
          `/api/leagues/${encodeURIComponent(leagueId)}/lineups/${round}`,
          {
            method: 'PATCH',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              players: next.map(({ playerId, slot, slotIndex }) => ({ playerId, slot, slotIndex })),
            }),
          },
          currentUserId
        );
        const payload = (await response.json().catch(() => null)) as {
          success?: boolean;
          error?: string;
          details?: string[];
        } | null;
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.details?.join(' ') || payload?.error || 'Save failed.');
        }
        if (controller.signal.aborted) return;
        setBaseline([...next]);
        setData((current) => (current ? { ...current, savedRound: round } : current));
        setSaveState({ kind: 'saved', at: new Date() });
      } catch (error) {
        if (controller.signal.aborted) return;
        setSaveState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Save failed.',
        });
      }
    },
    [currentUserId, editable, leagueId, round]
  );

  // Leaving with unconfirmed changes would lose them.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function update(next: LineupAssignment[]) {
    setAssignments(next);
    setSelection(null);
    if (saveState.kind === 'error') setSaveState({ kind: 'idle' });
  }

  function handleDiscard() {
    setAssignments(baseline);
    setSelection(null);
    setSaveState({ kind: 'idle' });
  }

  function goToRound(value: string) {
    if (!dirty) {
      setRequestedRound(value);
      return;
    }
    void confirm({
      title: 'Leave without confirming?',
      description: 'Your lineup changes for this round haven’t been confirmed.',
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      tone: 'danger',
    }).then((discard) => {
      if (discard) setRequestedRound(value);
    });
  }

  const filled = useMemo(() => {
    if (!data || !editable) return null;
    const scores = data.playerStats
      ? scorePlayersByStats(data.playerStats.columns, data.playerStats.playersById)
      : new Map<string, number>();
    return autoFillLineup({
      assignments,
      spots,
      players: data.rosterPlayers.map((player) => ({
        playerId: player.playerId,
        position: player.position,
        // Players on a bye, listed injured or already playing are not picked automatically.
        available: !player.bye && !player.injury && !hasGameStarted(player, now),
        score: scores.get(player.playerId) ?? 0,
      })),
    }) as LineupAssignment[];
  }, [assignments, data, editable, now, spots]);
  const canFill = Boolean(filled && filled.length > assignments.length);
  // Position spots no fit bench player can fill (e.g. no ruck in the squad).
  const unfillableSlots = [
    ...new Set(
      spots
        .filter((spot) => spot.slot !== 'UTIL' && spot.slot !== 'INTERCHANGE')
        .filter(
          (spot) =>
            !(filled ?? assignments).some(
              (entry) => entry.slot === spot.slot && entry.slotIndex === spot.slotIndex
            )
        )
        .map((spot) => spot.slot)
    ),
  ];

  function handleFill() {
    if (filled) update(filled);
  }

  async function handleDrop(player: SquadPlayer) {
    if (!currentUserId) return;
    const confirmed = await confirm({
      title: `Drop ${player.name}?`,
      description: 'They go on waivers and leave your squad straight away.',
      confirmLabel: 'Drop player',
      tone: 'danger',
    });
    if (!confirmed) return;
    setActionMessage(null);
    try {
      const response = await authenticatedFetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/actions/${encodeURIComponent(currentUserId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actionType: 'DROP_PLAYER',
            details: { playerId: player.playerId },
          }),
        },
        currentUserId
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string | { message?: string };
          message?: string;
        } | null;
        const message =
          typeof payload?.error === 'string' ? payload.error : payload?.error?.message;
        throw new Error(message ?? payload?.message ?? 'Drop failed.');
      }
      setActionMessage(`${player.name} dropped.`);
      setReloadKey((key) => key + 1);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Drop failed.');
    }
  }

  const rounds = data?.rounds ?? [];
  const roundIndex = rounds.findIndex((entry) => entry.round === round);
  const firstEditableRound = rounds.find(
    (entry) => entry.lockState === 'OPEN' || entry.lockState === 'PUBLISHED_PENDING'
  );
  const selectionName =
    selection?.kind === 'bench'
      ? squadById.get(selection.playerId)?.name
      : selection?.playerId
        ? squadById.get(selection.playerId)?.name
        : null;

  /** The action cell for a lineup spot, following the ESPN/Yahoo Move → Here/Swap pattern. */
  function spotAction(spot: LineupFieldSpot, occupant: SquadPlayer | undefined, locked: boolean) {
    if (!editable) return null;
    if (locked) {
      return <span className="text-xs font-semibold text-muted-foreground">Locked</span>;
    }
    if (!selection) {
      return occupant ? (
        <ActionButton
          label="Move"
          ariaLabel={`Move ${occupant.name} from ${spot.label}`}
          onClick={() => setSelection({ kind: 'spot', spot, playerId: occupant.playerId })}
        />
      ) : (
        <ActionButton
          label="Add"
          ariaLabel={`Add a player to ${spot.label}`}
          onClick={() => setSelection({ kind: 'spot', spot, playerId: null })}
        />
      );
    }
    if (selection.kind === 'spot' && selection.spot.id === spot.id) {
      return (
        <span className="flex justify-end gap-1">
          {selection.playerId ? (
            <ActionButton
              label="Bench"
              ariaLabel={`Move ${selectionName ?? 'player'} to the bench`}
              onClick={() => update(removeFromSpot(assignments, spot))}
            />
          ) : null}
          <ActionButton label="Cancel" ariaLabel="Cancel" onClick={() => setSelection(null)} />
        </span>
      );
    }
    const movingPlayerId =
      selection.kind === 'bench' ? selection.playerId : (selection.playerId ?? null);
    if (!movingPlayerId) return null;
    if (!canPlacePlayer(assignments, movingPlayerId, spot, positionOf)) return null;
    return (
      <ActionButton
        tone="target"
        label={occupant ? 'Swap' : 'Here'}
        ariaLabel={
          occupant
            ? `Swap ${selectionName ?? 'player'} with ${occupant.name}`
            : `Move ${selectionName ?? 'player'} to ${spot.label}`
        }
        onClick={() => update(placePlayer(assignments, movingPlayerId, spot))}
      />
    );
  }

  function benchAction(player: SquadPlayer, locked: boolean) {
    if (!editable) return null;
    if (locked) {
      return <span className="text-xs font-semibold text-muted-foreground">Locked</span>;
    }
    if (!selection) {
      return (
        <ActionButton
          label="Add"
          ariaLabel={`Add ${player.name} to the lineup`}
          onClick={() => setSelection({ kind: 'bench', playerId: player.playerId })}
        />
      );
    }
    if (selection.kind === 'bench') {
      return selection.playerId === player.playerId ? (
        <ActionButton label="Cancel" ariaLabel="Cancel" onClick={() => setSelection(null)} />
      ) : null;
    }
    if (!positionSuitsSlot(player.position, selection.spot.slot)) return null;
    return (
      <ActionButton
        tone="target"
        label={selection.playerId ? 'Swap' : 'Here'}
        ariaLabel={
          selection.playerId
            ? `Swap ${selectionName ?? 'player'} with ${player.name}`
            : `Put ${player.name} in ${selection.spot.label}`
        }
        onClick={() => update(placePlayer(assignments, player.playerId, selection.spot))}
      />
    );
  }

  function toggleField() {
    setFieldCollapsed((current) => {
      try {
        window.localStorage.setItem(FIELD_COLLAPSED_KEY, String(!current));
      } catch {
        // Storage unavailable: the choice lasts for this visit only.
      }
      return !current;
    });
  }

  // Field view: the same moves as the list's Move → Here/Swap buttons, driven by taps.
  const movingPlayerId =
    selection?.kind === 'bench' ? selection.playerId : (selection?.playerId ?? null);

  function spotTargetFor(spot: LineupFieldSpot): FieldTarget {
    if (!editable || !selection || !movingPlayerId) return null;
    if (selection.kind === 'spot' && selection.spot.id === spot.id) return null;
    const occupant = findAssignment(assignments, spot);
    if (occupant && isPlayerLocked(occupant.playerId)) return null;
    if (!canPlacePlayer(assignments, movingPlayerId, spot, positionOf)) return null;
    return occupant ? 'swap' : 'here';
  }

  function tapSpot(spot: LineupFieldSpot) {
    if (!editable) return;
    if (selection?.kind === 'spot' && selection.spot.id === spot.id) {
      setSelection(null);
      return;
    }
    if (movingPlayerId && spotTargetFor(spot)) {
      update(placePlayer(assignments, movingPlayerId, spot));
      return;
    }
    const occupant = findAssignment(assignments, spot);
    if (occupant && isPlayerLocked(occupant.playerId)) return;
    setSelection({ kind: 'spot', spot, playerId: occupant?.playerId ?? null });
    revealRow(`[data-spot-id="${spot.id}"]`);
  }

  function benchTargetFor(player: SquadPlayer): FieldTarget {
    if (!editable || selection?.kind !== 'spot' || isPlayerLocked(player.playerId)) return null;
    if (!positionSuitsSlot(player.position, selection.spot.slot)) return null;
    return selection.playerId ? 'swap' : 'here';
  }

  function tapBench(player: SquadPlayer) {
    if (!editable) return;
    if (selection?.kind === 'bench' && selection.playerId === player.playerId) {
      setSelection(null);
      return;
    }
    if (selection?.kind === 'spot' && benchTargetFor(player)) {
      update(placePlayer(assignments, player.playerId, selection.spot));
      return;
    }
    if (isPlayerLocked(player.playerId)) return;
    setSelection({ kind: 'bench', playerId: player.playerId });
    revealRow(`[data-bench-id="${player.playerId}"]`);
  }

  /** A click anywhere on a table row acts like tapping that player on the field. */
  function handleRowClick(event: React.MouseEvent<HTMLElement>, action: () => void) {
    if ((event.target as HTMLElement).closest('button, a, input, select, label')) return;
    action();
  }

  const fieldGroups = groupSpots(spots);
  // Slot 4.5rem, player at least 11rem, opponent 8rem, 4.25rem per stat and a 10rem action column.
  // Minimum table widths; narrower screens scroll the stats while slot and player stay pinned.
  // Phones: slot 4.5rem, player 9rem, action 8rem. From sm: player 11rem, action 10rem and the
  // 8rem opponent column. Every stat column is 4.25rem.
  const tableMinWidthStyle = {
    '--table-min': `${4.5 + 9 + 8 + statColumns.length * 4.25}rem`,
    '--table-min-sm': `${4.5 + 11 + 10 + 8 + statColumns.length * 4.25}rem`,
  } as CSSProperties;
  const statsById = data?.playerStats?.playersById ?? {};
  const onFieldTotals = statColumns.map((column) => {
    if (column.format === 'percentage') return null;
    let total = 0;
    let counted = 0;
    for (const assignment of assignments) {
      if (assignment.slot === 'INTERCHANGE') continue;
      const value = statsById[assignment.playerId]?.values[column.key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        total += value;
        counted += 1;
      }
    }
    return counted > 0 ? total : null;
  });

  return (
    <section aria-labelledby="my-team-heading" className="space-y-4 pb-20 sm:pb-0">
      {confirmDialog}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2
            id="my-team-heading"
            className="font-display text-2xl font-bold leading-tight text-foreground"
          >
            My team
          </h2>
          <p className="text-sm text-muted-foreground">
            {data?.context
              ? [
                  `Round ${data.context.round}`,
                  data.context.aflRound ? `AFL Round ${data.context.aflRound}` : null,
                  data.context.opponent
                    ? `vs ${data.context.opponent.teamName}`
                    : 'No opponent set',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : data?.setupRequired
                ? 'Schedule pending'
                : ' '}
          </p>
        </div>
        {rounds.length > 0 && round !== null ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous round"
              disabled={roundIndex <= 0 || isLoading}
              onClick={() => goToRound(String(rounds[roundIndex - 1].round))}
              className="inline-flex size-11 items-center justify-center rounded-md border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
            </button>
            <label className="sr-only" htmlFor="my-team-round">
              Round
            </label>
            <select
              id="my-team-round"
              value={round}
              disabled={isLoading}
              onChange={(event) => goToRound(event.target.value)}
              className="h-11 rounded-md border border-border bg-card px-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
            >
              {rounds.map((entry) => (
                <option key={entry.round} value={entry.round}>
                  Round {entry.round} · {roundStateLabel(entry, now)}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label="Next round"
              disabled={roundIndex < 0 || roundIndex >= rounds.length - 1 || isLoading}
              onClick={() => goToRound(String(rounds[roundIndex + 1].round))}
              className="inline-flex size-11 items-center justify-center rounded-md border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
            >
              <ChevronRight aria-hidden="true" className="size-4" />
            </button>
          </div>
        ) : null}
      </header>

      {loadError ? (
        <div role="alert" className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
          <p className="font-semibold text-foreground">{loadError}</p>
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            className="mt-2 inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-semibold text-foreground hover:bg-muted"
          >
            Try again
          </button>
        </div>
      ) : null}

      {isLoading && !data ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground"
        >
          Loading your team…
        </p>
      ) : null}

      {data ? (
        <div className={`space-y-4 ${isLoading ? 'opacity-60' : ''}`} aria-busy={isLoading}>
          <section
            aria-label="Lineup readiness"
            className="overflow-hidden rounded-lg border border-border bg-card"
          >
            <MatchupStrip data={data} leagueId={leagueId} />
            <ReadinessRow
              data={data}
              summary={summary}
              selectedIds={selectedIds}
              editable={editable}
              saveState={saveState}
              dirty={dirty}
              outOfPosition={outOfPosition}
              firstEditableRound={firstEditableRound?.round ?? null}
              onFill={handleFill}
              canFill={canFill}
              unfillableSlots={editable ? unfillableSlots : []}
              onGoToRound={(value) => goToRound(String(value))}
            />
          </section>

          {actionMessage ? (
            <p role="status" className="text-sm text-foreground">
              {actionMessage}
            </p>
          ) : null}

          {data.rosterPlayers.length === 0 ? (
            <p className="rounded-lg border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
              Your squad is empty. Players arrive through the draft, waivers and trades.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,27rem)_minmax(0,1fr)]">
                <div className="min-w-0 lg:sticky lg:top-20">
                  <LineupField
                    spots={spots}
                    assignments={assignments}
                    squadById={squadById}
                    bench={bench}
                    editable={editable}
                    selectedSpotId={selection?.kind === 'spot' ? selection.spot.id : null}
                    selectedBenchId={selection?.kind === 'bench' ? selection.playerId : null}
                    isLocked={isPlayerLocked}
                    spotTarget={spotTargetFor}
                    benchTarget={benchTargetFor}
                    onSpot={tapSpot}
                    onBench={tapBench}
                    collapsed={fieldCollapsed}
                    onToggleCollapsed={toggleField}
                  />
                </div>
                <div className="min-w-0 space-y-4">
                  <section
                    aria-labelledby="my-team-lineup-heading"
                    className="overflow-hidden rounded-lg border border-border bg-card"
                  >
                    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                      <h3
                        id="my-team-lineup-heading"
                        className="font-display text-lg font-bold leading-tight text-foreground"
                      >
                        Round {round} lineup
                      </h3>
                      {selection ? (
                        <p aria-live="polite" className="text-xs font-semibold text-foreground">
                          {selection.kind === 'bench'
                            ? `Placing ${selectionName ?? 'player'}: choose Here or Swap.`
                            : selection.playerId
                              ? `Moving ${selectionName ?? 'player'}: choose Here, Swap or Bench. Only spots they can play are offered.`
                              : `Filling ${selection.spot.label}: choose a bench player who can play ${selection.spot.slot}.`}
                        </p>
                      ) : null}
                    </header>
                    <div className="relative overflow-x-auto">
                      <table
                        className="w-full min-w-[var(--table-min)] table-fixed text-sm sm:min-w-[var(--table-min-sm)]"
                        style={tableMinWidthStyle}
                      >
                        <caption className="sr-only">Round {round} lineup by position</caption>
                        <TableHead statColumns={statColumns} />
                        {fieldGroups.map(({ slot, spots: groupSpotsList }, groupIndex) => (
                          <tbody
                            key={slot}
                            aria-label={SLOT_GROUP_NAMES[slot]}
                            className={groupIndex > 0 ? 'border-t-2 border-border' : undefined}
                          >
                            {slot === 'INTERCHANGE' ? (
                              <GroupRow
                                label="Interchange · steps in if a starter doesn't play"
                                statCount={statColumns.length}
                              />
                            ) : null}
                            {groupSpotsList.map((spot) => {
                              const assignment = findAssignment(assignments, spot);
                              const player = assignment
                                ? squadById.get(assignment.playerId)
                                : undefined;
                              const locked = assignment
                                ? isPlayerLocked(assignment.playerId)
                                : false;
                              const isSelected =
                                selection?.kind === 'spot' && selection.spot.id === spot.id;
                              return (
                                <tr
                                  key={spot.id}
                                  aria-label={`${spot.label}: ${player?.name ?? 'empty'}`}
                                  data-spot-id={spot.id}
                                  onClick={(event) => handleRowClick(event, () => tapSpot(spot))}
                                  className={`h-14 border-b border-border last:border-b-0 ${editable ? 'cursor-pointer' : ''} ${isSelected ? 'bg-accent' : ''}`}
                                >
                                  <td
                                    className={`sticky left-0 z-10 pl-4 pr-2 ${isSelected ? 'bg-accent' : 'bg-card'}`}
                                  >
                                    <SlotBadge spot={spot} />
                                  </td>
                                  <td
                                    className={`sticky left-[4.5rem] z-10 py-1.5 pr-2 shadow-[1px_0_0_0_var(--border)] ${isSelected ? 'bg-accent' : 'bg-card'}`}
                                  >
                                    {player ? (
                                      <PlayerCell
                                        player={player}
                                        locked={locked}
                                        outOfPosition={
                                          positionSuitsSlot(player.position, spot.slot)
                                            ? null
                                            : spot.slot
                                        }
                                      />
                                    ) : assignment ? (
                                      <span className="text-sm text-muted-foreground">
                                        Player no longer in squad
                                      </span>
                                    ) : (
                                      <span className="text-sm font-semibold text-result-draw">
                                        Empty
                                      </span>
                                    )}
                                  </td>
                                  <td className="whitespace-nowrap px-2">
                                    {spotAction(spot, player, locked)}
                                  </td>
                                  <td className="hidden whitespace-nowrap px-3 sm:table-cell">
                                    {player ? (
                                      <OpponentCell player={player} locked={locked} />
                                    ) : null}
                                  </td>
                                  {statColumns.map((column) => (
                                    <td
                                      key={column.key}
                                      className="whitespace-nowrap px-3 text-right text-sm tabular-nums text-foreground last:pr-4"
                                    >
                                      {player
                                        ? formatStat(statsById[player.playerId]?.values[column.key])
                                        : ''}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        ))}
                        {statColumns.length > 0 ? (
                          <tfoot>
                            <tr className="border-t-2 border-border bg-muted text-sm">
                              <th
                                scope="row"
                                colSpan={2}
                                className="sticky left-0 z-10 bg-muted px-4 py-2 text-left font-semibold text-foreground shadow-[1px_0_0_0_var(--border)]"
                              >
                                On-field total
                              </th>
                              <td />
                              <td className="hidden sm:table-cell" />
                              {onFieldTotals.map((total, index) => (
                                <td
                                  key={statColumns[index].key}
                                  className="whitespace-nowrap px-3 py-2.5 text-right font-bold tabular-nums text-foreground last:pr-4"
                                >
                                  {total === null ? '–' : formatStat(Math.round(total * 10) / 10)}
                                </td>
                              ))}
                            </tr>
                          </tfoot>
                        ) : null}
                      </table>
                    </div>
                  </section>

                  <section
                    aria-labelledby="my-team-bench-heading"
                    className="overflow-hidden rounded-lg border border-border bg-card"
                  >
                    <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
                      <h3
                        id="my-team-bench-heading"
                        className="font-display text-lg font-bold leading-tight text-foreground"
                      >
                        Bench
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {bench.length} of {data.rosterPlayers.length} in squad · bench players
                        don&apos;t score
                      </p>
                    </header>
                    {bench.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-muted-foreground">
                        Every squad player is in this lineup.
                      </p>
                    ) : (
                      <div className="relative overflow-x-auto">
                        <table
                          className="w-full min-w-[var(--table-min)] table-fixed text-sm sm:min-w-[var(--table-min-sm)]"
                          style={tableMinWidthStyle}
                        >
                          <caption className="sr-only">
                            Bench players not in the Round {round} lineup
                          </caption>
                          <TableHead statColumns={statColumns} />
                          <tbody>
                            {bench.map((player) => {
                              const locked = hasGameStarted(player, now);
                              const isSelected =
                                selection?.kind === 'bench' &&
                                selection.playerId === player.playerId;
                              return (
                                <tr
                                  key={player.playerId}
                                  aria-label={`Bench: ${player.name}`}
                                  data-bench-id={player.playerId}
                                  onClick={(event) => handleRowClick(event, () => tapBench(player))}
                                  className={`h-14 border-b border-border last:border-b-0 ${editable ? 'cursor-pointer' : ''} ${isSelected ? 'bg-accent' : ''}`}
                                >
                                  <td
                                    className={`sticky left-0 z-10 pl-4 pr-2 ${isSelected ? 'bg-accent' : 'bg-card'}`}
                                  >
                                    <span className="inline-flex h-7 w-12 items-center justify-center rounded border border-border text-[0.75rem] font-bold text-muted-foreground">
                                      BN
                                    </span>
                                  </td>
                                  <td
                                    className={`sticky left-[4.5rem] z-10 py-1.5 pr-2 shadow-[1px_0_0_0_var(--border)] ${isSelected ? 'bg-accent' : 'bg-card'}`}
                                  >
                                    <PlayerCell player={player} locked={locked} />
                                  </td>
                                  <td className="whitespace-nowrap px-2">
                                    <span className="flex items-center gap-1">
                                      {benchAction(player, locked)}
                                      {!selection ? (
                                        <button
                                          type="button"
                                          onClick={() => void handleDrop(player)}
                                          aria-label={`Drop ${player.name}`}
                                          className="inline-flex min-h-11 items-center rounded-md px-2 text-xs font-semibold text-result-loss hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
                                        >
                                          Drop
                                        </button>
                                      ) : null}
                                    </span>
                                  </td>
                                  <td className="hidden whitespace-nowrap px-3 sm:table-cell">
                                    <OpponentCell player={player} locked={locked} />
                                  </td>
                                  {statColumns.map((column) => (
                                    <td
                                      key={column.key}
                                      className="whitespace-nowrap px-3 text-right text-sm tabular-nums text-foreground last:pr-4"
                                    >
                                      {formatStat(statsById[player.playerId]?.values[column.key])}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </>
          )}

          {dirty ? (
            <div
              role="region"
              aria-label="Unconfirmed changes"
              className="sticky bottom-3 z-20 mr-16 flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-brand-bar bg-card px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  {changeCount} {changeCount === 1 ? 'change' : 'changes'} to confirm
                </p>
                {saveState.kind === 'error' ? (
                  <p role="alert" className="text-xs font-semibold text-result-loss">
                    Not saved: {saveState.message}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Round {round} keeps its current team until you confirm.
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDiscard}
                  disabled={saveState.kind === 'saving'}
                  className="inline-flex min-h-11 items-center rounded-md border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => void save(assignments)}
                  disabled={saveState.kind === 'saving'}
                  className="inline-flex min-h-11 items-center rounded-md bg-brand-bar px-4 text-sm font-semibold text-brand-bar-foreground hover:bg-brand-bar/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar focus-visible:ring-offset-2"
                >
                  {saveState.kind === 'saving' ? 'Saving…' : 'Confirm lineup'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function revealRow(selector: string) {
  if (typeof window === 'undefined' || !window.matchMedia?.('(min-width: 1024px)').matches) return;
  window.requestAnimationFrame(() => {
    document.querySelector(selector)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function groupSpots(spots: readonly LineupFieldSpot[]) {
  const groups: Array<{ slot: LineupFieldSpot['slot']; spots: LineupFieldSpot[] }> = [];
  for (const spot of spots) {
    const group = groups.at(-1);
    if (group?.slot === spot.slot) group.spots.push(spot);
    else groups.push({ slot: spot.slot, spots: [spot] });
  }
  return groups;
}

function TableHead({ statColumns }: { statColumns: LeaguePlayerStatDatasetDto['columns'] }) {
  return (
    <thead>
      <tr className="border-b border-border text-xs text-muted-foreground">
        <th
          scope="col"
          className="sticky left-0 z-10 w-[4.5rem] bg-card py-2 pl-4 pr-2 text-left font-semibold"
        >
          Slot
        </th>
        <th
          scope="col"
          className="sticky left-[4.5rem] z-10 bg-card py-2 pr-2 text-left font-semibold shadow-[1px_0_0_0_var(--border)]"
        >
          Player
        </th>
        <th scope="col" className="w-32 px-2 py-2 text-left font-semibold sm:w-40">
          <span className="sr-only">Action</span>
        </th>
        <th
          scope="col"
          className="hidden w-32 whitespace-nowrap px-3 py-2 text-left font-semibold sm:table-cell"
        >
          Opp
        </th>
        {statColumns.map((column) => (
          <th
            key={column.key}
            scope="col"
            className="w-[4.25rem] whitespace-nowrap px-3 py-2 text-right font-semibold last:pr-4"
          >
            <abbr title={`${column.label}, season average per game`} className="no-underline">
              {column.shortLabel}
            </abbr>
          </th>
        ))}
      </tr>
    </thead>
  );
}

function GroupRow({ label, statCount }: { label: string; statCount: number }) {
  // One row per breakpoint, each spanning exactly the visible columns (the opponent column
  // appears from sm), so the fixed table layout gains no phantom columns.
  const variants = [
    { className: 'bg-muted sm:hidden', span: 3 + statCount },
    { className: 'hidden bg-muted sm:table-row', span: 4 + statCount },
  ];
  return (
    <>
      {variants.map((variant) => (
        <tr key={variant.className} className={variant.className}>
          <th
            scope="colgroup"
            colSpan={variant.span}
            className="py-1.5 text-left text-xs font-semibold text-muted-foreground"
          >
            <span className="sticky left-0 inline-block px-4">{label}</span>
          </th>
        </tr>
      ))}
    </>
  );
}

function SlotBadge({ spot }: { spot: LineupFieldSpot }) {
  const interchange = spot.slot === 'INTERCHANGE';
  return (
    <span
      title={spot.label}
      className={`inline-flex h-7 w-12 items-center justify-center rounded text-[0.75rem] font-bold ${
        interchange
          ? 'border border-border text-foreground'
          : 'bg-brand-bar text-brand-bar-foreground'
      }`}
    >
      {interchange ? 'INT' : spot.slot}
    </span>
  );
}

function PlayerCell({
  player,
  locked,
  outOfPosition = null,
}: {
  player: SquadPlayer;
  locked: boolean;
  /** The slot this player is in but is not listed for. */
  outOfPosition?: string | null;
}) {
  const club = player.club ? getTeamAbbreviation(player.club) : null;
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {player.club ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={getTeamLogo(player.club)} alt="" className="size-7 shrink-0 object-contain" />
      ) : (
        <span className="size-7 shrink-0" />
      )}
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <Link
            href={`/players/${encodeURIComponent(player.playerId)}`}
            className="truncate font-semibold text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
          >
            {player.name}
          </Link>
          {locked ? (
            <Lock aria-label="Locked" className="size-3 shrink-0 text-muted-foreground" />
          ) : null}
          {player.bye ? <Tag tone="warn" label="BYE" title="Club has a bye this round" /> : null}
          {player.injury ? <Tag tone="bad" label="INJ" title={player.injury} /> : null}
          {outOfPosition ? (
            <Tag
              tone="bad"
              label="OUT OF POS"
              title={`Listed ${player.position || 'without a position'}, can't play ${outOfPosition}`}
            />
          ) : null}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {[player.position, club].filter(Boolean).join(' · ')}
          <span className="sm:hidden">
            {' · '}
            <OpponentText player={player} locked={locked} />
          </span>
        </span>
      </span>
    </span>
  );
}

function Tag({ tone, label, title }: { tone: 'warn' | 'bad'; label: string; title: string }) {
  return (
    <span
      title={title}
      className={`shrink-0 rounded-sm px-1 text-[0.6875rem] font-bold leading-4 ${
        tone === 'bad'
          ? 'bg-result-loss text-result-loss-foreground'
          : 'bg-result-draw text-result-draw-foreground'
      }`}
    >
      {label}
      <span className="sr-only">: {title}</span>
    </span>
  );
}

function OpponentText({ player, locked }: { player: SquadPlayer; locked: boolean }) {
  if (player.bye) return <>Bye</>;
  const opponent = player.opponent ? getTeamAbbreviation(player.opponent) : null;
  const when = locked ? 'Locked' : formatGameTime(player.gameStartsAt);
  if (!opponent && !when) return <>Fixture TBC</>;
  return (
    <>
      {opponent ? `${player.isHome === false ? '@' : 'v'} ${opponent}` : ''}
      {opponent && when ? ' · ' : ''}
      {when ?? ''}
    </>
  );
}

function OpponentCell({ player, locked }: { player: SquadPlayer; locked: boolean }) {
  if (player.bye) {
    return <span className="text-xs font-bold text-result-draw">BYE</span>;
  }
  const opponent = player.opponent ? getTeamAbbreviation(player.opponent) : null;
  const when = formatGameTime(player.gameStartsAt);
  if (!opponent && !when) return <span className="text-xs text-muted-foreground">TBC</span>;
  return (
    <span className="flex flex-col text-xs leading-tight">
      <span className="font-semibold text-foreground">
        {opponent ? `${player.isHome === false ? '@' : 'v'} ${opponent}` : '—'}
      </span>
      <span className="text-muted-foreground">{locked ? 'Locked' : (when ?? 'Time TBC')}</span>
    </span>
  );
}

function ActionButton({
  label,
  ariaLabel,
  onClick,
  tone = 'default',
}: {
  label: string;
  ariaLabel: string;
  onClick: () => void;
  tone?: 'default' | 'target';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`inline-flex min-h-9 min-w-16 items-center justify-center rounded-md px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar focus-visible:ring-offset-1 ${
        tone === 'target'
          ? 'bg-brand-bar text-brand-bar-foreground hover:bg-brand-bar/90'
          : 'border border-border bg-card text-foreground hover:bg-muted'
      }`}
    >
      {label}
    </button>
  );
}

function MatchupStrip({ data, leagueId }: { data: MyTeamData; leagueId: string }) {
  const team = data.team;
  const opponent = data.opponentTeam;
  if (!team) return null;
  return (
    <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <TeamMark teamName={team.teamName} logoUrl={team.logoUrl} />
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-bold leading-tight text-foreground">
            {team.teamName}
          </p>
          <p className="text-xs text-muted-foreground">
            {describeRecord(team) ?? 'No results yet'}
          </p>
        </div>
      </div>
      {opponent ? (
        <div className="flex min-w-0 items-center gap-3 sm:justify-end">
          <span className="text-xs font-semibold text-muted-foreground">vs</span>
          <div className="min-w-0 sm:text-right">
            <p className="truncate font-semibold text-foreground">{opponent.teamName}</p>
            <p className="text-xs text-muted-foreground">
              {describeRecord(opponent) ?? 'No results yet'}
            </p>
          </div>
          <TeamMark teamName={opponent.teamName} logoUrl={opponent.logoUrl} />
          <Link
            href={`/leagues/${encodeURIComponent(leagueId)}?tab=matchups`}
            className="inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-md px-2 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
          >
            Matchup
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {data.context?.lockState === 'NO_MATCHUP'
            ? 'No matchup this round'
            : 'Opponent to be confirmed'}
        </p>
      )}
    </div>
  );
}

function ReadinessRow({
  data,
  summary,
  selectedIds,
  editable,
  saveState,
  dirty,
  outOfPosition,
  firstEditableRound,
  onFill,
  canFill,
  unfillableSlots,
  onGoToRound,
}: {
  data: MyTeamData;
  summary: ReturnType<typeof summarizeLineup>;
  selectedIds: ReadonlySet<string>;
  editable: boolean;
  saveState: SaveState;
  dirty: boolean;
  outOfPosition: number;
  canFill: boolean;
  unfillableSlots: readonly string[];
  firstEditableRound: number | null;
  onFill: () => void;
  onGoToRound: (round: number) => void;
}) {
  const lockState = data.context?.lockState ?? null;
  const flagged = data.rosterPlayers.filter(
    (player) => selectedIds.has(player.playerId) && (player.bye || player.injury)
  ).length;
  const lockText = data.context?.lockAt
    ? `Locks ${formatWhen(data.context.lockAt)}`
    : data.lockPolicy === 'INDIVIDUAL_GAME_START'
      ? 'Each player locks at their game start'
      : 'Lock time to be confirmed';

  let status: ReactNode;
  if (lockState === 'LOCKED') status = <StatusDot tone="neutral" label="Locked" />;
  else if (lockState === 'NO_MATCHUP') status = <StatusDot tone="neutral" label="No matchup" />;
  else if (lockState === 'TIMING_UNAVAILABLE')
    status = <StatusDot tone="neutral" label="Read only" />;
  else if (outOfPosition > 0) {
    status = <StatusDot tone="warn" label={`${outOfPosition} out of position`} />;
  } else if (summary.emptyField > 0) {
    status = (
      <StatusDot
        tone="warn"
        label={`${summary.emptyField} empty ${summary.emptyField === 1 ? 'spot' : 'spots'}`}
      />
    );
  } else status = <StatusDot tone="good" label="Ready" />;

  const saveText = dirty
    ? 'Changes not confirmed'
    : saveState.kind === 'saved'
      ? `Confirmed ${saveState.at.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`
      : data.savedRound
        ? 'Confirmed'
        : null;

  const notes: string[] = [];
  if (lockState === 'TIMING_UNAVAILABLE') {
    notes.push(
      "Official AFL match times aren't available right now, so we can't tell which players have started. Changes are paused until they're back."
    );
  }
  if (!data.savedRound && data.defaultSource === 'CARRIED') {
    notes.push(
      `Default: your Round ${data.carriedFromRound ?? data.requestedRound - 1} team, gaps filled by position. Used automatically unless you change it.`
    );
  } else if (!data.savedRound && data.defaultSource === 'AUTO') {
    notes.push(
      'Default: picked by position from your fit players. Used automatically unless you change it.'
    );
  }
  if (unfillableSlots.length > 0) {
    notes.push(`No one fit in your squad can play ${unfillableSlots.join(' or ')}.`);
  }
  if (data.setupRequired) {
    notes.push(
      data.canManageCompetition
        ? 'Publish the competition in League Settings to add opponents, dates and lock times.'
        : 'Opponents, dates and lock times appear once the commissioner publishes the competition.'
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2">
          {status}
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <div className="flex gap-1">
              <dt className="text-muted-foreground">On field</dt>
              <dd className="font-semibold tabular-nums text-foreground">
                {summary.onField} of {summary.fieldSpots}
              </dd>
            </div>
            {summary.interchangeSpots > 0 ? (
              <div className="flex gap-1">
                <dt className="text-muted-foreground">Interchange</dt>
                <dd className="font-semibold tabular-nums text-foreground">
                  {summary.interchange} of {summary.interchangeSpots}
                </dd>
              </div>
            ) : null}
            {flagged > 0 ? (
              <div className="flex gap-1">
                <dt className="text-muted-foreground">Bye or injured</dt>
                <dd className="font-semibold tabular-nums text-result-loss">{flagged}</dd>
              </div>
            ) : null}
            <div className="flex gap-1">
              <dt className="sr-only">Lock</dt>
              <dd className="text-muted-foreground">{lockText}</dd>
            </div>
          </dl>
        </div>
        <div className="flex items-center gap-3">
          {saveText ? (
            <p
              role="status"
              className={`text-xs ${dirty ? 'font-semibold text-result-draw' : 'text-muted-foreground'}`}
            >
              {saveText}
            </p>
          ) : null}
          {editable && canFill ? (
            <button
              type="button"
              onClick={onFill}
              className="inline-flex min-h-11 items-center rounded-md bg-brand-bar px-4 text-sm font-semibold text-brand-bar-foreground hover:bg-brand-bar/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar focus-visible:ring-offset-2"
            >
              Fill empty spots
            </button>
          ) : null}
          {!editable &&
          firstEditableRound !== null &&
          firstEditableRound !== data.requestedRound ? (
            <button
              type="button"
              onClick={() => onGoToRound(firstEditableRound)}
              className="inline-flex min-h-11 items-center rounded-md bg-brand-bar px-4 text-sm font-semibold text-brand-bar-foreground hover:bg-brand-bar/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar focus-visible:ring-offset-2"
            >
              Set Round {firstEditableRound} team
            </button>
          ) : null}
        </div>
      </div>
      {notes.length > 0 ? (
        <p className="border-t border-border px-4 py-2 text-sm text-muted-foreground">
          {notes.join(' ')}
        </p>
      ) : null}
    </>
  );
}

function StatusDot({ tone, label }: { tone: 'good' | 'warn' | 'neutral'; label: string }) {
  const dot =
    tone === 'good' ? 'bg-result-win' : tone === 'warn' ? 'bg-result-draw' : 'bg-muted-foreground';
  return (
    <span className="inline-flex items-center gap-2 font-display text-lg font-bold text-foreground">
      <span aria-hidden="true" className={`size-2.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
