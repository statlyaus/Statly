import type { Prisma } from '@prisma/client';

/**
 * A FINAL round may be rescored (stat corrections), but every change to a FINAL matchup's stored
 * result is recorded with before and after (owner decision 2026-11-11, finding roster-scoring-11).
 */
export type MatchupResultSnapshot = {
  status: string;
  winnerMemberId: string | null;
  homeCategoryWins: number;
  awayCategoryWins: number;
  drawnCategories: number;
  scores: Array<{ memberId: string; categoriesJson: unknown; pointsFor: number }>;
};

type AuditClient = Pick<Prisma.TransactionClient, 'leagueMatchup' | 'leagueCompetitionAudit'>;

/** The stored results of the matchups that are FINAL now. Read inside the scoring transaction. */
export async function loadFinalMatchupSnapshots(
  tx: AuditClient,
  leagueId: string,
  matchupIds: string[]
): Promise<Map<string, MatchupResultSnapshot>> {
  const rows = await tx.leagueMatchup.findMany({
    where: { leagueId, id: { in: matchupIds }, status: 'FINAL' },
    select: {
      id: true,
      status: true,
      winnerMemberId: true,
      homeCategoryWins: true,
      awayCategoryWins: true,
      drawnCategories: true,
      scores: { select: { memberId: true, categoriesJson: true, pointsFor: true } },
    },
  });
  return new Map(
    rows
      .filter((row) => row.status === 'FINAL')
      .map((row) => [
        row.id,
        {
          status: row.status,
          winnerMemberId: row.winnerMemberId,
          homeCategoryWins: row.homeCategoryWins,
          awayCategoryWins: row.awayCategoryWins,
          drawnCategories: row.drawnCategories,
          scores: (row.scores ?? []).map(({ memberId, categoriesJson, pointsFor }) => ({
            memberId,
            categoriesJson,
            pointsFor,
          })),
        },
      ])
  );
}

/** JSON with sorted object keys, so jsonb's key reordering does not count as a change. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
        )
      : inner
  );
}

function comparable(snapshot: MatchupResultSnapshot): string {
  return canonical({
    ...snapshot,
    scores: [...snapshot.scores].sort((a, b) => a.memberId.localeCompare(b.memberId)),
  });
}

/** Matchups that were FINAL before and whose result the recalculation changed. */
export function changedFinalMatchups(
  before: ReadonlyMap<string, MatchupResultSnapshot>,
  after: ReadonlyMap<string, MatchupResultSnapshot>
) {
  return [...before].flatMap(([matchupId, previous]) => {
    const next = after.get(matchupId);
    return next && comparable(previous) !== comparable(next)
      ? [{ matchupId, before: previous, after: next }]
      : [];
  });
}

/** One audit row per changed FINAL matchup, written in the caller's scoring transaction. */
export async function recordFinalRoundRescores(
  tx: AuditClient,
  {
    leagueId,
    seasonId,
    round,
    actorMemberId,
    before,
    after,
  }: {
    leagueId: string;
    seasonId: string;
    round: number;
    actorMemberId: string | null;
    before: ReadonlyMap<string, MatchupResultSnapshot>;
    after: ReadonlyMap<string, MatchupResultSnapshot>;
  }
) {
  for (const change of changedFinalMatchups(before, after)) {
    await tx.leagueCompetitionAudit.create({
      data: {
        leagueId,
        actorMemberId,
        eventType: 'FINAL_ROUND_RESCORED',
        payloadJson: JSON.parse(
          JSON.stringify({
            seasonId,
            round,
            matchupId: change.matchupId,
            trigger: actorMemberId ? 'manual' : 'cron',
            before: change.before,
            after: change.after,
          })
        ) as Prisma.InputJsonValue,
      },
    });
  }
}
