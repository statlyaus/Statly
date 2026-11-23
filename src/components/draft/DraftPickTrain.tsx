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
    return 'border-brand-bar bg-muted text-foreground';
  }

  if (slot.isUserPick && slot.status === 'upcoming') {
    return 'border-warning bg-muted text-foreground';
  }

  if (slot.status === 'completed') {
    return 'border-success bg-muted text-foreground';
  }

  return 'border-border bg-muted text-foreground';
}

function getSlotAccentClass(slot: DraftPickTrainSlot): string {
  if (slot.status === 'current') return 'bg-brand-bar';
  if (slot.isUserPick && slot.status === 'upcoming') {
    return 'bg-warning';
  }
  if (slot.status === 'completed') return 'bg-success';

  return 'bg-border';
}

function getStatusBadgeClasses(slot: DraftPickTrainSlot): string {
  if (slot.isUserPick && slot.status === 'upcoming') {
    return 'border-warning bg-warning/20 text-foreground';
  }

  if (slot.status === 'current') {
    return 'border-brand-bar bg-accent text-foreground';
  }

  if (slot.status === 'completed') {
    return 'border-success bg-success-soft text-foreground';
  }

  return 'border-border bg-field text-foreground';
}

function getResultPanelClasses(slot: DraftPickTrainSlot): string {
  if (slot.isUserPick && slot.status === 'upcoming') {
    return 'border-warning/50 bg-field text-foreground';
  }

  if (slot.status === 'current') {
    return 'border-brand-bar/50 bg-field text-foreground';
  }

  if (slot.status === 'completed') {
    return 'border-success/50 bg-field text-foreground';
  }

  return 'border-border bg-field text-foreground';
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
        'overflow-hidden border border-t-4 border-border border-t-brand-bar bg-card text-foreground',
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
            Draft pick train
          </p>
          <p className="mt-1 text-sm font-medium text-foreground">
            Pick {state.currentPick} of {state.totalPicks}
          </p>
        </div>
        {typeof timeLeft === 'number' && (
          <p className="shrink-0 border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
            {formatTime(timeLeft)}
          </p>
        )}
      </div>

      {/* The picks scroll sideways below xl, so the list takes focus for keyboard scrolling. */}
      <ol
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- A sideways list needs a keyboard-scroll target.
        tabIndex={0}
        className="grid auto-cols-[minmax(13.5rem,1fr)] grid-flow-col gap-3 overflow-x-auto px-4 py-4 focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-dashed focus-visible:outline-ring xl:grid-flow-row xl:grid-cols-[repeat(auto-fit,minmax(13.5rem,1fr))]"
        aria-label="Draft picks"
      >
        {state.slots.map((slot) => {
          const label = getStatusLabel(slot);
          const teamLabel = slot.teamName || slot.displayName;

          return (
            <li
              key={`${slot.round}-${slot.overall}-${slot.slot}`}
              className={cn(
                'relative flex min-h-[11rem] min-w-[13.5rem] flex-col gap-3 overflow-hidden border p-3',
                getSlotClasses(slot)
              )}
            >
              <span
                className={cn('absolute inset-x-0 top-0 h-1', getSlotAccentClass(slot))}
                aria-hidden="true"
              />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 pt-1">
                  <p className="text-[0.6875rem] font-semibold uppercase leading-5 text-muted-foreground">
                    Round {slot.round} / Pick {slot.overall}
                  </p>
                  <p className="mt-0.5 truncate text-sm font-semibold leading-5">
                    Slot {slot.slot}
                  </p>
                </div>
                <span
                  className={cn(
                    'inline-flex max-w-[8.5rem] shrink-0 items-center gap-1 rounded-cut border px-2 py-1 text-[0.6875rem] font-semibold leading-4',
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
                    'mt-auto flex min-h-14 items-center gap-3 border p-2',
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
                    'mt-auto border px-3 py-2 text-sm font-medium',
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
