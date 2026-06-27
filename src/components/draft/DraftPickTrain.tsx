import Image from 'next/image';
import type { ReactElement } from 'react';
import { CheckCircle, Circle, Clock } from 'lucide-react';

import { getTeamLogo } from '@/lib/teamLogos';
import { cn } from '@/lib/utils';
import type { DraftPickTrainState, DraftPickTrainSlot } from '@/lib/mappers/draftUiMappers';

type DraftPickTrainProps = {
  state: DraftPickTrainState;
  timeLeft?: number;
  className?: string;
};

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function getStatusLabel(slot: DraftPickTrainSlot): string {
  if (slot.status === 'current') return 'On the clock';
  if (slot.isUserPick && slot.status === 'upcoming') return 'Your next pick';
  if (slot.status === 'completed') return 'Completed';

  return 'Upcoming';
}

function getSlotClasses(slot: DraftPickTrainSlot): string {
  if (slot.status === 'current') {
    return 'border-[color:var(--draft-broadcast-red)] bg-[color:var(--draft-broadcast-panel-strong)] text-[color:var(--draft-broadcast-text)] shadow-[0_0_22px_var(--draft-broadcast-red-glow)] ring-1 ring-[color:var(--draft-broadcast-red)]/40';
  }

  if (slot.isUserPick && slot.status === 'upcoming') {
    return 'border-[color:var(--draft-broadcast-yellow)] bg-[color:var(--draft-broadcast-panel-strong)] text-[color:var(--draft-broadcast-text)] shadow-[0_0_14px_var(--draft-broadcast-yellow-glow)] ring-1 ring-[color:var(--draft-broadcast-yellow)]/35';
  }

  if (slot.status === 'completed') {
    return 'border-[color:var(--draft-broadcast-green)] bg-[color:var(--draft-broadcast-panel-strong)] text-[color:var(--draft-broadcast-text)]';
  }

  return 'border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-panel-strong)] text-[color:var(--draft-broadcast-text)]';
}

function getSlotAccentClass(slot: DraftPickTrainSlot): string {
  if (slot.status === 'current') return 'bg-[color:var(--draft-broadcast-red)]';
  if (slot.isUserPick && slot.status === 'upcoming') {
    return 'bg-[color:var(--draft-broadcast-yellow)]';
  }
  if (slot.status === 'completed') return 'bg-[color:var(--draft-broadcast-green)]';

  return 'bg-[color:var(--draft-broadcast-border)]';
}

function getStatusBadgeClasses(slot: DraftPickTrainSlot): string {
  if (slot.isUserPick && slot.status === 'upcoming') {
    return 'border-[color:var(--draft-broadcast-yellow)] bg-[color:var(--draft-broadcast-yellow-soft)] text-[color:var(--draft-broadcast-text)]';
  }

  if (slot.status === 'current') {
    return 'border-[color:var(--draft-broadcast-red)] bg-[color:var(--draft-broadcast-red-soft)] text-[color:var(--draft-broadcast-text)]';
  }

  if (slot.status === 'completed') {
    return 'border-[color:var(--draft-broadcast-green)] bg-[color:var(--draft-broadcast-green-soft)] text-[color:var(--draft-broadcast-text)]';
  }

  return 'border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-field)] text-[color:var(--draft-broadcast-text)]';
}

function getResultPanelClasses(slot: DraftPickTrainSlot): string {
  if (slot.isUserPick && slot.status === 'upcoming') {
    return 'border-[color:var(--draft-broadcast-yellow)]/50 bg-[color:var(--draft-broadcast-field)] text-[color:var(--draft-broadcast-text)]';
  }

  if (slot.status === 'current') {
    return 'border-[color:var(--draft-broadcast-red)]/50 bg-[color:var(--draft-broadcast-field)] text-[color:var(--draft-broadcast-text)]';
  }

  if (slot.status === 'completed') {
    return 'border-[color:var(--draft-broadcast-green)]/50 bg-[color:var(--draft-broadcast-field)] text-[color:var(--draft-broadcast-text)]';
  }

  return 'border-[color:var(--draft-broadcast-border-soft)] bg-[color:var(--draft-broadcast-field)] text-[color:var(--draft-broadcast-text)]';
}

function StatusIcon({ slot }: { slot: DraftPickTrainSlot }) {
  if (slot.status === 'completed') {
    return <CheckCircle className="size-4" aria-hidden="true" />;
  }

  if (slot.status === 'current') {
    return <Clock className="size-4" aria-hidden="true" />;
  }

  return <Circle className="size-4" aria-hidden="true" />;
}

export default function DraftPickTrain({
  state,
  timeLeft,
  className,
}: DraftPickTrainProps): ReactElement {
  return (
    // The task contract requires this section to explicitly expose role="region".
    // eslint-disable-next-line jsx-a11y/no-redundant-roles
    <section
      role="region"
      aria-label="Draft pick train"
      className={cn(
        'overflow-hidden rounded-lg border border-t-4 border-[color:var(--draft-broadcast-border)] border-t-[color:var(--draft-broadcast-red)] bg-[color:var(--draft-broadcast-panel)] text-[color:var(--draft-broadcast-text)] shadow-[0_22px_70px_-48px_var(--draft-broadcast-shadow-deep)]',
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--draft-broadcast-border)] px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-normal text-[color:var(--draft-broadcast-muted)]">
            Draft pick train
          </p>
          <p className="mt-1 text-sm font-medium text-[color:var(--draft-broadcast-text)]">
            Pick {state.currentPick} of {state.totalPicks}
          </p>
        </div>
        {typeof timeLeft === 'number' && (
          <p className="shrink-0 rounded-md border border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-panel-strong)] px-2 py-1 text-xs font-medium text-[color:var(--draft-broadcast-muted)]">
            {formatTime(timeLeft)}
          </p>
        )}
      </div>

      <ol
        className="grid auto-cols-[minmax(13.5rem,1fr)] grid-flow-col gap-3 overflow-x-auto px-4 py-4 xl:grid-flow-row xl:grid-cols-[repeat(auto-fit,minmax(13.5rem,1fr))]"
        aria-label="Draft picks"
      >
        {state.slots.map((slot) => {
          const label = getStatusLabel(slot);
          const teamLabel = slot.teamName || slot.displayName;

          return (
            <li
              key={`${slot.round}-${slot.overall}-${slot.slot}`}
              className={cn(
                'relative flex min-h-[11rem] min-w-[13.5rem] flex-col gap-3 overflow-hidden rounded-lg border p-3',
                getSlotClasses(slot)
              )}
            >
              <span
                className={cn('absolute inset-x-0 top-0 h-1', getSlotAccentClass(slot))}
                aria-hidden="true"
              />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 pt-1">
                  <p className="text-[0.6875rem] font-semibold uppercase leading-5 text-[color:var(--draft-broadcast-muted)]">
                    Round {slot.round} / Pick {slot.overall}
                  </p>
                  <p className="mt-0.5 truncate text-sm font-semibold leading-5">
                    Slot {slot.slot}
                  </p>
                </div>
                <span
                  className={cn(
                    'inline-flex max-w-[8.5rem] shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[0.6875rem] font-semibold leading-4 backdrop-blur',
                    getStatusBadgeClasses(slot)
                  )}
                >
                  <StatusIcon slot={slot} />
                  <span className="truncate">{label}</span>
                </span>
              </div>

              <div className="min-w-0">
                <p className="truncate text-base font-semibold leading-6">{teamLabel}</p>
                {slot.teamName && slot.teamName !== slot.displayName && (
                  <p className="mt-1 truncate text-sm opacity-80">{slot.displayName}</p>
                )}
              </div>

              {slot.player ? (
                <div
                  className={cn(
                    'mt-auto flex min-h-14 items-center gap-3 rounded-md border p-2 backdrop-blur',
                    getResultPanelClasses(slot)
                  )}
                >
                  <Image
                    src={getTeamLogo(slot.player.club)}
                    alt=""
                    width={32}
                    height={32}
                    aria-hidden="true"
                    className="size-8 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{slot.player.name}</p>
                    <p className="mt-0.5 truncate text-xs opacity-75">
                      {slot.player.position} / {slot.player.club}
                    </p>
                  </div>
                </div>
              ) : (
                <p
                  className={cn(
                    'mt-auto rounded-md border px-3 py-2 text-sm font-medium backdrop-blur',
                    getResultPanelClasses(slot)
                  )}
                >
                  Selection pending
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
