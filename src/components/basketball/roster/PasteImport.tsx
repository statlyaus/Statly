'use client';

import { useId, useState } from 'react';

import { buttonStyles, fieldStyles } from '@/components/ui/controlStyles';
import type { PastedRosterLine } from '@/server/basketball/leagues/basketballLeagueDto';

import { callBasketballApi } from '../shell/basketballApi';
import { FieldError, describedBy } from '../shell/formParts';
import { PasteReview } from './PasteReview';

/**
 * Paste a roster copied from Yahoo or ESPN: the server reads a name from each line and proposes
 * players (no write), the user reviews every line, and only the confirmed players are added.
 */
export function PasteImport({
  leagueId,
  targetTeamId,
  targetLabel,
  disabled,
  onConfirm,
}: {
  leagueId: string;
  targetTeamId: string | null;
  targetLabel: string;
  disabled: boolean;
  /** Adds the confirmed players; resolves to an error message, or null when they were added. */
  onConfirm: (playerIds: string[]) => Promise<string | null>;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [lines, setLines] = useState<PastedRosterLine[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function findPlayers() {
    setPending(true);
    setError(undefined);
    const result = await callBasketballApi<PastedRosterLine[]>(
      `/api/basketball/leagues/${encodeURIComponent(leagueId)}/roster/match`,
      'POST',
      { text }
    );
    setPending(false);
    if (!result.ok) {
      setError(result.fieldErrors.text?.join(' ') ?? result.message);
      return;
    }
    setLines(result.data);
  }

  async function confirm(playerIds: string[]) {
    setPending(true);
    const message = await onConfirm(playerIds);
    setPending(false);
    if (message) {
      setError(message);
      return;
    }
    setLines(null);
    setText('');
  }

  if (lines) {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Check the players before adding</h3>
          <p className="text-xs text-muted-foreground">
            Nothing is saved until you confirm. Adding a player who is on another team moves him.
          </p>
        </div>
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
        <PasteReview
          key={lines.map((line) => line.line).join(',')}
          lines={lines}
          targetTeamId={targetTeamId}
          targetLabel={targetLabel}
          busy={pending || disabled}
          onConfirm={(playerIds) => void confirm(playerIds)}
          onCancel={() => {
            setLines(null);
            setError(undefined);
          }}
        />
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-1 [&_[aria-invalid=true]]:border-destructive"
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending) void findPlayers();
      }}
    >
      <label htmlFor={id} className="text-sm font-semibold text-foreground">
        Paste players, one per line
      </label>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        Copy a roster from Yahoo or ESPN. Slots, positions, team codes and injury tags are ignored.
      </p>
      <textarea
        id={id}
        rows={5}
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, true, error)}
        className={fieldStyles({ size: 'area' })}
      />
      <FieldError id={id} error={error} />
      <div className="mt-1">
        <button
          type="submit"
          disabled={pending || text.trim() === ''}
          className={buttonStyles({ variant: 'outline' })}
        >
          {pending ? 'Finding players…' : 'Find players'}
        </button>
      </div>
    </form>
  );
}
