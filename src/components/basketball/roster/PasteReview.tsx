'use client';

import { useState } from 'react';

import { badgeStyles, buttonStyles } from '@/components/ui/controlStyles';
import type {
  NbaPlayerCandidate,
  PastedRosterLine,
} from '@/server/basketball/leagues/basketballLeagueDto';

type Choice = string | 'skip' | null;

const STATUS: Record<
  PastedRosterLine['status'],
  { label: string; tone: 'win' | 'warning' | 'neutral' }
> = {
  matched: { label: 'Matched', tone: 'win' },
  suggested: { label: 'Check this match', tone: 'warning' },
  ambiguous: { label: 'Pick one', tone: 'warning' },
  none: { label: 'No match', tone: 'neutral' },
};

function initialChoice(line: PastedRosterLine): Choice {
  if (line.status === 'matched' || line.status === 'suggested')
    return line.candidates[0]?.id ?? 'skip';
  return line.status === 'none' ? 'skip' : null;
}

/** Marking a player on an entered team as taken leaves him where he is (the server skips him). */
function isLeftAlone(candidate: NbaPlayerCandidate, targetTeamId: string | null): boolean {
  return targetTeamId === null && Boolean(candidate.rostered?.teamId);
}

function rosteredNote(candidate: NbaPlayerCandidate, targetTeamId: string | null): string | null {
  if (!candidate.rostered) return null;
  if (candidate.rostered.teamId === targetTeamId) {
    return targetTeamId === null ? 'Already marked as taken' : 'Already on this team';
  }
  if (isLeftAlone(candidate, targetTeamId)) return `On ${candidate.rostered.teamName}: left alone`;
  return `On ${candidate.rostered.teamName ?? 'a team not entered'}: adding moves him`;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function LineChoice({
  line,
  choice,
  targetTeamId,
  onChoose,
}: {
  line: PastedRosterLine;
  choice: Choice;
  targetTeamId: string | null;
  onChoose: (choice: Choice) => void;
}) {
  const status = STATUS[line.status];
  const groupName = `paste-line-${line.line}`;
  return (
    <fieldset className="rounded-md border border-border p-3">
      <legend className="sr-only">
        Line {line.line}: {line.text}
      </legend>
      <div className="flex flex-wrap items-center justify-between gap-2" aria-hidden="true">
        <p className="min-w-0 break-words text-sm">
          <span className="tabular-nums text-muted-foreground">Line {line.line}</span>{' '}
          <span className="font-semibold text-foreground">{line.text}</span>
        </p>
      </div>
      <p className="mt-1">
        <span className={badgeStyles({ tone: status.tone, size: 'xs' })}>{status.label}</span>
      </p>
      {line.status === 'none' ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No NBA player found for &ldquo;{line.name}&rdquo;. Skipped; use search to add him.
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-1">
          {line.candidates.map((candidate) => {
            const note = rosteredNote(candidate, targetTeamId);
            return (
              <label
                key={candidate.id}
                className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-sm px-2 hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              >
                <input
                  type="radio"
                  name={groupName}
                  checked={choice === candidate.id}
                  onChange={() => onChoose(candidate.id)}
                  className="size-4 shrink-0 accent-brand-bar focus:outline-none"
                />
                <span className="flex min-w-0 flex-col text-sm leading-tight">
                  <span className="font-semibold text-foreground">
                    {candidate.fullName}{' '}
                    <span className="font-normal text-muted-foreground">
                      {[candidate.teamCode, candidate.positions.join(', ')]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
                </span>
              </label>
            );
          })}
          <label className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-sm px-2 text-sm text-muted-foreground hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
            <input
              type="radio"
              name={groupName}
              checked={choice === 'skip'}
              onChange={() => onChoose('skip')}
              className="size-4 shrink-0 accent-brand-bar focus:outline-none"
            />
            Skip
          </label>
        </div>
      )}
    </fieldset>
  );
}

const DISCLOSURE_SUMMARY =
  'flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * The review step of a pasted roster. Every line shows what was read and the proposed player;
 * ambiguous lines need a choice, any line can be skipped, and nothing is saved until the user
 * confirms the whole list. Players already elsewhere in the league are flagged: adding to a team
 * moves them, and marking as taken (`targetTeamId` null) leaves players on entered teams alone.
 * `compact` (a whole league's paste) counts each kind of line, keeps the lines that need a look
 * open, and puts matched lines and lines with no match behind disclosures.
 */
export function PasteReview({
  lines,
  targetTeamId,
  targetLabel,
  compact = false,
  busy,
  onConfirm,
  onCancel,
}: {
  lines: PastedRosterLine[];
  targetTeamId: string | null;
  targetLabel: string;
  compact?: boolean;
  busy: boolean;
  onConfirm: (playerIds: string[]) => void;
  onCancel: () => void;
}) {
  const [choices, setChoices] = useState<Choice[]>(() => lines.map(initialChoice));

  const unresolved = choices.filter((choice) => choice === null).length;
  const candidates = new Map(
    lines.flatMap((line) => line.candidates).map((candidate) => [candidate.id, candidate])
  );
  const chosen = lines.flatMap((line, index) => {
    const choice = choices[index];
    return choice && choice !== 'skip' ? [{ line: line.line, playerId: choice }] : [];
  });
  const duplicates = [...new Set(chosen.map((entry) => entry.playerId))].flatMap((playerId) => {
    const onLines = chosen
      .filter((entry) => entry.playerId === playerId)
      .map((entry) => entry.line);
    if (onLines.length < 2) return [];
    const name = candidates.get(playerId)?.fullName ?? 'A player';
    return [
      `${name} is chosen on lines ${onLines.slice(0, -1).join(', ')} and ${onLines.at(-1)}. Skip one.`,
    ];
  });
  const leftAlone = chosen.filter((entry) => {
    const candidate = candidates.get(entry.playerId);
    return candidate ? isLeftAlone(candidate, targetTeamId) : false;
  }).length;
  const count = chosen.length - leftAlone;
  const canConfirm = !busy && unresolved === 0 && duplicates.length === 0 && count > 0;

  const choose = (index: number) => (choice: Choice) =>
    setChoices((current) => current.map((value, at) => (at === index ? choice : value)));
  const renderLine = (line: PastedRosterLine, index: number) => (
    <li key={line.line}>
      <LineChoice
        line={line}
        choice={choices[index]}
        targetTeamId={targetTeamId}
        onChoose={choose(index)}
      />
    </li>
  );
  const indexed = lines.map((line, index) => ({ line, index }));
  const ofStatus = (...statuses: PastedRosterLine['status'][]) =>
    indexed.filter(({ line }) => statuses.includes(line.status));

  return (
    <div className="flex flex-col gap-3">
      {compact ? (
        <>
          <ul
            aria-label="What was found"
            className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-foreground"
          >
            <li>
              <strong>{ofStatus('matched').length}</strong> matched
            </li>
            <li>
              <strong>{ofStatus('suggested').length}</strong> to check
            </li>
            <li>
              <strong>{ofStatus('ambiguous').length}</strong> to choose
            </li>
            <li>
              <strong>{ofStatus('none').length}</strong> with no match
            </li>
            {leftAlone > 0 ? (
              <li>
                <strong>{leftAlone}</strong> already on a team you entered: left alone
              </li>
            ) : null}
          </ul>
          {ofStatus('suggested', 'ambiguous').length > 0 ? (
            <ol aria-label="Lines to check" className="flex flex-col gap-2">
              {ofStatus('suggested', 'ambiguous').map(({ line, index }) => renderLine(line, index))}
            </ol>
          ) : null}
          {ofStatus('matched').length > 0 ? (
            <details className="rounded-md border border-border">
              <summary className={DISCLOSURE_SUMMARY}>
                Show {plural(ofStatus('matched').length, 'matched player', 'matched players')}
              </summary>
              <ol className="flex flex-col gap-2 border-t border-border p-2">
                {ofStatus('matched').map(({ line, index }) => renderLine(line, index))}
              </ol>
            </details>
          ) : null}
          {ofStatus('none').length > 0 ? (
            <details className="rounded-md border border-border">
              <summary className={DISCLOSURE_SUMMARY}>
                Show {plural(ofStatus('none').length, 'line', 'lines')} with no match
              </summary>
              <div className="border-t border-border p-3 text-sm text-muted-foreground">
                <p>
                  Team names and other page text land here. A player listed here was not found; use
                  search to add him.
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {ofStatus('none').map(({ line }) => (
                    <li key={line.line} className="break-words">
                      <span className="tabular-nums">Line {line.line}</span>{' '}
                      <span className="text-foreground">{line.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          ) : null}
        </>
      ) : (
        <ol className="flex flex-col gap-2">{lines.map(renderLine)}</ol>
      )}

      <div aria-live="polite" className="text-sm font-medium text-foreground">
        {unresolved > 0 ? (
          <p>Choose a player or Skip on {plural(unresolved, 'line', 'lines')}.</p>
        ) : null}
        {duplicates.map((message) => (
          <p key={message}>{message}</p>
        ))}
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className={buttonStyles({ variant: 'outline' })}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canConfirm}
          onClick={() => {
            if (canConfirm) onConfirm(chosen.map((entry) => entry.playerId));
          }}
          className={buttonStyles({ variant: 'primary' })}
        >
          {busy
            ? 'Saving…'
            : targetTeamId === null
              ? `Mark ${plural(count, 'player', 'players')} as taken`
              : `Add ${plural(count, 'player', 'players')} to ${targetLabel}`}
        </button>
      </div>
    </div>
  );
}
