'use client';

import { useId, useRef, useState } from 'react';

import Link from 'next/link';

import { authenticatedFetch } from '@/lib/authenticatedFetch';
import type { BiteCommissionerAction } from '@/server/leagues/biteCommissionerActions';

import {
  biteStatusLabel,
  readRefusal,
  refusalHeading,
  type BiteStatus,
  type Refusal,
} from './bloodsuckerDisplay';

export interface BiteReviewPlayerView {
  id: string;
  name: string;
  position: string;
  club: string;
}

export interface BiteReviewView {
  biteId: string;
  round: number;
  status: BiteStatus;
  bloodsucker: { memberId: string; teamName: string };
  victim: { memberId: string; teamName: string };
  takenPlayer: { id: string; name: string } | null;
  returnedPlayer: { id: string; name: string } | null;
  cancelledReason: string | null;
  actions: BiteCommissionerAction[];
  refusal: Refusal | null;
  victimPlayers: BiteReviewPlayerView[];
  returnPlayers: BiteReviewPlayerView[];
}

type Command =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'failed'; refusal: Refusal }
  | { status: 'saved'; action: BiteCommissionerAction };

const REASON_MAX = 500;
const FIELD =
  'mt-1 w-full rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-3 py-2 text-base text-[color:var(--league-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-text)]';
const CARD =
  'rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 text-sm';

const invalid = (message: string): Command => ({
  status: 'failed',
  refusal: { code: 'INVALID_INPUT', message },
});

/**
 * The commissioner's cancel and redo control for one bite (BR-35, E1, NFR-5, NFR-8). A plain form:
 * native radios, selects and a labelled reason, so it works with the keyboard and a screen reader
 * and reflows at 375 px. The server decides; this shows every refusal with its code and message,
 * and success only after the commit.
 */
export function BiteCommissionerPanel({
  leagueId,
  userId,
  initial,
}: {
  leagueId: string;
  userId?: string;
  initial: BiteReviewView;
}) {
  const [review, setReview] = useState(initial);
  const [action, setAction] = useState<BiteCommissionerAction>(initial.actions[0] ?? 'cancel');
  const [reason, setReason] = useState('');
  const [taken, setTaken] = useState('');
  const [returned, setReturned] = useState('');
  const [command, setCommand] = useState<Command>({ status: 'idle' });
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const takenRef = useRef<HTMLSelectElement>(null);
  const ids = useId();
  const endpoint = `/api/leagues/${encodeURIComponent(leagueId)}/bites/${encodeURIComponent(review.biteId)}/commissioner`;

  const chosen = review.actions.includes(action) ? action : (review.actions[0] ?? 'cancel');
  const executed = review.status === 'EXECUTED' || review.status === 'AUTO_EXECUTED';
  const saving = command.status === 'saving';
  const failedCode = command.status === 'failed' ? command.refusal.code : null;
  const reasonInvalid = failedCode === 'INVALID_INPUT' && !reason.trim();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setCommand(invalid('Give a reason. It is posted to league activity and kept in the audit.'));
      reasonRef.current?.focus();
      return;
    }
    if (chosen === 'redo' && (!taken || !returned)) {
      setCommand(invalid('Choose one player to take and one to send back.'));
      takenRef.current?.focus();
      return;
    }
    setCommand({ status: 'saving' });
    try {
      const response = await authenticatedFetch(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: chosen,
            reason: trimmed,
            ...(chosen === 'redo' ? { takenPlayerId: taken, returnedPlayerId: returned } : {}),
          }),
        },
        userId
      );
      if (!response.ok) {
        const refusal = readRefusal(
          await response.json().catch(() => null),
          response.status,
          'The server did not say why.'
        );
        setCommand({ status: 'failed', refusal });
      } else {
        setCommand({ status: 'saved', action: chosen });
        setReason('');
        setTaken('');
        setReturned('');
      }
    } catch {
      setCommand({
        status: 'failed',
        refusal: { code: 'NETWORK_ERROR', message: 'Refresh to see whether it saved.' },
      });
      return;
    }
    // Saved or refused, the bite may have changed: show what the server holds now.
    try {
      const fresh = await authenticatedFetch(endpoint, { cache: 'no-store' }, userId);
      if (fresh.ok) setReview((await fresh.json()) as BiteReviewView);
    } catch {
      // The command's own outcome is already shown; the next load reads the bite again.
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 text-[color:var(--league-text)] sm:px-6">
      <Link
        href={`/leagues/${encodeURIComponent(leagueId)}`}
        className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-2"
      >
        Back to the league
      </Link>
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-danger)]">
          Round {review.round} bite · commissioner
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {review.bloodsucker.teamName}&apos;s bite on {review.victim.teamName}
        </h1>
      </header>

      <section aria-label="Where this bite stands" className={CARD}>
        <p className="font-semibold">{biteStatusLabel(review.status)}.</p>
        {executed ? (
          <p className="mt-1">
            {review.bloodsucker.teamName} took {review.takenPlayer?.name} and sent back{' '}
            {review.returnedPlayer?.name}.
          </p>
        ) : null}
        {review.cancelledReason ? (
          <p className="mt-1 text-[color:var(--league-text-muted)]">
            Reason given: {review.cancelledReason}
          </p>
        ) : null}
      </section>

      {review.refusal && review.actions.length === 0 ? (
        <p
          role="status"
          className="rounded-md border border-[color:var(--league-warning)] bg-[color:var(--league-warning-soft)] p-3 text-sm"
        >
          <span className="font-semibold">
            {refusalHeading(review.refusal.code)} ({review.refusal.code}).
          </span>{' '}
          {review.refusal.message}
        </p>
      ) : null}

      {review.actions.length > 0 ? (
        <form
          onSubmit={(event) => void submit(event)}
          noValidate
          aria-busy={saving}
          className={`${CARD} space-y-4`}
        >
          {review.actions.length > 1 ? (
            <fieldset disabled={saving} className="min-w-0">
              <legend className="text-base font-semibold">What to do</legend>
              <div className="mt-2 grid gap-2">
                {review.actions.map((option) => (
                  <label
                    key={option}
                    className={`grid min-h-11 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 rounded-md border px-3 py-2 ${
                      chosen === option
                        ? 'border-[color:var(--league-danger)] bg-[color:var(--league-danger-soft)]'
                        : 'border-[color:var(--league-border)]'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`${ids}-action`}
                      value={option}
                      checked={chosen === option}
                      onChange={() => setAction(option)}
                      className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--league-danger)]"
                    />
                    <span className="font-medium">
                      {option === 'cancel' ? 'Cancel the bite' : 'Redo it with different players'}
                    </span>
                    <span className="col-start-2 text-[color:var(--league-text-muted)]">
                      {actionHint(option, executed)}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <p>{actionHint(chosen, executed)}</p>
          )}

          {chosen === 'redo' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <PlayerSelect
                id={`${ids}-taken`}
                label={`Take from ${review.victim.teamName}`}
                players={review.victimPlayers}
                value={taken}
                onChange={setTaken}
                disabled={saving}
                invalid={failedCode === 'INVALID_INPUT' && !taken}
                selectRef={takenRef}
              />
              <PlayerSelect
                id={`${ids}-returned`}
                label={`Send back from ${review.bloodsucker.teamName}`}
                players={review.returnPlayers}
                value={returned}
                onChange={setReturned}
                disabled={saving}
                invalid={failedCode === 'INVALID_INPUT' && !returned}
              />
            </div>
          ) : null}

          <div>
            <label htmlFor={`${ids}-reason`} className="text-base font-semibold">
              Reason
            </label>
            <textarea
              id={`${ids}-reason`}
              ref={reasonRef}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              maxLength={REASON_MAX}
              rows={3}
              disabled={saving}
              aria-invalid={reasonInvalid}
              aria-describedby={`${ids}-reason-hint`}
              className={FIELD}
            />
            <p id={`${ids}-reason-hint`} className="mt-1 text-[color:var(--league-text-muted)]">
              Required, up to {REASON_MAX} characters ({reason.length} used). It is posted to league
              activity and kept in the audit.
            </p>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[color:var(--league-danger)] px-5 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-text)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {saving ? 'Saving…' : chosen === 'cancel' ? 'Cancel the bite' : 'Redo the bite'}
          </button>
        </form>
      ) : null}

      <div aria-live="polite">
        {command.status === 'saved' ? (
          <p className="rounded-md border border-[color:var(--league-success)] bg-[color:var(--league-success-soft)] p-3 text-sm font-medium">
            {command.action === 'cancel'
              ? 'Done. The bite is cancelled and the league has been told.'
              : 'Done. The bite is redone and the league has been told.'}
          </p>
        ) : null}
      </div>
      {command.status === 'failed' ? (
        <p
          role="alert"
          className="rounded-md border border-[color:var(--league-danger)] bg-[color:var(--league-danger-soft)] p-3 text-sm"
        >
          <span className="font-semibold">
            {command.refusal.code === 'NETWORK_ERROR' ? '' : 'Not saved. '}
            {refusalHeading(command.refusal.code)} ({command.refusal.code}).
          </span>{' '}
          {command.refusal.message}
        </p>
      ) : null}
    </div>
  );
}

function actionHint(action: BiteCommissionerAction, executed: boolean): string {
  if (action === 'redo') {
    return 'The original two players go back to their old teams, then the new pair is swapped.';
  }
  return executed
    ? 'Both players go back to their old teams. The bite is not given again.'
    : 'The bite ends unused and is never given back.';
}

function PlayerSelect({
  id,
  label,
  players,
  value,
  onChange,
  disabled,
  invalid: isInvalid,
  selectRef,
}: {
  id: string;
  label: string;
  players: BiteReviewPlayerView[];
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
  invalid: boolean;
  selectRef?: React.Ref<HTMLSelectElement>;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-base font-semibold">
        {label}
      </label>
      <select
        id={id}
        ref={selectRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        disabled={disabled}
        aria-invalid={isInvalid}
        className={`${FIELD} min-h-11`}
      >
        <option value="">Choose a player</option>
        {players.map((player) => (
          <option key={player.id} value={player.id}>
            {[player.name, player.position, player.club].filter(Boolean).join(' · ')}
          </option>
        ))}
      </select>
    </div>
  );
}
