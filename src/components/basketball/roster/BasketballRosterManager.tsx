'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { badgeStyles, buttonStyles, fieldStyles } from '@/components/ui/controlStyles';
import type { FantasyWeekRange } from '@/lib/basketball/fantasyWeeks';
import type {
  BasketballLeagueDetail,
  BasketballRosterSpotDto,
  NbaPlayerSearchResult,
} from '@/server/basketball/leagues/basketballLeagueDto';

import { callBasketballApi } from '../shell/basketballApi';
import {
  basketballLeagueHref,
  formatEasternDate,
  formatWeekLabel,
} from '../shell/basketballFormat';
import { OpponentPicker } from './OpponentPicker';
import { PasteImport } from './PasteImport';
import { PlayerSearchAdd } from './PlayerSearchAdd';
import {
  ELSEWHERE,
  TeamRosterList,
  type RosterActions,
  type RosterDestination,
} from './TeamRosterList';

/** A confirmed change, with an Undo for a removal. */
interface Notice {
  message: string;
  undo?: { label: string; run: () => void };
}

interface RunCommand {
  playerId: string | null;
  url: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  success: string;
  /** Element to focus afterwards, when the control used has gone (a moved or removed player). */
  focusAfter?: string;
  undo?: Notice['undo'];
}

interface TeamGroup {
  key: string;
  teamId: string | null;
  name: string;
  tag: string | null;
  spots: BasketballRosterSpotDto[];
}

/**
 * The Roster page: this week's opponent, adding players by search or paste, and every team's
 * players with move, injured-list, held-since and remove controls. One change runs at a time; the
 * page shows what the server saved (each command returns the league read back after commit).
 */
export function BasketballRosterManager({
  initialLeague,
  week,
}: {
  initialLeague: BasketballLeagueDetail;
  week: FantasyWeekRange;
}) {
  const router = useRouter();
  const targetId = useId();
  const [league, setLeague] = useState(initialLeague);
  const [busy, setBusy] = useState<{ playerId: string | null } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<string>(initialLeague.myTeamId);

  const base = `/api/basketball/leagues/${encodeURIComponent(league.id)}`;
  const opponentTeamId =
    league.matchups.find(
      (matchup) => matchup.week === week.week && matchup.teamId === league.myTeamId
    )?.opponentTeamId ?? null;
  const teamName = (teamId: string | null) =>
    teamId === null
      ? 'Rostered elsewhere'
      : (league.teams.find((team) => team.id === teamId)?.name ?? 'Unknown team');

  const groups: TeamGroup[] = [
    ...[...league.teams]
      .sort(
        (left, right) =>
          Number(right.isMine) - Number(left.isMine) ||
          Number(right.id === opponentTeamId) - Number(left.id === opponentTeamId) ||
          left.sortOrder - right.sortOrder
      )
      .map((team) => ({
        key: team.id,
        teamId: team.id,
        name: team.name,
        tag: team.isMine ? 'Your team' : team.id === opponentTeamId ? "This week's opponent" : null,
        spots: league.rosterSpots.filter((spot) => spot.teamId === team.id),
      })),
    {
      key: ELSEWHERE,
      teamId: null,
      name: 'Rostered elsewhere',
      tag: null,
      spots: league.rosterSpots.filter((spot) => spot.teamId === null),
    },
  ];
  const destinations: RosterDestination[] = groups.map((group) => ({
    value: group.teamId ?? ELSEWHERE,
    label: group.teamId === null ? 'Rostered elsewhere' : group.name,
  }));
  const targetTeamId = target === ELSEWHERE ? null : target;
  const targetLabel = teamName(targetTeamId);

  /** Runs one command; on success shows the league the server read back. Returns an error or null. */
  async function run(command: RunCommand): Promise<string | null> {
    setBusy({ playerId: command.playerId });
    setError(null);
    setNotice(null);
    const result = await callBasketballApi<BasketballLeagueDetail>(
      command.url,
      command.method,
      command.body
    );
    setBusy(null);
    if (!result.ok) {
      const details = Object.values(result.fieldErrors).flat();
      const message = details.length > 0 ? details.join(' ') : result.message;
      setError(message);
      return message;
    }
    setLeague(result.data);
    setNotice({ message: command.success, undo: command.undo });
    router.refresh();
    const { focusAfter } = command;
    if (focusAfter) requestAnimationFrame(() => document.getElementById(focusAfter)?.focus());
    return null;
  }

  const spotUrl = (spot: BasketballRosterSpotDto) =>
    `${base}/roster/${encodeURIComponent(spot.playerId)}`;
  const headingId = (key: string) => `bb-roster-${key}`;
  const disabled = busy !== null;
  const name = (spot: BasketballRosterSpotDto) => spot.player.fullName;

  const actions: RosterActions = {
    move: (spot, teamId) =>
      void run({
        playerId: spot.playerId,
        url: spotUrl(spot),
        method: 'PATCH',
        body: { teamId },
        success: `Moved ${name(spot)} to ${teamName(teamId)}.`,
        focusAfter: headingId(spot.teamId ?? ELSEWHERE),
      }),
    setInjuredList: (spot, onInjuredList) =>
      void run({
        playerId: spot.playerId,
        url: spotUrl(spot),
        method: 'PATCH',
        body: { onInjuredList },
        success: `${name(spot)} is ${onInjuredList ? 'on' : 'off'} the injured list.`,
      }),
    setHeldSince: async (spot, acquiredOn) =>
      (await run({
        playerId: spot.playerId,
        url: spotUrl(spot),
        method: 'PATCH',
        body: { acquiredOn },
        success: `${name(spot)} counts from ${formatEasternDate(acquiredOn)}.`,
      })) === null,
    remove: (spot) =>
      void run({
        playerId: spot.playerId,
        url: spotUrl(spot),
        method: 'DELETE',
        success: `Removed ${name(spot)} from ${teamName(spot.teamId)}.`,
        focusAfter: headingId(spot.teamId ?? ELSEWHERE),
        // Puts him back exactly as he was: same team, injured-list flag and held-since date.
        undo: {
          label: `Undo removing ${name(spot)}`,
          run: () =>
            void run({
              playerId: spot.playerId,
              url: `${base}/roster`,
              method: 'POST',
              body: {
                entries: [
                  {
                    playerId: spot.playerId,
                    teamId: spot.teamId,
                    onInjuredList: spot.onInjuredList,
                    acquiredOn: spot.acquiredOn,
                  },
                ],
              },
              success: `Put ${name(spot)} back on ${teamName(spot.teamId)}.`,
            }),
        },
      }),
  };

  async function addFromSearch(player: NbaPlayerSearchResult): Promise<boolean> {
    const message = await run({
      playerId: player.id,
      url: `${base}/roster`,
      method: 'POST',
      body: { entries: [{ playerId: player.id, teamId: targetTeamId }] },
      success: `Added ${player.fullName} to ${targetLabel}.`,
    });
    return message === null;
  }

  async function addFromPaste(playerIds: string[]): Promise<string | null> {
    return run({
      playerId: null,
      url: `${base}/roster`,
      method: 'POST',
      body: { entries: playerIds.map((playerId) => ({ playerId, teamId: targetTeamId })) },
      success: `Added ${playerIds.length} ${playerIds.length === 1 ? 'player' : 'players'} to ${targetLabel}.`,
    });
  }

  function saveOpponent(teamId: string | null) {
    const url = `${base}/matchups/${week.week}`;
    void (teamId
      ? run({
          playerId: null,
          url,
          method: 'PUT',
          body: { opponentTeamId: teamId },
          success: `${teamName(teamId)} is your opponent for week ${week.week}.`,
        })
      : run({
          playerId: null,
          url,
          method: 'DELETE',
          success: `Cleared your opponent for week ${week.week}.`,
        }));
  }

  const rosteredOn = (playerId: string) => {
    const spot = league.rosterSpots.find((candidate) => candidate.playerId === playerId);
    return spot ? teamName(spot.teamId) : null;
  };

  return (
    <div className="flex flex-col gap-6">
      <div aria-live="polite" className="empty:hidden">
        {notice ? (
          <div className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-result-win/30 bg-result-win/5 px-3 py-1.5">
            <p className="text-sm font-medium text-foreground">{notice.message}</p>
            {notice.undo ? (
              <button
                type="button"
                onClick={notice.undo.run}
                disabled={disabled}
                aria-label={notice.undo.label}
                className={buttonStyles({ variant: 'outline', size: 'sm', className: 'shrink-0' })}
              >
                Undo
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm font-medium text-foreground"
        >
          {error}
        </p>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <section
          id="opponent"
          aria-labelledby="bb-opponent-title"
          className="rounded-lg border border-border bg-card p-4"
        >
          <h2
            id="bb-opponent-title"
            className="mb-3 font-display text-lg font-bold text-foreground"
          >
            This week&apos;s opponent
          </h2>
          <OpponentPicker
            key={opponentTeamId ?? 'none'}
            weekLabel={formatWeekLabel(week)}
            opponentTeamId={opponentTeamId}
            teams={league.teams.filter((team) => !team.isMine)}
            settingsHref={basketballLeagueHref(league.id, 'settings')}
            disabled={disabled}
            onSave={saveOpponent}
          />
        </section>

        <section
          aria-labelledby="bb-add-title"
          className="rounded-lg border border-border bg-card p-4"
        >
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h2 id="bb-add-title" className="font-display text-lg font-bold text-foreground">
              Add players
            </h2>
            <div className="flex items-center gap-2">
              <label
                htmlFor={targetId}
                className="whitespace-nowrap text-sm font-semibold text-foreground"
              >
                Add to
              </label>
              <select
                id={targetId}
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                className={fieldStyles({ size: 'sm', className: 'w-48 pr-7' })}
              >
                {destinations.map((destination) => (
                  <option key={destination.value} value={destination.value}>
                    {destination.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <PlayerSearchAdd
            targetLabel={targetLabel}
            rosteredOn={rosteredOn}
            disabled={disabled}
            onAdd={addFromSearch}
          />
          <details className="group mt-2 rounded-md border border-border">
            <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Paste a roster instead
            </summary>
            <div className="border-t border-border p-3">
              <PasteImport
                leagueId={league.id}
                targetTeamId={targetTeamId}
                targetLabel={targetLabel}
                disabled={disabled}
                onConfirm={addFromPaste}
              />
            </div>
          </details>
        </section>
      </div>

      {groups.map((group) =>
        group.teamId === null && group.spots.length === 0 ? null : (
          <section
            key={group.key}
            aria-labelledby={headingId(group.key)}
            className="flex flex-col gap-2"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2
                id={headingId(group.key)}
                tabIndex={-1}
                className="font-display text-lg font-bold text-foreground outline-none"
              >
                {group.name}
              </h2>
              {group.tag ? (
                <span
                  className={badgeStyles({
                    tone: group.tag === 'Your team' ? 'brand' : 'neutral',
                    size: 'xs',
                  })}
                >
                  {group.tag}
                </span>
              ) : null}
              <span className="text-sm tabular-nums text-muted-foreground">
                {group.spots.length} {group.spots.length === 1 ? 'player' : 'players'}
              </span>
            </div>
            {group.teamId === null ? (
              <p className="text-xs text-muted-foreground">
                Players on teams you haven&apos;t entered. They are left out of free agents.
              </p>
            ) : null}
            {group.spots.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                No players yet. Choose &ldquo;{group.name}&rdquo; under Add to, then search or
                paste.
              </p>
            ) : (
              <TeamRosterList
                label={group.name}
                spots={group.spots}
                destinations={destinations}
                busyPlayerId={busy?.playerId ?? null}
                disabled={disabled}
                actions={actions}
              />
            )}
          </section>
        )
      )}
    </div>
  );
}
