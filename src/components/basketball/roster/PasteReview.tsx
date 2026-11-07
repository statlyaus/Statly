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

function rosteredNote(candidate: NbaPlayerCandidate, targetTeamId: string | null): string | null {
  if (!candidate.rostered) return null;
  if (candidate.rostered.teamId === targetTeamId) return 'Already on this team';
  return `On ${candidate.rostered.teamName ?? 'a team not entered'}: adding moves him`;
}

/**
 * The review step of a pasted roster. Every line shows what was read and the proposed player;
 * ambiguous lines need a choice, any line can be skipped, and nothing is saved until the user
 * confirms the whole list. Players already elsewhere in the league are flagged, because adding
 * moves them.
 */
export function PasteReview({
  lines,
  targetTeamId,
  targetLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  lines: PastedRosterLine[];
  targetTeamId: string | null;
  targetLabel: string;
  busy: boolean;
  onConfirm: (playerIds: string[]) => void;
  onCancel: () => void;
}) {
  const [choices, setChoices] = useState<Choice[]>(() => lines.map(initialChoice));

  const unresolved = choices.filter((choice) => choice === null).length;
  const chosen = lines.flatMap((line, index) => {
    const choice = choices[index];
    return choice && choice !== 'skip' ? [{ line: line.line, playerId: choice }] : [];
  });
  const duplicates = [...new Set(chosen.map((entry) => entry.playerId))].flatMap((playerId) => {
    const onLines = chosen
      .filter((entry) => entry.playerId === playerId)
      .map((entry) => entry.line);
    if (onLines.length < 2) return [];
    const name =
      lines.flatMap((line) => line.candidates).find((candidate) => candidate.id === playerId)
        ?.fullName ?? 'A player';
    return [
      `${name} is chosen on lines ${onLines.slice(0, -1).join(', ')} and ${onLines.at(-1)}. Skip one.`,
    ];
  });
  const canConfirm = !busy && unresolved === 0 && duplicates.length === 0 && chosen.length > 0;
  const count = chosen.length;

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-2">
        {lines.map((line, index) => {
          const status = STATUS[line.status];
          const groupName = `paste-line-${line.line}`;
          return (
            <li key={line.line}>
              <fieldset className="rounded-md border border-border p-3">
                <legend className="sr-only">
                  Line {line.line}: {line.text}
                </legend>
                <div
                  className="flex flex-wrap items-center justify-between gap-2"
                  aria-hidden="true"
                >
                  <p className="min-w-0 text-sm">
                    <span className="tabular-nums text-muted-foreground">Line {line.line}</span>{' '}
                    <span className="font-semibold text-foreground">{line.text}</span>
                  </p>
                </div>
                <p className="mt-1">
                  <span className={badgeStyles({ tone: status.tone, size: 'xs' })}>
                    {status.label}
                  </span>
                </p>
                {line.status === 'none' ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No NBA player found for &ldquo;{line.name}&rdquo;. Skipped; use search to add
                    him.
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
                            checked={choices[index] === candidate.id}
                            onChange={() =>
                              setChoices((current) =>
                                current.map((choice, at) => (at === index ? candidate.id : choice))
                              )
                            }
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
                            {note ? (
                              <span className="text-xs text-muted-foreground">{note}</span>
                            ) : null}
                          </span>
                        </label>
                      );
                    })}
                    <label className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-sm px-2 text-sm text-muted-foreground hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                      <input
                        type="radio"
                        name={groupName}
                        checked={choices[index] === 'skip'}
                        onChange={() =>
                          setChoices((current) =>
                            current.map((choice, at) => (at === index ? 'skip' : choice))
                          )
                        }
                        className="size-4 shrink-0 accent-brand-bar focus:outline-none"
                      />
                      Skip
                    </label>
                  </div>
                )}
              </fieldset>
            </li>
          );
        })}
      </ol>

      <div aria-live="polite" className="text-sm font-medium text-foreground">
        {unresolved > 0 ? (
          <p>
            Choose a player or Skip on {unresolved} {unresolved === 1 ? 'line' : 'lines'}.
          </p>
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
            ? 'Adding…'
            : `Add ${count} ${count === 1 ? 'player' : 'players'} to ${targetLabel}`}
        </button>
      </div>
    </div>
  );
}
