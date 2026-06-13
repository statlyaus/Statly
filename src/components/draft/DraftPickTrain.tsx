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
    return 'border-primary bg-primary text-primary-foreground shadow-sm';
  }

  if (slot.isUserPick && slot.status === 'upcoming') {
    return 'border-primary bg-accent text-accent-foreground';
  }

  return 'border-border bg-background text-foreground';
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
        'overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm',
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
          <p className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
            {formatTime(timeLeft)}
          </p>
        )}
      </div>

      <ol className="flex gap-3 overflow-x-auto px-4 py-4" aria-label="Draft picks">
        {state.slots.map((slot) => {
          const label = getStatusLabel(slot);
          const teamLabel = slot.teamName || slot.displayName;

          return (
            <li
              key={`${slot.round}-${slot.overall}-${slot.slot}`}
              className={cn(
                'flex min-w-[13rem] flex-col gap-3 rounded-lg border p-3',
                getSlotClasses(slot)
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-normal opacity-80">
                    Round {slot.round} / Pick {slot.overall}
                  </p>
                  <p className="mt-1 truncate text-sm font-semibold">Slot {slot.slot}</p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 bg-background/80 px-2 py-1 text-xs font-medium text-foreground">
                  <StatusIcon slot={slot} />
                  {label}
                </span>
              </div>

              <div className="min-w-0">
                <p className="truncate text-base font-semibold">{teamLabel}</p>
                {slot.teamName && slot.teamName !== slot.displayName && (
                  <p className="mt-1 truncate text-sm text-muted-foreground">{slot.displayName}</p>
                )}
              </div>

              {slot.player ? (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-2 text-card-foreground">
                  <Image
                    src={getTeamLogo(slot.player.club)}
                    alt=""
                    width={32}
                    height={32}
                    aria-hidden="true"
                    className="size-8 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {slot.player.name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {slot.player.position} / {slot.player.club}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
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
