import { ArrowDown, ArrowUp } from 'lucide-react';

import { ResultChip } from '@/components/scores/MatchupScore';

import { formatChance } from './raceFormat';
import { RESULT_TO_CHIP, type StandingsTeam } from './standingsFormat';

/** Pieces shared by the Standings ladder, the Overview ladder and the Race view. */

export function Movement({ value }: { value: number | null }): React.JSX.Element {
  if (value === null || value === 0) {
    return (
      <span className="w-7 text-xs text-muted-foreground">
        <span aria-hidden="true">–</span>
        <span className="sr-only">{value === 0 ? 'no change' : ''}</span>
      </span>
    );
  }
  const up = value > 0;
  return (
    <span
      className={`inline-flex w-7 items-center text-xs font-semibold ${
        up ? 'text-result-win' : 'text-result-loss'
      }`}
    >
      {up ? (
        <ArrowUp aria-hidden="true" className="size-3" />
      ) : (
        <ArrowDown aria-hidden="true" className="size-3" />
      )}
      {Math.abs(value)}
      <span className="sr-only">
        {up ? ' up' : ' down'} {Math.abs(value) === 1 ? 'place' : 'places'} since last round
      </span>
    </span>
  );
}

export function FormChips({ form }: { form: StandingsTeam['form'] }): React.JSX.Element {
  if (form.length === 0) return <span className="text-muted-foreground">–</span>;
  return (
    <span className="flex gap-1" aria-label={`Last ${form.length}: ${form.join(' ')}`} role="img">
      {form.map((result, index) => (
        <ResultChip key={index} result={RESULT_TO_CHIP[result]} className="size-5" />
      ))}
    </span>
  );
}

/** Finals chance as a number over a green bar; "In" or "Out" once it is certain. */
export function FinalsChance({ finals }: { finals: StandingsTeam['finals'] }): React.JSX.Element {
  if (!finals) return <span className="block text-right text-muted-foreground">–</span>;
  return (
    <span className="flex flex-col items-end gap-1">
      <span
        className={`font-display text-base font-bold leading-none tabular-nums ${
          finals.status === 'CLINCHED'
            ? 'text-result-win'
            : finals.status === 'OUT'
              ? 'text-muted-foreground'
              : 'text-foreground'
        }`}
      >
        {formatChance(finals)}
      </span>
      <span
        aria-hidden="true"
        className="h-1.5 w-full max-w-16 overflow-hidden rounded-full bg-muted"
      >
        <span
          className="block h-full rounded-full bg-result-win"
          style={{ width: `${Math.round(finals.chance * 100)}%` }}
        />
      </span>
    </span>
  );
}

/** The green FINALS pill and rule that sits under the last finals place. */
export function FinalsDivider({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <div aria-hidden="true" className={`flex items-center gap-2 ${className}`}>
      <span className="rounded-full bg-result-win px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-result-win-foreground">
        Finals
      </span>
      <span className="h-0.5 flex-1 rounded-full bg-result-win" />
    </div>
  );
}
