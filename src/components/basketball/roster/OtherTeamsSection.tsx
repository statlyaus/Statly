'use client';

import { useState } from 'react';

import { useConfirmDialog } from '@/components/ui/ConfirmDialog';
import { buttonStyles } from '@/components/ui/controlStyles';
import type { BasketballRosterSpotDto } from '@/server/basketball/leagues/basketballLeagueDto';

import { OTHER_TEAMS_ANCHOR } from '../shell/TakenPlayersNotice';
import { PasteImport } from './PasteImport';
import { TeamRosterList, type RosterActions, type RosterDestination } from './TeamRosterList';

const plural = (count: number) => `${count} ${count === 1 ? 'player' : 'players'}`;

/**
 * "Players on other teams": a whole league's rosters pasted at once and marked as taken (rostered
 * by a team the user has not entered), so Pickups only suggests real free agents. Shows how many
 * are marked, lists them behind a disclosure, and clears them all after a confirmation.
 */
export function OtherTeamsSection({
  leagueId,
  headingId,
  spots,
  destinations,
  busyPlayerId,
  disabled,
  actions,
  onPasteConfirm,
  onClear,
}: {
  leagueId: string;
  /** Focus target after a taken player is moved or removed. */
  headingId: string;
  /** The players marked as taken. */
  spots: BasketballRosterSpotDto[];
  destinations: RosterDestination[];
  busyPlayerId: string | null;
  disabled: boolean;
  actions: RosterActions;
  onPasteConfirm: (playerIds: string[]) => Promise<string | null>;
  onClear: () => void;
}) {
  const { confirm, dialog } = useConfirmDialog();
  const [showList, setShowList] = useState(false);
  const count = spots.length;

  async function clear() {
    const confirmed = await confirm({
      title: 'Clear all taken players?',
      description: `Removes the ${plural(count)} marked as taken. Players on your team, your opponent and any other team you entered stay. Pickups will count the cleared players as free agents again.`,
      confirmLabel: 'Clear taken players',
      tone: 'danger',
    });
    if (confirmed) onClear();
  }

  return (
    <section
      id={OTHER_TEAMS_ANCHOR}
      aria-labelledby={headingId}
      className="flex scroll-mt-24 flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2
          id={headingId}
          tabIndex={-1}
          className="font-display text-lg font-bold text-foreground outline-none"
        >
          Players on other teams
        </h2>
        <span className="text-sm tabular-nums text-muted-foreground">
          {plural(count)} marked as taken
        </span>
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Paste every rostered player in your league &ndash; for example from Yahoo&rsquo;s League
        &rsaquo; Rosters page or ESPN&rsquo;s League &rsaquo; Rosters. Statly marks them as taken so
        Pickups only suggests real free agents. Players already on a team you entered, like yours
        and your opponent&rsquo;s, are left alone.
      </p>

      <PasteImport
        leagueId={leagueId}
        targetTeamId={null}
        targetLabel="Rostered elsewhere"
        disabled={disabled}
        onConfirm={onPasteConfirm}
        compact
        label="Paste your league's rosters"
        help="Select the whole page and paste it. Team names, headings and stats are ignored."
      />

      {count > 0 ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <details
            open={showList}
            onToggle={(event) => setShowList(event.currentTarget.open)}
            className="rounded-md border border-border"
          >
            <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Show the {plural(count)} marked as taken
            </summary>
            {/* Rendered only when open: a whole league is a long list of controls. */}
            {showList ? (
              <div className="border-t border-border p-2">
                <TeamRosterList
                  label="Taken players"
                  spots={spots}
                  destinations={destinations}
                  busyPlayerId={busyPlayerId}
                  disabled={disabled}
                  actions={actions}
                />
              </div>
            ) : null}
          </details>
          <div>
            <button
              type="button"
              onClick={() => void clear()}
              disabled={disabled}
              className={buttonStyles({ variant: 'outline' })}
            >
              Clear all taken players
            </button>
          </div>
        </div>
      ) : null}
      {dialog}
    </section>
  );
}
