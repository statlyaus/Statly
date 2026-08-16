import {
  createAflTradeHpnReviewedSeasonDecision,
  sealAflTradeHpnReviewedSeasonUniverse,
} from '../modeling/hpnReviewedSeasonUniverse';
import { PostgresAflTradeHpnReviewedSeasonUniverseRepository } from '../modeling/postgresHpnReviewedSeasonUniverseRepository';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { assembleLocalAflTradeHpnReviewedSeasonUniverseCandidate } from './localHpnReviewedSeasonUniverseAssembler';

export async function reviewLocalAflTradeHpnSeasonUniverses(
  client: AflOutcomeSqlClient,
  input: Readonly<{
    fromSeason: number;
    throughSeason: number;
    reviewerId: string;
  }>
) {
  if (
    !Number.isInteger(input.fromSeason) ||
    !Number.isInteger(input.throughSeason) ||
    input.fromSeason < 1998 ||
    input.throughSeason < input.fromSeason ||
    input.throughSeason > 2200
  ) {
    throw new TypeError('A valid HPN season review range is required.');
  }
  const repository = new PostgresAflTradeHpnReviewedSeasonUniverseRepository(client);
  const reviewed = [];
  for (let seasonYear = input.fromSeason; seasonYear <= input.throughSeason; seasonYear += 1) {
    const assembled = await assembleLocalAflTradeHpnReviewedSeasonUniverseCandidate(
      client,
      seasonYear
    );
    const decision = createAflTradeHpnReviewedSeasonDecision({
      ...assembled,
      decision: 'approved',
      reviewerId: input.reviewerId,
      rationale:
        'Approve every exact staged numerical HPN field for private calculation; ' +
        'unresolved player identities remain quarantined and unavailable.',
      decidedAt: assembled.candidate.content.createdAt,
    });
    const reviewedSeason = sealAflTradeHpnReviewedSeasonUniverse({
      ...assembled,
      decision,
    });
    await repository.register({ ...assembled, decision, reviewedSeason });
    reviewed.push(reviewedSeason);
  }
  return reviewed;
}
