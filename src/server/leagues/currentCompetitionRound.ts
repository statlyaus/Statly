/**
 * The league's current competition round, the one definition matchups and lineups share: the latest
 * playable round whose window contains now, else the next one not started yet, else the last.
 */
export function resolveCurrentCompetitionRound<
  TRound extends {
    round: number;
    status: string;
    startsAt: Date | null;
    endsAt: Date | null;
  },
>(rounds: readonly TRound[], now = new Date()): TRound | null {
  const playableRounds = rounds.filter(
    (competitionRound) => competitionRound.status !== 'NO_MATCHUP'
  );
  if (!playableRounds.length) return rounds[0] ?? null;

  const startedRounds = playableRounds.filter(
    (competitionRound) =>
      competitionRound.startsAt &&
      competitionRound.startsAt <= now &&
      (!competitionRound.endsAt || competitionRound.endsAt >= now)
  );
  const latestStartedRound = startedRounds.reduce<TRound | null>(
    (latest, competitionRound) =>
      !latest || competitionRound.round > latest.round ? competitionRound : latest,
    null
  );

  return (
    latestStartedRound ??
    playableRounds.find(
      (competitionRound) => !competitionRound.startsAt || competitionRound.startsAt > now
    ) ??
    playableRounds.at(-1) ??
    null
  );
}
