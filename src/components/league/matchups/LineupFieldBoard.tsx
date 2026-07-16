'use client';

import type { ActiveLineupSlot } from '@/server/leagues/scoringTypes';

import { LineupRosterPool } from './LineupRosterPool';
import { findRosterPlayer, getAssignmentForSpot } from './lineupBuilderUtils';
import type { LineupAssignment, LineupFieldSpot, LineupRosterPlayer } from './lineupBuilderTypes';

interface LineupFieldBoardProps {
  spots: readonly LineupFieldSpot[];
  interchangeSpots: readonly LineupFieldSpot[];
  assignments: readonly LineupAssignment[];
  rosterPlayers: readonly LineupRosterPlayer[];
  availablePlayers: readonly LineupRosterPlayer[];
  selectedPlayerId: string | null;
  getDragPlayerId: () => string | null;
  onSelectPlayer: (playerId: string) => void;
  setDragPlayer: (playerId: string | null) => void;
  onAssignPlayer: (playerId: string, spot: LineupFieldSpot) => void;
  onClearSpot: (spot: LineupFieldSpot) => void;
}

const SLOT_GROUP_LABELS: Record<ActiveLineupSlot, string> = {
  FWD: 'Forward line',
  MID: 'Midfield',
  RUC: 'Ruck',
  DEF: 'Defensive line',
  UTIL: 'Utility',
};

const SLOT_FIELD_BANDS: Record<ActiveLineupSlot, string> = {
  FWD: 'left-[3%] right-[3%] top-[8%] lg:left-[67.5%] lg:right-auto lg:top-[32%] lg:w-[21.5%]',
  MID: 'left-[3%] right-[3%] top-[30%] lg:left-[34%] lg:right-auto lg:top-[29%] lg:w-[32%]',
  RUC: 'left-[7%] right-[7%] top-[52%] lg:left-[40%] lg:right-auto lg:top-[64%] lg:w-[20%]',
  DEF: 'left-[3%] right-[3%] top-[66%] lg:left-[11%] lg:right-auto lg:top-[32%] lg:w-[21.5%]',
  UTIL: '',
};

const SLOT_BAND_WIDTHS: Record<ActiveLineupSlot, string> = {
  FWD: 'max-w-none',
  MID: 'max-w-none',
  RUC: 'max-w-none',
  DEF: 'max-w-none',
  UTIL: 'max-w-none',
};

const SLOT_BAND_GRIDS: Record<ActiveLineupSlot, string> = {
  FWD: 'grid-cols-2',
  MID: 'grid-cols-2 lg:grid-cols-6',
  RUC: 'grid-cols-1',
  DEF: 'grid-cols-2',
  UTIL: 'grid-cols-[repeat(auto-fit,minmax(156px,1fr))]',
};

export function LineupFieldBoard({
  spots,
  interchangeSpots,
  assignments,
  rosterPlayers,
  availablePlayers,
  selectedPlayerId,
  getDragPlayerId,
  onSelectPlayer,
  setDragPlayer,
  onAssignPlayer,
  onClearSpot,
}: LineupFieldBoardProps) {
  const groupedSpots = spots.reduce<Record<ActiveLineupSlot, LineupFieldSpot[]>>(
    (groups, spot) => {
      if (spot.slot === 'INTERCHANGE' || spot.slot === 'BENCH') return groups;
      groups[spot.slot].push(spot);
      return groups;
    },
    { FWD: [], MID: [], RUC: [], DEF: [], UTIL: [] }
  );

  return (
    <section
      className="relative overflow-hidden rounded-md border border-[color:var(--league-border)] bg-[linear-gradient(180deg,#fff7e7_0%,#efe5d1_44%,#d9dfd0_100%)] p-4 shadow-[0_28px_70px_rgba(80,65,45,0.18)]"
      aria-label="AFL field lineup builder"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,0.78),transparent_34%),radial-gradient(circle_at_82%_12%,rgba(255,247,222,0.8),transparent_34%),radial-gradient(circle_at_50%_96%,rgba(255,255,255,0.72),transparent_30%)]" />

      <div className="relative z-10">
        <div className="mb-3 inline-flex rounded-full border border-white/70 bg-white/54 px-3 py-1 text-xs font-semibold uppercase text-[color:var(--league-text)] shadow-sm backdrop-blur">
          Field builder
        </div>

        <div className="relative mx-auto w-full max-w-[2000px]">
          <div className="relative min-h-[1120px] overflow-hidden rounded-[999px] bg-[linear-gradient(115deg,rgba(20,94,47,0.28),rgba(45,128,58,0.1)_48%,rgba(6,47,26,0.42)),url('/Assets/afl-turf-texture.png')] bg-center bg-cover bg-blend-multiply shadow-[inset_0_34px_70px_rgba(255,255,255,0.12),inset_0_-42px_90px_rgba(18,66,35,0.24),0_26px_72px_rgba(88,76,55,0.28)] lg:aspect-[2.3/1] lg:min-h-[620px] xl:min-h-0">
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_50%,transparent_0,transparent_58%,rgba(12,56,31,0.3)_100%),linear-gradient(115deg,rgba(255,255,255,0.12),transparent_34%,rgba(10,50,28,0.18)_86%)]"
            />
            <div
              aria-hidden="true"
              className="absolute inset-[6%] rounded-[999px] border-[3px] border-white/88 lg:hidden"
            />
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-[6%] h-[8%] w-[20%] -translate-x-1/2 border-x-2 border-b-2 border-white/78 bg-white/5 lg:left-[6.25%] lg:top-1/2 lg:h-[9%] lg:w-[5%] lg:translate-x-0 lg:-translate-y-1/2 lg:border-y-2 lg:border-l-0 lg:border-r-2"
            />
            <div
              aria-hidden="true"
              className="absolute bottom-[6%] left-1/2 h-[8%] w-[20%] -translate-x-1/2 border-x-2 border-t-2 border-white/78 bg-white/5 lg:bottom-auto lg:left-auto lg:right-[6.25%] lg:top-1/2 lg:h-[9%] lg:w-[5%] lg:translate-x-0 lg:-translate-y-1/2 lg:border-y-2 lg:border-l-2 lg:border-r-0"
            />
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 h-[12%] w-[38%] -translate-x-1/2 -translate-y-1/2 border-2 border-white/82 bg-white/5 lg:h-[24%] lg:w-[13%]"
            />
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 h-[5.5%] w-[16%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/84 bg-white/5 lg:h-[10%] lg:w-[4.4%]"
            />
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <defs>
                <clipPath id="lineup-field-boundary">
                  <ellipse cx="50" cy="50" rx="44" ry="44" />
                </clipPath>
              </defs>
              <g clipPath="url(#lineup-field-boundary)">
                <path
                  d="M 19.4 11.5 Q 32.8 50 19.4 88.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.28"
                  strokeLinecap="square"
                  className="text-blue-200/80"
                />
                <path
                  d="M 80.6 11.5 Q 67.2 50 80.6 88.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.28"
                  strokeLinecap="square"
                  className="text-red-200/80"
                />
              </g>
              <ellipse
                cx="50"
                cy="50"
                rx="44"
                ry="44"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.34"
                className="text-white/88"
              />
            </svg>
            <div
              aria-hidden="true"
              className="absolute left-[16%] right-[16%] top-[16%] h-[10%] rounded-b-[50%] border-b-2 border-blue-200/80 lg:hidden"
            />
            <div
              aria-hidden="true"
              className="absolute bottom-[16%] left-[16%] right-[16%] h-[10%] rounded-t-[50%] border-t-2 border-red-200/80 lg:hidden"
            />
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-[2.1%] h-[7%] w-[32%] -translate-x-1/2 lg:left-0 lg:top-1/2 lg:h-[32%] lg:w-[8%] lg:translate-x-0 lg:-translate-y-1/2"
            >
              <span className="absolute left-[18%] top-0 h-full w-[2px] bg-white/88 shadow-[0_0_8px_rgba(255,255,255,0.36)] lg:left-auto lg:right-0 lg:top-[10%] lg:h-[2px] lg:w-[58%]" />
              <span className="absolute left-[39%] top-0 h-full w-[2px] bg-white/88 shadow-[0_0_8px_rgba(255,255,255,0.36)] lg:left-auto lg:right-[22%] lg:top-[36%] lg:h-[2px] lg:w-[58%]" />
              <span className="absolute right-[39%] top-0 h-full w-[2px] bg-white/88 shadow-[0_0_8px_rgba(255,255,255,0.36)] lg:bottom-[36%] lg:left-auto lg:right-[22%] lg:top-auto lg:h-[2px] lg:w-[58%]" />
              <span className="absolute right-[18%] top-0 h-full w-[2px] bg-white/88 shadow-[0_0_8px_rgba(255,255,255,0.36)] lg:bottom-[10%] lg:left-auto lg:right-0 lg:top-auto lg:h-[2px] lg:w-[58%]" />
            </div>
            <div
              aria-hidden="true"
              className="absolute bottom-[2.1%] left-1/2 h-[7%] w-[32%] -translate-x-1/2 lg:bottom-auto lg:left-auto lg:right-0 lg:top-1/2 lg:h-[32%] lg:w-[8%] lg:translate-x-0 lg:-translate-y-1/2"
            >
              <span className="absolute left-[18%] top-0 h-full w-[2px] bg-white/88 shadow-[0_0_8px_rgba(255,255,255,0.36)] lg:left-0 lg:right-auto lg:top-[10%] lg:h-[2px] lg:w-[58%]" />
              <span className="absolute left-[39%] top-0 h-full w-[2px] bg-white/88 shadow-[0_0_8px_rgba(255,255,255,0.36)] lg:left-[22%] lg:right-auto lg:top-[36%] lg:h-[2px] lg:w-[58%]" />
              <span className="absolute right-[39%] top-0 h-full w-[2px] bg-white/88 shadow-[0_0_8px_rgba(255,255,255,0.36)] lg:bottom-[36%] lg:left-[22%] lg:right-auto lg:top-auto lg:h-[2px] lg:w-[58%]" />
              <span className="absolute right-[18%] top-0 h-full w-[2px] bg-white/88 shadow-[0_0_8px_rgba(255,255,255,0.36)] lg:bottom-[10%] lg:left-0 lg:right-auto lg:top-auto lg:h-[2px] lg:w-[58%]" />
            </div>

            {Object.entries(groupedSpots).map(([slot, slotSpots]) => {
              if (slotSpots.length === 0) return null;
              const typedSlot = slot as ActiveLineupSlot;
              if (typedSlot === 'UTIL') return null;

              return (
                <div
                  key={slot}
                  className={`absolute ${SLOT_FIELD_BANDS[typedSlot]} flex justify-center`}
                >
                  <div className={`w-full ${SLOT_BAND_WIDTHS[typedSlot]}`}>
                    <div className="mb-2 text-center text-[11px] font-semibold uppercase text-white drop-shadow">
                      {SLOT_GROUP_LABELS[typedSlot]}
                    </div>
                    <div className={`grid ${SLOT_BAND_GRIDS[typedSlot]} gap-2 lg:gap-x-3`}>
                      {slotSpots.map((spot, index) => (
                        <div
                          key={spot.id}
                          className={`min-w-0 ${
                            typedSlot === 'MID'
                              ? `lg:col-span-2 ${index === 3 ? 'lg:col-start-2' : ''} ${
                                  index === slotSpots.length - 1
                                    ? 'col-span-2 mx-auto w-full max-w-60 lg:mx-0 lg:max-w-none'
                                    : ''
                                }`
                              : ''
                          }`}
                        >
                          <LineupFieldSpotButton
                            spot={spot}
                            assignment={getAssignmentForSpot(assignments, spot)}
                            rosterPlayers={rosterPlayers}
                            selectedPlayerId={selectedPlayerId}
                            getDragPlayerId={getDragPlayerId}
                            onAssignPlayer={onAssignPlayer}
                            onClearSpot={onClearSpot}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pointer-events-none absolute -bottom-10 left-[6%] right-[6%] h-24 rounded-[50%] bg-white/44 blur-2xl" />
        </div>

        <section
          aria-label="Lineup sideline"
          className="relative mx-auto mt-7 max-w-[1500px] overflow-hidden rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface)]/72 shadow-[0_20px_46px_rgba(80,65,45,0.16)] backdrop-blur"
        >
          <div className="flex items-center justify-between gap-4 border-b border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)]/80 px-5 py-3">
            <h2 className="text-sm font-semibold uppercase text-[color:var(--league-text)]">
              Sideline
            </h2>
            <span className="rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-2.5 py-1 text-[10px] font-semibold uppercase text-[color:var(--league-text-muted)]">
              Match day
            </span>
          </div>

          <div className="grid items-start gap-5 p-4 lg:grid-cols-[minmax(240px,0.8fr)_minmax(260px,0.9fr)_minmax(420px,2fr)] lg:gap-0 lg:p-5">
            <section aria-labelledby="utility-heading" className="min-w-0 space-y-3 lg:pr-5">
              <div className="flex items-center justify-between gap-3 px-1">
                <h3
                  id="utility-heading"
                  className="text-xs font-semibold uppercase text-[color:var(--league-text)]"
                >
                  {SLOT_GROUP_LABELS.UTIL}
                </h3>
                <span className="text-[10px] font-semibold uppercase text-[color:var(--league-text-muted)]">
                  Scoring
                </span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3 lg:grid-cols-1">
                {groupedSpots.UTIL.map((spot) => (
                  <LineupFieldSpotButton
                    key={spot.id}
                    spot={spot}
                    assignment={getAssignmentForSpot(assignments, spot)}
                    rosterPlayers={rosterPlayers}
                    selectedPlayerId={selectedPlayerId}
                    getDragPlayerId={getDragPlayerId}
                    onAssignPlayer={onAssignPlayer}
                    onClearSpot={onClearSpot}
                  />
                ))}
              </div>
            </section>

            <section
              aria-labelledby="interchange-heading"
              className="min-w-0 space-y-3 border-t border-[color:var(--league-border)] pt-5 lg:border-l lg:border-t-0 lg:px-5 lg:pt-0"
            >
              <div className="flex items-center justify-between gap-3 px-1">
                <h3
                  id="interchange-heading"
                  className="text-xs font-semibold uppercase text-[color:var(--league-text)]"
                >
                  Interchange
                </h3>
                <span className="text-[10px] font-semibold uppercase text-[color:var(--league-text-muted)]">
                  Bench
                </span>
              </div>
              {interchangeSpots.length ? (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3 lg:grid-cols-1">
                  {interchangeSpots.map((spot) => (
                    <LineupFieldSpotButton
                      key={spot.id}
                      spot={spot}
                      assignment={getAssignmentForSpot(assignments, spot)}
                      rosterPlayers={rosterPlayers}
                      selectedPlayerId={selectedPlayerId}
                      getDragPlayerId={getDragPlayerId}
                      onAssignPlayer={onAssignPlayer}
                      onClearSpot={onClearSpot}
                      variant="interchange"
                    />
                  ))}
                </div>
              ) : (
                <p className="px-1 text-sm text-[color:var(--league-text-muted)]">
                  No interchange slots configured.
                </p>
              )}
            </section>

            <div className="min-w-0 border-t border-[color:var(--league-border)] pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
              <LineupRosterPool
                players={availablePlayers}
                selectedPlayerId={selectedPlayerId}
                onSelectPlayer={onSelectPlayer}
                setDragPlayer={setDragPlayer}
                variant="stadium"
                embedded
              />
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

interface LineupFieldSpotButtonProps {
  spot: LineupFieldSpot;
  assignment: LineupAssignment | undefined;
  rosterPlayers: readonly LineupRosterPlayer[];
  selectedPlayerId: string | null;
  getDragPlayerId: () => string | null;
  onAssignPlayer: (playerId: string, spot: LineupFieldSpot) => void;
  onClearSpot: (spot: LineupFieldSpot) => void;
  variant?: 'field' | 'interchange';
}

function LineupFieldSpotButton({
  spot,
  assignment,
  rosterPlayers,
  selectedPlayerId,
  getDragPlayerId,
  onAssignPlayer,
  onClearSpot,
  variant = 'field',
}: LineupFieldSpotButtonProps) {
  const assignedPlayer = findRosterPlayer(rosterPlayers, assignment?.playerId);
  const isLocked = Boolean(assignment?.lockedAt);
  const canPlaceSelectedPlayer = Boolean(selectedPlayerId);
  const isInterchange = variant === 'interchange';
  const spotStatus = assignedPlayer
    ? [assignedPlayer.position || 'AFL', assignedPlayer.club].filter(Boolean).join(' · ')
    : selectedPlayerId
      ? 'Ready'
      : isLocked
        ? 'Locked'
        : 'Available';

  function assignSelectedPlayer() {
    if (!selectedPlayerId) return;
    onAssignPlayer(selectedPlayerId, spot);
  }

  return (
    <div
      onDragOver={(event) => {
        if (isLocked) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (isLocked) return;
        const playerId = event.dataTransfer.getData('text/plain') || getDragPlayerId();
        if (playerId) onAssignPlayer(playerId, spot);
      }}
      className={`group relative min-h-14 rounded-full border px-2.5 py-2 shadow-[0_10px_24px_rgba(54,64,40,0.22)] backdrop-blur transition sm:min-h-16 sm:px-3.5 sm:py-2.5 ${
        assignedPlayer
          ? 'border-white/85 bg-[color:var(--league-surface)]/96 hover:-translate-y-0.5'
          : isInterchange
            ? 'border-[color:var(--league-border)] bg-[color:var(--league-text)]/88 hover:-translate-y-0.5 hover:bg-[color:var(--league-text)]'
            : 'border-dashed border-white/76 bg-white/24 hover:bg-white/34'
      } ${selectedPlayerId && !isLocked ? 'ring-2 ring-white/80' : ''}`}
    >
      <button
        type="button"
        onClick={assignSelectedPlayer}
        disabled={isLocked}
        aria-disabled={!canPlaceSelectedPlayer || isLocked}
        aria-label={`${spot.label}, ${spotStatus}. Assign selected player to this slot.`}
        className="flex min-h-10 w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:cursor-not-allowed sm:min-h-11 sm:gap-2.5"
      >
        <span
          className={`flex shrink-0 items-center justify-center font-bold uppercase ${
            isInterchange
              ? 'h-9 min-w-16 rounded-md px-2 text-[9px]'
              : 'h-8 w-8 rounded-full text-[10px] sm:h-9 sm:w-9'
          } ${
            assignedPlayer
              ? 'bg-[color:var(--league-primary)] text-[color:var(--league-primary-foreground)]'
              : isInterchange
                ? 'bg-[color:var(--league-surface)] text-[color:var(--league-text)]'
                : 'bg-white/28 text-white'
          }`}
        >
          {isInterchange ? `Bench ${spot.slotIndex + 1}` : spot.slot}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block whitespace-normal break-normal text-xs font-semibold leading-tight sm:text-sm ${
              assignedPlayer ? 'text-[color:var(--league-text)]' : 'text-white'
            }`}
          >
            {assignedPlayer?.name ?? spot.label}
          </span>
          <span
            className={`mt-0.5 block truncate text-[10px] ${
              assignedPlayer
                ? 'text-[color:var(--league-text-muted)]'
                : isInterchange
                  ? 'text-white/90'
                  : 'text-white/85'
            }`}
          >
            {spotStatus}
          </span>
        </span>
      </button>
      {assignedPlayer && !isLocked ? (
        <button
          type="button"
          onClick={() => onClearSpot(spot)}
          className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface)] text-xs font-semibold text-[color:var(--league-text-muted)] opacity-0 shadow-sm transition hover:text-[color:var(--league-text)] focus:opacity-100 group-hover:opacity-100"
          aria-label={`Clear ${assignedPlayer.name} from ${spot.label}`}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
