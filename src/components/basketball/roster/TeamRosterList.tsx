'use client';

import { useState } from 'react';

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
  setHeldSince: (spot: BasketballRosterSpotDto, acquiredOn: string) => void;
  remove: (spot: BasketballRosterSpotDto) => void;
}

// Desktop: one row per player with aligned columns. Phone: the player, then the controls wrapped
// under him, so nothing needs sideways scrolling.
const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_9.5rem_7rem_16.5rem_5.5rem] sm:items-center';
// Quiet until hovered or focused on wide screens, so a table of inputs still reads as a list.
const QUIET_CONTROL =
  'sm:border-transparent sm:bg-transparent sm:hover:border-input sm:focus-visible:border-input';

function MoveControl({
  spot,
  destinations,
  disabled,
  onMove,
}: {
  spot: BasketballRosterSpotDto;
  destinations: RosterDestination[];
  disabled: boolean;
  onMove: (teamId: string | null) => void;
}) {
  const current = spot.teamId ?? ELSEWHERE;
  const [target, setTarget] = useState('');
  const id = `bb-move-${spot.playerId}`;
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
  onSave,
}: {
  spot: BasketballRosterSpotDto;
  disabled: boolean;
  onSave: (date: string) => void;
}) {
  const id = `bb-held-${spot.playerId}`;
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor={id}
        className="whitespace-nowrap text-xs font-semibold text-muted-foreground sm:sr-only"
      >
        <span className="sr-only">{spot.player.fullName} </span>Held since
      </label>
      <input
        // Remount when the saved date changes, so the field shows what the server holds.
        key={spot.acquiredOn}
        id={id}
        type="date"
        defaultValue={spot.acquiredOn}
        disabled={disabled}
        onBlur={(event) => {
          const value = event.currentTarget.value;
          if (!isEasternDate(value)) event.currentTarget.value = spot.acquiredOn;
          else if (value !== spot.acquiredOn) onSave(value);
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
        {spots.map((spot) => {
          const busy = busyPlayerId === spot.playerId;
          return (
            <li
              key={spot.playerId}
              aria-busy={busy || undefined}
              className={`${ROW_GRID} border-b border-border px-3 py-2.5 last:border-b-0 sm:h-14 sm:py-0`}
            >
              <PlayerIdentity
                fullName={spot.player.fullName}
                teamCode={spot.player.teamCode}
                positions={spot.player.positions}
                injury={spot.player.injury}
              />
              <div className="col-span-2 flex flex-wrap items-center gap-x-5 gap-y-2 sm:contents">
                <HeldSince
                  spot={spot}
                  disabled={disabled}
                  onSave={(date) => actions.setHeldSince(spot, date)}
                />
                <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-foreground">
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
              </div>
              <div className="col-span-2 sm:col-span-1">
                <MoveControl
                  key={spot.teamId ?? ELSEWHERE}
                  spot={spot}
                  destinations={destinations}
                  disabled={disabled}
                  onMove={(teamId) => actions.move(spot, teamId)}
                />
              </div>
              <div className="col-start-2 row-start-1 text-right sm:col-start-auto sm:row-start-auto">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => actions.remove(spot)}
                  className={buttonStyles({ variant: 'ghost', size: 'sm' })}
                >
                  {busy ? 'Saving…' : 'Remove'}
                  <span className="sr-only"> {spot.player.fullName}</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
