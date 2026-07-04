'use client';

import type { ActiveLineupSlot } from '@/server/leagues/scoringTypes';

import { LineupRosterPool } from './LineupRosterPool';
import { findRosterPlayer, getAssignmentForSpot } from './lineupBuilderUtils';
import type { LineupAssignment, LineupFieldSpot, LineupRosterPlayer } from './lineupBuilderTypes';

interface LineupFieldBoardProps {
  spots: readonly LineupFieldSpot[];
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
  UTIL: 'Interchange',
};

const SLOT_FIELD_BANDS: Record<ActiveLineupSlot, string> = {
  FWD: 'left-[9%] right-[9%] top-[10%] lg:left-[69%] lg:right-auto lg:top-[33%] lg:w-[25%]',
  MID: 'left-[7%] right-[7%] top-[32%] lg:left-[34%] lg:right-auto lg:top-[31%] lg:w-[32%]',
  RUC: 'left-[14%] right-[14%] top-[50%] lg:left-[42%] lg:right-auto lg:top-[52%] lg:w-[16%]',
  DEF: 'left-[7%] right-[7%] top-[64%] lg:left-[6%] lg:right-auto lg:top-[33%] lg:w-[25%]',
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
  MID: 'grid-cols-[repeat(auto-fit,minmax(104px,1fr))]',
  RUC: 'grid-cols-1',
  DEF: 'grid-cols-2',
  UTIL: 'grid-cols-[repeat(auto-fit,minmax(156px,1fr))]',
};

export function LineupFieldBoard({
  spots,
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

        <div className="relative mx-auto max-w-[1480px]">
          <div className="relative min-h-[1120px] overflow-hidden rounded-[999px] border border-white/80 bg-[radial-gradient(ellipse_at_center,rgba(150,205,97,0.3)_0,rgba(52,122,55,0.1)_52%,rgba(15,63,35,0.3)_100%),linear-gradient(0deg,rgba(83,169,75,0.92)_50%,rgba(66,150,68,0.92)_50%)] bg-[length:100%_100%,100%_92px] shadow-[inset_0_30px_70px_rgba(255,255,255,0.18),inset_0_-36px_80px_rgba(23,70,35,0.24),0_26px_72px_rgba(88,76,55,0.28)] lg:aspect-[2.35/1] lg:min-h-[560px] lg:bg-[linear-gradient(90deg,rgba(83,169,75,0.92)_50%,rgba(66,150,68,0.92)_50%)] lg:bg-[length:100%_100%,92px_100%]">
            <div className="absolute inset-[2.2%] rounded-[999px] border-[3px] border-white/85" />
            <div className="absolute left-0 top-1/2 w-full border-t border-white/55 lg:left-1/2 lg:top-0 lg:h-full lg:w-auto lg:border-l lg:border-t-0" />
            <div className="absolute left-1/2 top-[6%] h-[10%] w-[42%] -translate-x-1/2 border-x-2 border-b-2 border-white/72 lg:left-[9%] lg:top-1/2 lg:h-[40%] lg:w-[12%] lg:translate-x-0 lg:-translate-y-1/2 lg:border-y-2 lg:border-l-0 lg:border-r-2" />
            <div className="absolute bottom-[6%] left-1/2 h-[10%] w-[42%] -translate-x-1/2 border-x-2 border-t-2 border-white/72 lg:bottom-auto lg:left-auto lg:right-[9%] lg:top-1/2 lg:h-[40%] lg:w-[12%] lg:translate-x-0 lg:-translate-y-1/2 lg:border-y-2 lg:border-l-2 lg:border-r-0" />
            <div className="absolute left-1/2 top-1/2 h-[12%] w-[38%] -translate-x-1/2 -translate-y-1/2 border-2 border-white/76 bg-white/5 lg:h-[22%] lg:w-[12%]" />
            <div className="absolute left-1/2 top-1/2 h-[5%] w-[16%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/76 bg-white/5 lg:h-[9%] lg:w-[4%]" />
            <div className="absolute left-[14%] right-[14%] top-[18%] h-[9%] rounded-b-[50%] border-b-2 border-blue-200/95 lg:bottom-[14%] lg:left-[17%] lg:right-auto lg:top-[14%] lg:h-auto lg:w-[10%] lg:rounded-b-none lg:rounded-r-[50%] lg:border-b-0 lg:border-r-2" />
            <div className="absolute bottom-[18%] left-[14%] right-[14%] h-[9%] rounded-t-[50%] border-t-2 border-red-200/95 lg:bottom-[14%] lg:left-auto lg:right-[17%] lg:top-[14%] lg:h-auto lg:w-[10%] lg:rounded-l-[50%] lg:rounded-t-none lg:border-l-2 lg:border-t-0" />
            <div className="absolute left-1/2 top-[3.8%] h-[5%] -translate-x-1/2 border-l-2 border-white/90 lg:left-[4.5%] lg:top-1/2 lg:h-[28%] lg:translate-x-0 lg:-translate-y-1/2" />
            <div className="absolute bottom-[3.8%] left-1/2 h-[5%] -translate-x-1/2 border-l-2 border-white/90 lg:bottom-auto lg:left-auto lg:right-[4.5%] lg:top-1/2 lg:h-[28%] lg:translate-x-0 lg:-translate-y-1/2" />
            <div className="absolute left-1/2 top-[3%] h-[5%] w-[1px] -translate-x-1/2 bg-white/80 lg:left-[3%] lg:top-1/2 lg:h-[1px] lg:w-[5%] lg:translate-x-0" />
            <div className="absolute bottom-[3%] left-1/2 h-[5%] w-[1px] -translate-x-1/2 bg-white/80 lg:bottom-auto lg:left-auto lg:right-[3%] lg:top-1/2 lg:h-[1px] lg:w-[5%] lg:translate-x-0" />

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
                    <div className={`grid ${SLOT_BAND_GRIDS[typedSlot]} gap-2`}>
                      {slotSpots.map((spot) => (
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
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pointer-events-none absolute -bottom-10 left-[6%] right-[6%] h-24 rounded-[50%] bg-white/44 blur-2xl" />
        </div>

        <div className="relative mx-auto mt-8 grid max-w-[1260px] items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-7">
          <div className="min-w-0 space-y-3">
            <div className="px-2 text-center text-[11px] font-semibold uppercase text-[color:var(--league-text)] lg:text-left">
              {SLOT_GROUP_LABELS.UTIL}
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(156px,1fr))] gap-3 lg:grid-cols-1">
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
          </div>
          <div className="min-w-0">
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
}

function LineupFieldSpotButton({
  spot,
  assignment,
  rosterPlayers,
  selectedPlayerId,
  getDragPlayerId,
  onAssignPlayer,
  onClearSpot,
}: LineupFieldSpotButtonProps) {
  const assignedPlayer = findRosterPlayer(rosterPlayers, assignment?.playerId);
  const isLocked = Boolean(assignment?.lockedAt);
  const canPlaceSelectedPlayer = Boolean(selectedPlayerId);

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
      className={`group relative min-h-14 rounded-full border px-3 py-2 shadow-[0_10px_24px_rgba(54,64,40,0.22)] backdrop-blur transition ${
        assignedPlayer
          ? 'border-white/85 bg-[color:var(--league-surface)]/96 hover:-translate-y-0.5'
          : 'border-dashed border-white/76 bg-white/24 hover:bg-white/34'
      } ${selectedPlayerId && !isLocked ? 'ring-2 ring-white/80' : ''}`}
    >
      <button
        type="button"
        onClick={assignSelectedPlayer}
        disabled={!canPlaceSelectedPlayer || isLocked}
        aria-label={`Assign selected player to ${spot.label}`}
        className="flex min-h-10 w-full items-center gap-2 text-left disabled:cursor-not-allowed"
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase ${
            assignedPlayer
              ? 'bg-[color:var(--league-primary)] text-[color:var(--league-primary-foreground)]'
              : 'bg-white/28 text-white'
          }`}
        >
          {spot.slot}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-xs font-semibold ${
              assignedPlayer ? 'text-[color:var(--league-text)]' : 'text-white'
            }`}
          >
            {assignedPlayer?.name ?? spot.label}
          </span>
          <span
            className={`mt-0.5 block truncate text-[10px] ${
              assignedPlayer ? 'text-[color:var(--league-text-muted)]' : 'text-white/85'
            }`}
          >
            {assignedPlayer
              ? [assignedPlayer.position || 'AFL', assignedPlayer.club].filter(Boolean).join(' · ')
              : selectedPlayerId
                ? 'Ready'
                : isLocked
                  ? 'Locked'
                  : 'Available'}
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
