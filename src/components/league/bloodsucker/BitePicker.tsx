'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';

import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { formatLeagueTime } from '@/lib/leagueTime';

import {
  biteStatusLabel,
  formatCountdown,
  SLOT_GROUP_LABELS,
  type BiteStatus,
  type SlotGroup,
} from './bloodsuckerDisplay';

export interface BitePickerPlayerView {
  id: string;
  name: string;
  position: string;
  club: string;
  group: SlotGroup;
  z: number | null;
}

export interface BitePickerView {
  biteId: string;
  round: number;
  status: BiteStatus;
  version: number;
  deadlineAt: string;
  serverNow: string;
  victim: { memberId: string; teamName: string };
  score: string;
  victimPlayers: BitePickerPlayerView[];
  returnPlayers: BitePickerPlayerView[];
  autoBitePreview: { takenPlayerId: string; returnedPlayerId: string } | null;
  blocked: { code: string; message: string } | null;
  takenPlayerId: string | null;
  returnedPlayerId: string | null;
}

type Command =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'failed'; code: string; message: string }
  | { status: 'saved'; taken: string; returned: string };

const GROUP_ORDER: SlotGroup[] = ['DEF', 'MID', 'RUC', 'FWD', 'UTIL', 'NON_SCORING'];

function PlayerGroups({
  legend,
  hint,
  name,
  players,
  selected,
  onSelect,
  disabledReasonId,
  disabled,
}: {
  legend: string;
  hint: string;
  name: string;
  players: BitePickerPlayerView[];
  selected: string | null;
  onSelect: (id: string) => void;
  disabledReasonId?: string;
  disabled: boolean;
}) {
  const hintId = `${name}-hint`;
  return (
    <fieldset
      className="min-w-0 rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4"
      aria-describedby={[hintId, disabled ? disabledReasonId : null].filter(Boolean).join(' ')}
    >
      <legend className="px-1 text-base font-semibold">{legend}</legend>
      <p id={hintId} className="text-sm text-[color:var(--league-text-muted)]">
        {hint}
      </p>
      {players.length === 0 ? (
        <p className="mt-3 text-sm">No players on this roster.</p>
      ) : (
        GROUP_ORDER.map((group) => {
          const inGroup = players.filter((player) => player.group === group);
          if (inGroup.length === 0) return null;
          return (
            <div key={group} className="mt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--league-text-muted)]">
                {SLOT_GROUP_LABELS[group]}
              </h3>
              <ul className="mt-1 grid gap-1">
                {inGroup.map((player) => (
                  <li key={player.id}>
                    <label
                      className={`flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 text-sm ${
                        selected === player.id
                          ? 'border-[color:var(--league-danger)] bg-[color:var(--league-danger-soft)]'
                          : 'border-[color:var(--league-border)]'
                      } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                    >
                      <input
                        type="radio"
                        name={name}
                        value={player.id}
                        checked={selected === player.id}
                        onChange={() => onSelect(player.id)}
                        disabled={disabled}
                        className="h-4 w-4 shrink-0 accent-[color:var(--league-danger)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{player.name}</span>
                        <span className="block text-xs text-[color:var(--league-text-muted)]">
                          {[player.position, player.club].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-[color:var(--league-text-muted)]">
                        {player.z === null ? 'No stats' : `Z ${player.z.toFixed(2)}`}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </fieldset>
  );
}

/**
 * The Bloodsucker's bite picker (US-6, NFR-5, NFR-8). Native radio groups give keyboard and screen
 * reader support; the countdown is words; success shows only after the server commits the swap.
 */
export function BitePicker({
  leagueId,
  userId,
  timeZone,
  initial,
}: {
  leagueId: string;
  userId?: string;
  timeZone?: string;
  initial: BitePickerView;
}) {
  const [picker, setPicker] = useState(initial);
  const [taken, setTaken] = useState<string | null>(null);
  const [returned, setReturned] = useState<string | null>(null);
  const [command, setCommand] = useState<Command>({ status: 'idle' });
  const [clockOffsetMs] = useState(() => Date.parse(initial.serverNow) - Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const endpoint = `/api/leagues/${encodeURIComponent(leagueId)}/bites/${encodeURIComponent(picker.biteId)}`;

  useEffect(() => {
    const tick = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(tick);
  }, []);

  const open = picker.status === 'OPEN' || picker.status === 'WAITING_LOCK';
  const blocked = open ? picker.blocked : null;
  const disabled = !open || blocked !== null || command.status === 'saving';
  const nameOf = (id: string | null) =>
    [...picker.victimPlayers, ...picker.returnPlayers].find((player) => player.id === id)?.name ??
    'a player';
  const deadline = new Date(picker.deadlineAt);
  const remaining = deadline.getTime() - (nowMs + clockOffsetMs);

  const reload = async () => {
    const response = await authenticatedFetch(endpoint, { cache: 'no-store' }, userId);
    if (response.ok) setPicker((await response.json()) as BitePickerView);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!taken || !returned) {
      setCommand({
        status: 'failed',
        code: 'INVALID_INPUT',
        message: 'Choose one player to take and one player to send back.',
      });
      return;
    }
    setCommand({ status: 'saving' });
    try {
      const response = await authenticatedFetch(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ takenPlayerId: taken, returnedPlayerId: returned }),
        },
        userId
      );
      const body = (await response.json().catch(() => ({}))) as { code?: string; error?: string };
      if (!response.ok) {
        setCommand({
          status: 'failed',
          code: body.code ?? `HTTP_${response.status}`,
          message: body.error ?? 'The bite did not save.',
        });
        await reload().catch(() => undefined);
        return;
      }
      setCommand({ status: 'saved', taken: nameOf(taken), returned: nameOf(returned) });
      await reload().catch(() => undefined);
    } catch {
      setCommand({
        status: 'failed',
        code: 'NETWORK_ERROR',
        message: 'The bite could not reach the server. Refresh to see whether it saved.',
      });
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 text-[color:var(--league-text)] sm:px-6">
      <Link
        href={`/leagues/${encodeURIComponent(leagueId)}`}
        className="text-sm font-medium underline underline-offset-2"
      >
        Back to the league
      </Link>
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-danger)]">
          Round {picker.round} bite
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          You beat {picker.victim.teamName} {picker.score}
        </h1>
        <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
          Take one player from {picker.victim.teamName} and send one of yours back. The player you
          send back takes your pick&apos;s place in their lineup, and your pick takes his in yours.
        </p>
      </header>

      {open ? (
        <section
          aria-labelledby="bite-deadline-title"
          className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 text-sm"
        >
          <h2 id="bite-deadline-title" className="font-semibold">
            Deadline:{' '}
            <time dateTime={picker.deadlineAt}>{formatLeagueTime(deadline, timeZone)}</time>
          </h2>
          <p className="mt-1">
            {remaining > 0
              ? `Time left: ${formatCountdown(remaining)}.`
              : 'The deadline has passed. The system makes the pick within 5 minutes.'}
          </p>
          {picker.autoBitePreview ? (
            <p className="mt-1 text-[color:var(--league-text-muted)]">
              If you do not choose by then, the system takes{' '}
              <strong>{nameOf(picker.autoBitePreview.takenPlayerId)}</strong> (their highest Statly
              Z) and sends back <strong>{nameOf(picker.autoBitePreview.returnedPlayerId)}</strong>{' '}
              (your lowest).
            </p>
          ) : null}
        </section>
      ) : (
        <section
          role="status"
          className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 text-sm"
        >
          <p className="font-semibold">{biteStatusLabel(picker.status)}.</p>
          {picker.takenPlayerId && picker.returnedPlayerId ? (
            <p className="mt-1">
              You took {nameOf(picker.takenPlayerId)} and sent back{' '}
              {nameOf(picker.returnedPlayerId)}.
            </p>
          ) : null}
        </section>
      )}

      {blocked ? (
        <p
          id="bite-blocked-reason"
          role="status"
          className="rounded-md border border-[color:var(--league-warning)] bg-[color:var(--league-warning-soft)] p-3 text-sm"
        >
          <span className="font-semibold">Players are locked ({blocked.code}).</span>{' '}
          {blocked.message}
        </p>
      ) : null}

      <form
        onSubmit={(event) => void submit(event)}
        className="space-y-4"
        aria-busy={command.status === 'saving'}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <PlayerGroups
            legend={`Take from ${picker.victim.teamName}`}
            hint="Any player on their roster. Grouped by where each sat in their scored lineup."
            name="taken-player"
            players={picker.victimPlayers}
            selected={open ? taken : picker.takenPlayerId}
            onSelect={setTaken}
            disabled={disabled}
            disabledReasonId={blocked ? 'bite-blocked-reason' : undefined}
          />
          <PlayerGroups
            legend="Send back one of yours"
            hint="Any player on your roster can go back. Grouped by where each sat in your scored lineup."
            name="returned-player"
            players={picker.returnPlayers}
            selected={open ? returned : picker.returnedPlayerId}
            onSelect={setReturned}
            disabled={disabled}
            disabledReasonId={blocked ? 'bite-blocked-reason' : undefined}
          />
        </div>

        {open ? (
          <div className="sticky bottom-0 -mx-4 border-t border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0">
            <button
              type="submit"
              disabled={disabled}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[color:var(--league-danger)] px-5 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-text)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {command.status === 'saving'
                ? 'Saving the bite…'
                : taken && returned
                  ? `Take ${nameOf(taken)}, send back ${nameOf(returned)}`
                  : 'Make the bite'}
            </button>
          </div>
        ) : null}
      </form>

      <div aria-live="polite">
        {command.status === 'saved' ? (
          <p className="rounded-md border border-[color:var(--league-success)] bg-[color:var(--league-success-soft)] p-3 text-sm font-medium">
            Done. You took {command.taken} and sent back {command.returned}.
          </p>
        ) : null}
      </div>
      {command.status === 'failed' ? (
        <p
          role="alert"
          className="rounded-md border border-[color:var(--league-danger)] bg-[color:var(--league-danger-soft)] p-3 text-sm"
        >
          <span className="font-semibold">The bite did not save ({command.code}).</span>{' '}
          {command.message}
        </p>
      ) : null}
    </div>
  );
}
