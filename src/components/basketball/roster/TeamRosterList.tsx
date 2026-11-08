'use client';

import { ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';

import { buttonStyles, fieldStyles } from '@/components/ui/controlStyles';
import { isEasternDate } from '@/lib/basketball/fantasyWeeks';
import { cn } from '@/lib/utils';
import type { BasketballRosterSpotDto } from '@/server/basketball/leagues/basketballLeagueDto';

import { PlayerIdentity } from '../shell/PlayerIdentity';

export const ELSEWHERE = 'elsewhere';

export interface RosterDestination {
  /** A team id, or ELSEWHERE for "rostered by a team not entered". */
  value: string;
  label: string;
}

export interface RosterActions {
  move: (spot: BasketballRosterSpotDto, teamId: string | null) => void;
  setInjuredList: (spot: BasketballRosterSpotDto, onInjuredList: boolean) => void;
  /** Resolves true when saved; false leaves the stored date in place. */
  setHeldSince: (spot: BasketballRosterSpotDto, acquiredOn: string) => Promise<boolean>;
  remove: (spot: BasketballRosterSpotDto) => void;
}

// Wide screens: one row per player with aligned columns. Phones: the player with IL and Remove
// beside him, and held-since and move behind a per-player Edit disclosure, so the list reads as a
// roster rather than a form. The two edit controls are rendered once per layout (`variant`).
const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_9.5rem_7rem_16.5rem_5.5rem] sm:items-center';
// Quiet until hovered or focused on wide screens, so a table of inputs still reads as a list.
const QUIET_CONTROL =
  'sm:border-transparent sm:bg-transparent sm:hover:border-input sm:focus-visible:border-input';

type Variant = 'wide' | 'phone';

function MoveControl({
  spot,
  destinations,
  disabled,
  variant,
  onMove,
}: {
  spot: BasketballRosterSpotDto;
  destinations: RosterDestination[];
  disabled: boolean;
  variant: Variant;
  onMove: (teamId: string | null) => void;
}) {
  const current = spot.teamId ?? ELSEWHERE;
  const [target, setTarget] = useState('');
  const id = `bb-move-${variant}-${spot.playerId}`;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <label className="sr-only" htmlFor={id}>
        Move {spot.player.fullName} to
      </label>
      <select
        id={id}
        value={target}
        onChange={(event) => setTarget(event.target.value)}
        disabled={disabled}
        className={fieldStyles({ size: 'sm', className: cn('min-w-0 flex-1 pr-7', QUIET_CONTROL) })}
      >
        <option value="">Move to…</option>
        {destinations
          .filter((destination) => destination.value !== current)
          .map((destination) => (
            <option key={destination.value} value={destination.value}>
              {destination.label}
            </option>
          ))}
      </select>
      {target ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onMove(target === ELSEWHERE ? null : target)}
          className={buttonStyles({ variant: 'primary', size: 'sm' })}
        >
          Move
          <span className="sr-only"> {spot.player.fullName}</span>
        </button>
      ) : null}
    </div>
  );
}

function HeldSince({
  spot,
  disabled,
  variant,
  onSave,
}: {
  spot: BasketballRosterSpotDto;
  disabled: boolean;
  variant: Variant;
  onSave: (date: string) => Promise<boolean>;
}) {
  const id = `bb-held-${variant}-${spot.playerId}`;
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor={id}
        className="whitespace-nowrap text-xs font-semibold text-muted-foreground sm:sr-only"
      >
        <span className="sr-only">{spot.player.fullName} </span>Held since
      </label>
      <input
        ref={input}
        // Remount when the saved date changes, so the field shows what the server holds.
        key={spot.acquiredOn}
        id={id}
        type="date"
        defaultValue={spot.acquiredOn}
        disabled={disabled}
        onBlur={async (event) => {
          const value = event.currentTarget.value;
          if (!isEasternDate(value)) {
            event.currentTarget.value = spot.acquiredOn;
          } else if (value !== spot.acquiredOn && !(await onSave(value)) && input.current) {
            // Not saved: show the stored date again rather than one the server refused.
            input.current.value = spot.acquiredOn;
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        className={fieldStyles({
          size: 'sm',
          className: cn('w-36 px-2 tabular-nums', QUIET_CONTROL),
        })}
      />
    </div>
  );
}

function RosterRow({
  spot,
  destinations,
  busy,
  disabled,
  actions,
}: {
  spot: BasketballRosterSpotDto;
  destinations: RosterDestination[];
  busy: boolean;
  disabled: boolean;
  actions: RosterActions;
}) {
  const [editing, setEditing] = useState(false);
  const panelId = `bb-edit-${spot.playerId}`;
  const heldSince = (variant: Variant) => (
    <HeldSince
      spot={spot}
      disabled={disabled}
      variant={variant}
      onSave={(date) => actions.setHeldSince(spot, date)}
    />
  );
  const move = (variant: Variant) => (
    <MoveControl
      key={spot.teamId ?? ELSEWHERE}
      spot={spot}
      destinations={destinations}
      disabled={disabled}
      variant={variant}
      onMove={(teamId) => actions.move(spot, teamId)}
    />
  );

  return (
    <li
      aria-busy={busy || undefined}
      className={`${ROW_GRID} border-b border-border px-3 py-2 last:border-b-0 sm:h-14 sm:py-0`}
    >
      <PlayerIdentity
        fullName={spot.player.fullName}
        teamCode={spot.player.teamCode}
        positions={spot.player.positions}
        injury={spot.player.injury}
        className="sm:order-1"
      />
      <div className="hidden sm:order-2 sm:block">{heldSince('wide')}</div>
      <div className="hidden sm:order-4 sm:block">{move('wide')}</div>
      <div className="flex items-center gap-1 sm:contents">
        <label className="flex min-h-9 cursor-pointer items-center gap-1.5 px-1 text-sm text-foreground sm:order-3">
          <input
            type="checkbox"
            checked={spot.onInjuredList}
            disabled={disabled}
            onChange={(event) => actions.setInjuredList(spot, event.target.checked)}
            className="size-4 accent-brand-bar"
          />
          <span>
            <span className="sr-only">{spot.player.fullName} </span>
            IL
          </span>
        </label>
        <button
          type="button"
          aria-expanded={editing}
          aria-controls={panelId}
          onClick={() => setEditing((open) => !open)}
          className={buttonStyles({ variant: 'ghost', size: 'sm', className: 'px-2 sm:hidden' })}
        >
          Edit
          <span className="sr-only"> {spot.player.fullName}</span>
          <ChevronDown
            aria-hidden="true"
            className={`size-4 transition-transform motion-reduce:transition-none ${editing ? 'rotate-180' : ''}`}
          />
        </button>
        <div className="text-right sm:order-5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => actions.remove(spot)}
            className={buttonStyles({ variant: 'ghost', size: 'sm', className: 'px-2 sm:px-3' })}
          >
            {busy ? 'Saving…' : 'Remove'}
            <span className="sr-only"> {spot.player.fullName}</span>
          </button>
        </div>
      </div>
      <div
        id={panelId}
        hidden={!editing}
        className="col-span-2 flex flex-col gap-2 rounded-md bg-muted/40 p-2 sm:hidden"
      >
        {heldSince('phone')}
        {move('phone')}
      </div>
    </li>
  );
}

/** One team's players with their roster controls. */
export function TeamRosterList({
  label,
  spots,
  destinations,
  busyPlayerId,
  disabled,
  actions,
}: {
  label: string;
  spots: BasketballRosterSpotDto[];
  destinations: RosterDestination[];
  busyPlayerId: string | null;
  disabled: boolean;
  actions: RosterActions;
}) {
  return (
    <div
      role="region"
      aria-label={`${label} roster`}
      className="rounded-lg border border-border bg-card"
    >
      <div
        aria-hidden="true"
        className={`${ROW_GRID} hidden border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground sm:grid`}
      >
        <span>Player</span>
        <span className="pl-2">Held since</span>
        <span>Injured list</span>
        <span className="pl-2">Move</span>
        <span />
      </div>
      <ul>
        {spots.map((spot) => (
          <RosterRow
            key={spot.playerId}
            spot={spot}
            destinations={destinations}
            busy={busyPlayerId === spot.playerId}
            disabled={disabled}
            actions={actions}
          />
        ))}
      </ul>
    </div>
  );
}
