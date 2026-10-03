import type React from 'react';

import { getTeamInitials } from '@/components/league/leagueTabPanelUtils';

/** Shared score presentation for category head-to-head matchups (manager home, public homepage). */

export type CategoryResult = 'won' | 'lost' | 'drawn' | 'pending';

export interface BoxScoreCategory {
  key: string;
  label: string;
  shortLabel: string;
  result: CategoryResult;
  yourValue: number | null;
  opponentValue: number | null;
}

export interface ScoreTeam {
  teamName: string;
  logoUrl: string | null;
}

export const resultStyle: Record<
  CategoryResult,
  { letter: string; label: string; className: string }
> = {
  won: { letter: 'W', label: 'won', className: 'bg-result-win text-result-win-foreground' },
  lost: { letter: 'L', label: 'lost', className: 'bg-result-loss text-result-loss-foreground' },
  drawn: { letter: 'D', label: 'drawn', className: 'bg-result-draw text-result-draw-foreground' },
  pending: { letter: '–', label: 'not started', className: 'bg-muted text-muted-foreground' },
};

export function TeamMark({ teamName, logoUrl, size = 'md' }: ScoreTeam & { size?: 'sm' | 'md' }) {
  const box =
    size === 'md' ? 'size-10 rounded-md text-sm' : 'size-7 rounded text-[0.6875rem] tracking-tight';
  return (
    <span
      className={`${box} flex shrink-0 items-center justify-center overflow-hidden font-display font-bold leading-none ${
        logoUrl ? 'bg-muted' : 'bg-brand-bar text-brand-bar-foreground'
      }`}
      aria-hidden="true"
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      ) : (
        getTeamInitials(teamName)
      )}
    </span>
  );
}

export function ResultChip({
  result,
  srLabel,
  className = '',
}: {
  result: CategoryResult;
  srLabel?: string;
  className?: string;
}) {
  const style = resultStyle[result];
  return (
    <span
      className={`flex items-center justify-center rounded-sm text-xs font-bold ${style.className} ${className}`}
    >
      <span aria-hidden="true">{style.letter}</span>
      <span className="sr-only">{srLabel ?? style.label}</span>
    </span>
  );
}

/** Two team marks, the category score between them, and one plain-language result line. */
export function MatchupScoreLine({
  you,
  opponent,
  yourWins,
  opponentWins,
  resultLine,
}: {
  you: ScoreTeam;
  opponent: ScoreTeam;
  yourWins: number;
  opponentWins: number;
  resultLine: string;
}) {
  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <TeamMark {...you} />
          <span className="line-clamp-2 break-words text-sm font-semibold leading-tight text-foreground">
            {you.teamName}
          </span>
        </div>
        <p
          className="whitespace-nowrap font-display text-3xl font-bold tabular-nums leading-none text-foreground sm:text-4xl"
          aria-label={`${resultLine}. ${yourWins} categories to ${opponentWins}.`}
        >
          {yourWins}
          <span className="mx-1.5 text-muted-foreground sm:mx-2">–</span>
          {opponentWins}
        </p>
        <div className="flex min-w-0 items-center justify-end gap-2">
          <span className="line-clamp-2 break-words text-right text-sm font-semibold leading-tight text-foreground">
            {opponent.teamName}
          </span>
          <TeamMark {...opponent} />
        </div>
      </div>
      <p
        className="mt-1 text-center text-xs font-semibold text-muted-foreground"
        aria-hidden="true"
      >
        {resultLine}
      </p>
    </div>
  );
}

/** Category box score: both sides' values, the winning value bold, and a W/L/D row. */
export function CategoryBoxScore({
  caption,
  categories,
  yourLabel = 'You',
  opponentLabel = 'Opp',
}: {
  caption: string;
  categories: readonly BoxScoreCategory[];
  yourLabel?: React.ReactNode;
  opponentLabel?: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[20rem] table-fixed text-xs tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th scope="col" className="w-12 py-1.5 text-left font-semibold">
              <span className="sr-only">Team</span>
            </th>
            {categories.map((category) => (
              <th key={category.key} scope="col" className="py-1.5 text-center font-semibold">
                <abbr title={category.label} className="no-underline">
                  {category.shortLabel}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(['you', 'opponent'] as const).map((side) => (
            <tr key={side} className="border-b border-border last:border-b-0">
              <th scope="row" className="py-1.5 text-left font-semibold text-muted-foreground">
                {side === 'you' ? yourLabel : opponentLabel}
              </th>
              {categories.map((category) => {
                const value = side === 'you' ? category.yourValue : category.opponentValue;
                const sideWon =
                  (side === 'you' && category.result === 'won') ||
                  (side === 'opponent' && category.result === 'lost');
                return (
                  <td
                    key={category.key}
                    className={`py-1.5 text-center ${sideWon ? 'font-bold text-foreground' : 'text-muted-foreground'}`}
                  >
                    {value ?? '–'}
                    {sideWon ? <span className="sr-only"> (won {category.label})</span> : null}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <th scope="row" className="pt-2 text-left font-semibold text-muted-foreground">
              <span className="sr-only">Result</span>
            </th>
            {categories.map((category) => (
              <td key={category.key} className="pt-2">
                <ResultChip
                  result={category.result}
                  srLabel={`${category.label}: ${resultStyle[category.result].label}`}
                  className="mx-auto h-5 w-6"
                />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
