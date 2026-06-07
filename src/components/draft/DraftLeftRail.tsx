'use client';

import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';

export type DraftLeftRailMode = 'roster' | 'queue' | 'watchlist';

export type DraftLeftRailRosterSlot = {
  id: string;
  label: string;
  position?: string;
  player?: {
    id: string;
    name: string;
    club: string;
    position: string;
  };
};

export type DraftLeftRailProps = {
  draftStatus: string;
  storageKey: string;
  rosterSlots: DraftLeftRailRosterSlot[];
  queueCount: number;
  watchlistCount: number;
  queuePanel: ReactNode;
  watchlistPanel: ReactNode;
  className?: string;
};

type TabConfig = {
  mode: DraftLeftRailMode;
  label: string;
  count?: number;
};

const PRE_DRAFT_STATUSES = new Set(['SCHEDULED', 'LOBBY', 'COUNTDOWN']);
const VALID_MODES = new Set<DraftLeftRailMode>(['roster', 'queue', 'watchlist']);

const tabs: TabConfig[] = [
  { mode: 'roster', label: 'Roster' },
  { mode: 'queue', label: 'Queue' },
  { mode: 'watchlist', label: 'Watchlist' },
];

function getDefaultMode(draftStatus: string): DraftLeftRailMode {
  return PRE_DRAFT_STATUSES.has(draftStatus.toUpperCase()) ? 'queue' : 'roster';
}

function readStoredMode(storageKey: string): DraftLeftRailMode | null {
  try {
    const storedMode = window.sessionStorage.getItem(storageKey);

    return VALID_MODES.has(storedMode as DraftLeftRailMode)
      ? (storedMode as DraftLeftRailMode)
      : null;
  } catch {
    return null;
  }
}

function writeStoredMode(storageKey: string, mode: DraftLeftRailMode): void {
  try {
    window.sessionStorage.setItem(storageKey, mode);
  } catch {
    // Local state remains the source of truth when sessionStorage is unavailable.
  }
}

function getTabCount(tab: TabConfig, queueCount: number, watchlistCount: number): number | null {
  if (tab.mode === 'queue') return queueCount;
  if (tab.mode === 'watchlist') return watchlistCount;

  return null;
}

function RosterPanel({ rosterSlots }: { rosterSlots: DraftLeftRailRosterSlot[] }): ReactElement {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label="Roster slots">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">Roster</h2>
        <p className="text-xs text-muted-foreground">
          {rosterSlots.filter((slot) => slot.player).length} / {rosterSlots.length} filled
        </p>
      </div>

      {rosterSlots.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
          No roster slots available.
        </p>
      ) : (
        <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto" aria-label="Roster">
          {rosterSlots.map((slot) => (
            <li
              key={slot.id}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{slot.label}</p>
                  {slot.position && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {slot.position}
                    </p>
                  )}
                </div>
                {!slot.player && (
                  <span className="shrink-0 rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                    Empty slot
                  </span>
                )}
              </div>

              {slot.player ? (
                <div className="mt-2 min-w-0">
                  <p className="truncate font-semibold text-foreground">{slot.player.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {slot.player.position} / {slot.player.club}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">Awaiting selection</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ScrollPanel({ children }: { children: ReactNode }): ReactElement {
  return <div className="min-h-0 flex-1 overflow-y-auto pr-1">{children}</div>;
}

export default function DraftLeftRail({
  draftStatus,
  storageKey,
  rosterSlots,
  queueCount,
  watchlistCount,
  queuePanel,
  watchlistPanel,
  className,
}: DraftLeftRailProps): ReactElement {
  const [manualMode, setManualMode] = useState<DraftLeftRailMode | null>(null);
  const defaultMode = getDefaultMode(draftStatus);
  const activeMode = manualMode ?? defaultMode;
  const activePanelId = `draft-left-rail-${activeMode}-panel`;

  useEffect(() => {
    setManualMode(readStoredMode(storageKey));
  }, [storageKey]);

  const tabLabels = useMemo(
    () =>
      tabs.map((tab) => ({
        ...tab,
        count: getTabCount(tab, queueCount, watchlistCount),
      })),
    [queueCount, watchlistCount]
  );

  function selectMode(mode: DraftLeftRailMode): void {
    setManualMode(mode);
    writeStoredMode(storageKey, mode);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    const activeIndex = tabs.findIndex((tab) => tab.mode === activeMode);
    let nextIndex = activeIndex;

    if (event.key === 'ArrowRight') {
      nextIndex = (activeIndex + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (activeIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();

    const nextMode = tabs[nextIndex].mode;
    selectMode(nextMode);
    window.requestAnimationFrame(() => {
      document.getElementById(`draft-left-rail-${nextMode}-tab`)?.focus();
    });
  }

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground',
        className
      )}
      aria-label="Draft side panel"
    >
      <div
        role="tablist"
        aria-label="Draft side panel views"
        className="grid shrink-0 grid-cols-3 gap-1 border-b border-border bg-muted/30 p-1"
      >
        {tabLabels.map((tab) => {
          const isActive = tab.mode === activeMode;

          return (
            <button
              key={tab.mode}
              id={`draft-left-rail-${tab.mode}-tab`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`draft-left-rail-${tab.mode}-panel`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => selectMode(tab.mode)}
              onKeyDown={handleTabKeyDown}
              className={cn(
                'inline-flex min-w-0 items-center justify-center gap-1 rounded-md px-2 py-2 text-xs font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                isActive && 'bg-background text-foreground shadow-sm'
              )}
            >
              <span className="truncate">{tab.label}</span>
              {typeof tab.count === 'number' && (
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[0.6875rem] font-semibold text-muted-foreground">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div
        id={activePanelId}
        role="tabpanel"
        aria-labelledby={`draft-left-rail-${activeMode}-tab`}
        className="flex min-h-0 flex-1 flex-col overflow-hidden p-3"
      >
        {activeMode === 'roster' && <RosterPanel rosterSlots={rosterSlots} />}
        {activeMode === 'queue' && <ScrollPanel>{queuePanel}</ScrollPanel>}
        {activeMode === 'watchlist' && <ScrollPanel>{watchlistPanel}</ScrollPanel>}
      </div>
    </aside>
  );
}
