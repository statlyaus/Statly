'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { useConfirmDialog } from '@/components/ui/ConfirmDialog';
import { buttonStyles, fieldStyles } from '@/components/ui/controlStyles';
import type { BasketballLeagueDetail } from '@/server/basketball/leagues/basketballLeagueDto';

import { callBasketballApi } from '../shell/basketballApi';
import { ErrorSummary, FieldError, FormSection, describedBy } from '../shell/formParts';

interface TeamRow {
  key: string;
  id?: string;
  name: string;
  isMine: boolean;
}

function rowsOf(league: BasketballLeagueDetail): TeamRow[] {
  return league.teams.map((team) => ({
    key: team.id,
    id: team.id,
    name: team.name,
    isMine: team.isMine,
  }));
}

/**
 * The league's team names: rename, add (up to the team count) or remove. Saving sends the whole list;
 * removing a team that holds players or matchups asks first, because those go with it.
 */
export function BasketballTeamsEditor({ league }: { league: BasketballLeagueDetail }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirmDialog();
  const [rows, setRows] = useState<TeamRow[]>(() => rowsOf(league));
  const [saved, setSaved] = useState<BasketballLeagueDetail>(league);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);
  const nextKey = useRef(0);

  useEffect(() => {
    if (focusRequest > 0) summaryRef.current?.focus();
  }, [focusRequest]);

  const rowError = (index: number) => errors[`teams.${index}.name`]?.join(' ');
  const listError = [...(errors.teams ?? []), ...(formError ? [formError] : [])].join(' ');
  const inputId = (index: number) => `bb-team-${index}`;

  function edit(next: TeamRow[]) {
    setRows(next);
    setStatus(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const keptIds = new Set(rows.flatMap((row) => (row.id ? [row.id] : [])));
    const removed = saved.teams.filter((team) => !keptIds.has(team.id));
    const losses = removed.flatMap((team) => {
      const players = saved.rosterSpots.filter((spot) => spot.teamId === team.id).length;
      const matchups = saved.matchups.filter(
        (matchup) => matchup.teamId === team.id || matchup.opponentTeamId === team.id
      ).length;
      return players || matchups ? [{ name: team.name, players, matchups }] : [];
    });
    if (losses.length > 0) {
      const confirmed = await confirm({
        title: `Remove ${losses.length === 1 ? losses[0].name : `${losses.length} teams`}?`,
        description: losses
          .map(
            (loss) =>
              `${loss.name}: ${loss.players} rostered ${loss.players === 1 ? 'player' : 'players'} and ${loss.matchups} ${loss.matchups === 1 ? 'matchup' : 'matchups'} will be removed from Statly.`
          )
          .join(' '),
        confirmLabel: 'Remove and save',
        tone: 'danger',
      });
      if (!confirmed) return;
    }

    setPending(true);
    const result = await callBasketballApi<BasketballLeagueDetail>(
      `/api/basketball/leagues/${encodeURIComponent(league.id)}/teams`,
      'PUT',
      { teams: rows.map((row) => (row.id ? { id: row.id, name: row.name } : { name: row.name })) }
    );
    setPending(false);
    if (!result.ok) {
      const hasFieldErrors = Object.keys(result.fieldErrors).length > 0;
      setErrors(result.fieldErrors);
      setFormError(hasFieldErrors ? null : result.message);
      setFocusRequest((count) => count + 1);
      return;
    }
    setErrors({});
    setFormError(null);
    setSaved(result.data);
    setRows(rowsOf(result.data));
    setStatus('Teams saved.');
    router.refresh();
  }

  const summary = [
    ...rows.flatMap((row, index) =>
      (errors[`teams.${index}.name`] ?? []).map((message) => ({
        fieldId: inputId(index),
        message: `${row.name || `Team ${index + 1}`}: ${message}`,
      }))
    ),
  ];
  const errorCount = summary.length + (listError ? 1 : 0);

  // The dialog renders outside the form: React events bubble through portals, so its own submit
  // would otherwise reach this form's handler.
  return (
    <>
      <form
        onSubmit={submit}
        noValidate
        aria-busy={pending || undefined}
        className="[&_[aria-invalid=true]]:border-destructive"
      >
        <FormSection
          id="bb-team-names"
          title="Teams"
          summary={`Up to ${league.teamCount} teams. Removing a team also removes its roster and matchups.`}
        >
          {errorCount > 0 ? (
            <ErrorSummary
              ref={summaryRef}
              title={`Check ${errorCount} ${errorCount === 1 ? 'problem' : 'problems'}`}
              formErrors={listError ? [listError] : []}
              errors={summary}
            />
          ) : null}
          <ol className="flex flex-col gap-2">
            {rows.map((row, index) => (
              <li key={row.key} className="flex flex-col gap-1">
                <div className="flex items-end gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <label
                      htmlFor={inputId(index)}
                      className="text-xs font-semibold text-muted-foreground"
                    >
                      {row.isMine ? 'Your team' : `Team ${index + 1}`}
                    </label>
                    <input
                      id={inputId(index)}
                      autoComplete="off"
                      maxLength={60}
                      value={row.name}
                      onChange={(event) =>
                        edit(
                          rows.map((candidate) =>
                            candidate.key === row.key
                              ? { ...candidate, name: event.target.value }
                              : candidate
                          )
                        )
                      }
                      aria-invalid={rowError(index) ? true : undefined}
                      aria-describedby={describedBy(inputId(index), undefined, rowError(index))}
                      className={fieldStyles()}
                    />
                  </div>
                  {row.isMine ? (
                    <span className="inline-flex min-h-11 w-24 items-center justify-center text-xs text-muted-foreground">
                      Can&apos;t remove
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => edit(rows.filter((candidate) => candidate.key !== row.key))}
                      className={buttonStyles({ variant: 'ghost', className: 'w-24' })}
                      aria-label={`Remove ${row.name || `team ${index + 1}`}`}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <FieldError id={inputId(index)} error={rowError(index)} />
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={rows.length >= league.teamCount}
              onClick={() => {
                nextKey.current += 1;
                edit([...rows, { key: `new-${nextKey.current}`, name: '', isMine: false }]);
              }}
              className={buttonStyles({ variant: 'outline' })}
            >
              Add team
            </button>
            <button
              type="submit"
              disabled={pending}
              className={buttonStyles({ variant: 'primary' })}
            >
              {pending ? 'Saving…' : 'Save teams'}
            </button>
            {status ? (
              <p role="status" className="text-sm font-medium text-foreground">
                {status}
              </p>
            ) : null}
          </div>
        </FormSection>
      </form>
      {dialog}
    </>
  );
}
