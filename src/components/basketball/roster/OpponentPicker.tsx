'use client';

import Link from 'next/link';
import { useId, useState } from 'react';

import { buttonStyles, fieldStyles } from '@/components/ui/controlStyles';

const NONE = '';

/** Sets or clears the user's opponent for one fantasy week. */
export function OpponentPicker({
  weekLabel,
  opponentTeamId,
  teams,
  settingsHref,
  disabled,
  onSave,
}: {
  weekLabel: string;
  opponentTeamId: string | null;
  teams: { id: string; name: string }[];
  settingsHref: string;
  disabled: boolean;
  onSave: (opponentTeamId: string | null) => void;
}) {
  const id = useId();
  const [choice, setChoice] = useState(opponentTeamId ?? NONE);
  const current = opponentTeamId ?? NONE;

  if (teams.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Add your opponent&apos;s team in{' '}
        <Link
          href={settingsHref}
          className="font-semibold text-foreground underline underline-offset-4"
        >
          Settings
        </Link>{' '}
        first, then pick it here.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (choice !== current) onSave(choice === NONE ? null : choice);
      }}
    >
      <label htmlFor={id} className="text-sm font-semibold text-foreground">
        Opponent for {weekLabel}
      </label>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        The Overview and Matchup pages compare your team with this one.
      </p>
      <div className="flex gap-2">
        <select
          id={id}
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
          aria-describedby={`${id}-help`}
          className={fieldStyles({ className: 'min-w-0 flex-1 pr-8' })}
        >
          <option value={NONE}>No opponent set</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={disabled || choice === current}
          className={buttonStyles({ variant: 'primary' })}
        >
          Save
        </button>
      </div>
    </form>
  );
}
