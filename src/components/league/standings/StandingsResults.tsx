'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { getTeamInitials } from '@/components/league/leagueTabPanelUtils';
import { ResultChip, TeamMark } from '@/components/scores/MatchupScore';

import {
  describeResult,
  matchCentreHref,
  RESULT_TO_CHIP,
  type StandingsData,
  type TeamRoundResult,
} from './standingsFormat';

const DEFAULT_READOUT = 'Hover over, tap or focus a result to see the match.';

/** Every team's result in every round. Your own matches open in the Match Centre. */
export function StandingsResults({
  data,
  leagueId,
}: {
  data: StandingsData;
  leagueId: string;
}): React.JSX.Element {
  const [readout, setReadout] = useState(DEFAULT_READOUT);
  const teamsById = useMemo(
    () => new Map(data.teams.map((team) => [team.memberId, team])),
    [data.teams]
  );
  const minWidth = `${15 + data.rounds.length * 4.75}rem`;

  if (data.rounds.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
        Results appear once the fixture is published.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <p
        aria-live="polite"
        className="min-h-10 border-b border-border px-4 py-2.5 text-sm text-foreground first-letter:uppercase"
      >
        {readout}
      </p>
      <div className="relative overflow-x-auto">
        <table className="w-full table-fixed text-sm" style={{ minWidth }}>
          <caption className="sr-only">Results by round for every team, in ladder order</caption>
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th
                scope="col"
                className="sticky left-0 z-10 w-60 bg-card py-2 pl-4 pr-2 text-left font-semibold shadow-[1px_0_0_0_var(--border)]"
              >
                Team
              </th>
              {data.rounds.map((round) => (
                <th key={round.round} scope="col" className="px-1 py-2 text-center font-semibold">
                  R{round.round}
                  {round.status === 'LIVE' ? (
                    <span className="block text-[0.625rem] font-bold uppercase text-result-loss">
                      Live
                    </span>
                  ) : round.phase === 'FINALS' ? (
                    <span className="block text-[0.625rem] font-bold uppercase">Final</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.teams.map((team) => {
              const isYou = team.memberId === data.viewerMemberId;
              const rowBg = isYou ? 'bg-accent' : 'bg-card';
              const byRound = new Map(team.results.map((result) => [result.round, result]));
              return (
                <tr
                  key={team.memberId}
                  className={`h-12 border-b border-border last:border-b-0 ${rowBg}`}
                >
                  <th
                    scope="row"
                    className={`sticky left-0 z-10 py-1 pl-4 pr-2 text-left font-normal shadow-[1px_0_0_0_var(--border)] ${rowBg}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="w-5 text-right text-sm font-bold tabular-nums text-foreground">
                        {team.rank}
                      </span>
                      <TeamMark teamName={team.teamName} logoUrl={team.teamLogoUrl} size="sm" />
                      <span className="truncate font-semibold text-foreground">
                        {team.teamName}
                      </span>
                    </span>
                  </th>
                  {data.rounds.map((round) => {
                    const result = byRound.get(round.round);
                    const opponent = result?.opponentId ? teamsById.get(result.opponentId) : null;
                    const involvesYou =
                      isYou || (result?.opponentId ?? null) === data.viewerMemberId;
                    return (
                      <td key={round.round} className="px-1 text-center">
                        {result ? (
                          <ResultCell
                            result={result}
                            label={`Round ${round.round}: ${team.teamName} ${describeResult(result, opponent?.teamName ?? null)}`}
                            opponentInitials={opponent ? getTeamInitials(opponent.teamName) : null}
                            href={
                              involvesYou &&
                              result.status !== 'BYE' &&
                              result.status !== 'SCHEDULED'
                                ? matchCentreHref(leagueId, round.round)
                                : null
                            }
                            onShow={setReadout}
                            onHide={() => setReadout(DEFAULT_READOUT)}
                          />
                        ) : (
                          <span className="text-muted-foreground">–</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        Scores are categories won–lost. Results in your row, and against you, open in the Match
        Centre.
      </p>
    </div>
  );
}

function ResultCell({
  result,
  label,
  opponentInitials,
  href,
  onShow,
  onHide,
}: {
  result: TeamRoundResult;
  label: string;
  opponentInitials: string | null;
  href: string | null;
  onShow: (text: string) => void;
  onHide: () => void;
}) {
  const content =
    result.status === 'BYE' ? (
      <span className="text-xs text-muted-foreground">Bye</span>
    ) : result.result ? (
      <span className="flex flex-col items-center gap-0.5">
        <ResultChip result={RESULT_TO_CHIP[result.result]} className="size-5" />
        <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
          {result.categoriesFor}–{result.categoriesAgainst}
        </span>
      </span>
    ) : result.status === 'LIVE' ? (
      <span className="flex flex-col items-center gap-0.5">
        <span className="text-xs font-bold tabular-nums text-foreground">
          {result.categoriesFor}–{result.categoriesAgainst}
        </span>
        <span className="text-[0.625rem] font-bold uppercase text-result-loss">Live</span>
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">
        {opponentInitials ? `v ${opponentInitials}` : 'TBC'}
      </span>
    );
  const common = {
    'aria-label': label,
    onPointerEnter: () => onShow(label),
    // A tap also fires pointerleave; only a mouse leaving clears the readout.
    onPointerLeave: (event: React.PointerEvent) => {
      if (event.pointerType === 'mouse') onHide();
    },
    onFocus: () => onShow(label),
    onBlur: onHide,
    className:
      'mx-auto flex min-h-10 w-full max-w-16 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar',
  };
  return href ? (
    <Link href={href} {...common}>
      {content}
    </Link>
  ) : (
    // Tapping shows the match in the readout (touch has no hover).
    <button type="button" onClick={() => onShow(label)} {...common}>
      {content}
    </button>
  );
}
