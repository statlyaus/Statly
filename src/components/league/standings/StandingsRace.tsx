'use client';

import { useState } from 'react';

import { TeamMark } from '@/components/scores/MatchupScore';

import { RaceReadout } from './RaceReadout';
import { FinalsChance, FinalsDivider } from './StandingsBits';
import { formatChance, ordinal, winsAfter, winsLabel, winsOf } from './raceFormat';
import { formatRecord, type StandingsData } from './standingsFormat';

const GRID =
  'grid grid-cols-[1.5rem_minmax(0,6.5rem)_minmax(0,1fr)_3.5rem] gap-x-2 px-2 sm:grid-cols-[2rem_minmax(0,12rem)_minmax(0,1fr)_6rem] sm:gap-x-3';

/**
 * Race to finals: every team's wins on one scale, in ladder order, with the finals cut-off, the
 * range of final wins the simulations expect, and each team's chance of making finals. Plotting
 * wins (not ladder position) shows the real gaps between teams.
 */
export function StandingsRace({ data }: { data: StandingsData }): React.JSX.Element {
  const [activeId, setActiveId] = useState<string | null>(data.viewerMemberId);
  const rounds = data.completedRounds;
  const latest = rounds.at(-1) ?? null;
  const previous = rounds.at(-2) ?? null;

  if (latest === null) {
    return (
      <p className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
        The race to finals starts once the first round is final.
      </p>
    );
  }

  const scaleMax = Math.max(
    data.regularSeasonRounds,
    ...data.teams.map((team) => team.finals?.winsHigh ?? winsOf(team)),
    1
  );
  const step = Math.max(1, Math.ceil(scaleMax / 8));
  const ticks = Array.from({ length: Math.floor(scaleMax / step) + 1 }, (_, index) => index * step);
  const position = (value: number) => `${(value / scaleMax) * 100}%`;
  const cutoffTeam = data.finalsTeams > 0 ? data.teams[data.finalsTeams - 1] : null;
  const cutoffWins = cutoffTeam ? winsOf(cutoffTeam) : null;
  const roundsLeft = Math.max(0, data.regularSeasonRounds - rounds.length);
  const teamsById = new Map(data.teams.map((team) => [team.memberId, team]));
  const active = data.teams.find((team) => team.memberId === activeId) ?? null;
  const hasOdds = data.teams.some((team) => team.finals !== null);

  return (
    <section
      aria-labelledby="standings-race-heading"
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="border-b border-border px-4 py-3">
        <h3
          id="standings-race-heading"
          className="font-display text-lg font-bold leading-tight text-foreground"
        >
          Race to finals
        </h3>
        <p className="text-sm text-muted-foreground">
          Wins after round {latest}
          {data.finalsTeams > 0 ? ` · top ${data.finalsTeams} make finals` : ''}
          {roundsLeft > 0 ? ` · ${roundsLeft} ${roundsLeft === 1 ? 'round' : 'rounds'} left` : ''}
        </p>
      </header>

      <p
        aria-live="polite"
        className="min-h-11 border-b border-border bg-muted px-4 py-2.5 text-sm text-foreground"
      >
        {active ? (
          <RaceReadout team={active} data={data} cutoffWins={cutoffWins} teamsById={teamsById} />
        ) : (
          'Select a team to see its race.'
        )}
      </p>

      <div className="px-2 py-3 sm:px-4">
        <div className={`${GRID} items-end pb-1`}>
          <span className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            #
          </span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Team
          </span>
          <span className="relative h-5" aria-hidden="true">
            {ticks.map((tick) => (
              <span
                key={tick}
                className="absolute -translate-x-1/2 text-xs font-semibold tabular-nums text-muted-foreground"
                style={{ left: position(tick) }}
              >
                {tick}
              </span>
            ))}
          </span>
          <span className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {hasOdds ? 'Finals' : 'W–L'}
          </span>
        </div>

        <ol>
          {data.teams.map((team) => {
            const wins = winsOf(team);
            const before = previous !== null ? winsAfter(team, previous) : null;
            const isYou = team.memberId === data.viewerMemberId;
            const isActive = team.memberId === activeId;
            const inFinals = data.finalsTeams > 0 && team.rank <= data.finalsTeams;
            const finals = team.finals;
            const record = formatRecord(team.wins, team.losses, team.draws);
            const chance = formatChance(finals);
            const dotColour = isYou
              ? 'bg-primary'
              : isActive
                ? 'bg-[color:var(--chart-1)]'
                : 'bg-foreground/70';
            const bandColour = isYou
              ? 'bg-primary/20'
              : isActive
                ? 'bg-[color:var(--chart-1)]/20'
                : 'bg-foreground/10';
            return (
              <li key={team.memberId}>
                {data.finalsTeams > 0 && team.rank === data.finalsTeams + 1 ? (
                  <FinalsDivider className="py-1.5" />
                ) : null}
                <button
                  type="button"
                  aria-pressed={isActive}
                  aria-label={`${team.rank}. ${team.teamName}${isYou ? ' (your team)' : ''}, ${winsLabel(wins)}, ${record}${finals ? `, finals chance ${chance}` : ''}`}
                  onClick={() => setActiveId(team.memberId)}
                  onFocus={() => setActiveId(team.memberId)}
                  className={`${GRID} min-h-12 w-full items-center rounded-md text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar ${
                    isActive ? 'bg-accent hover:bg-accent' : inFinals ? 'bg-result-win/5' : ''
                  }`}
                >
                  <span className="text-right font-display text-base font-bold tabular-nums text-foreground">
                    {team.rank}
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="hidden sm:inline-flex">
                      <TeamMark teamName={team.teamName} logoUrl={team.teamLogoUrl} size="sm" />
                    </span>
                    <span className="min-w-0">
                      <span
                        className={`block truncate text-sm text-foreground ${isYou || isActive ? 'font-semibold' : ''}`}
                      >
                        {team.teamName}
                      </span>
                      <span className="block text-xs tabular-nums text-muted-foreground">
                        {record}
                      </span>
                    </span>
                  </span>
                  <span className="relative min-h-8 self-stretch" aria-hidden="true">
                    {ticks.map((tick) => (
                      <span
                        key={tick}
                        className="absolute inset-y-0 w-px bg-border"
                        style={{ left: position(tick) }}
                      />
                    ))}
                    {cutoffWins !== null ? (
                      <span
                        className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-result-win/50"
                        style={{ left: position(cutoffWins) }}
                      />
                    ) : null}
                    {/* Where the simulations expect this team to finish, in wins */}
                    {finals && finals.gamesLeft > 0 && finals.winsHigh > wins ? (
                      <>
                        <span
                          className={`absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full ${bandColour}`}
                          style={{
                            left: position(wins),
                            width: `${((finals.winsHigh - wins) / scaleMax) * 100}%`,
                          }}
                        />
                        <span
                          className="absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/45"
                          style={{ left: position(finals.projectedWins) }}
                        />
                      </>
                    ) : null}
                    {before !== null && before !== wins ? (
                      <>
                        <span
                          className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-foreground/30"
                          style={{
                            left: position(Math.min(before, wins)),
                            width: `${(Math.abs(wins - before) / scaleMax) * 100}%`,
                          }}
                        />
                        <span
                          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foreground/35 bg-card"
                          style={{ left: position(before) }}
                        />
                      </>
                    ) : null}
                    <span
                      className={`absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card ${dotColour}`}
                      style={{ left: position(wins) }}
                    />
                  </span>
                  {finals ? (
                    <FinalsChance finals={finals} />
                  ) : (
                    <span className="text-right text-sm font-semibold tabular-nums text-foreground">
                      {record}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <footer className="space-y-1.5 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-primary" />
            Your team
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full border-2 border-foreground/35 bg-card"
            />
            {previous !== null ? `After round ${previous}` : 'Previous round'}
          </span>
          {hasOdds && roundsLeft > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="relative h-2.5 w-6 rounded-full bg-foreground/10">
                <span className="absolute inset-y-[-2px] left-1/2 w-0.5 rounded-full bg-foreground/45" />
              </span>
              Likely final wins (tick: average)
            </span>
          ) : null}
          {cutoffWins !== null ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-3 w-0.5 bg-result-win/60" />
              {ordinal(data.finalsTeams)} place now ({winsLabel(cutoffWins)})
            </span>
          ) : null}
        </p>
        {hasOdds ? (
          <p>
            Finals chances come from simulating the remaining games 5,000 times, weighting each game
            by the teams&apos; category win rates. A draw counts as half a win.
          </p>
        ) : null}
      </footer>
    </section>
  );
}
