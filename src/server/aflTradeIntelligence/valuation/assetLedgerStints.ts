import type { AflTradeAssetLedgerStint } from './assetLedgerContracts';
import {
  aflTradeRealizedArrivalReviewed,
  aflTradeRealizedFirstStint,
  indexAflTradeRealizedStintInputs,
  type AflTradeRealizedTradeGradeInputs,
} from './realizedTradeGrade';

/** Any player's first stint at any club from a season, by the realized grader's own rules. */
export type AflTradeAssetLedgerStintValue = (
  playerId: string,
  clubId: string,
  fromSeason: number
) => AflTradeAssetLedgerStint;

const pavKey = (playerId: string, season: number, clubId: string) =>
  `${playerId}|${season}|${clubId}`;

/**
 * Builds `stintValue` over the grader's inputs. The arrival check matches the grader's: a reviewed
 * arrival at the club in the season before `fromSeason` or in `fromSeason` itself (a trade or draft in
 * year Y starts the stint in Y + 1).
 */
export function createAflTradeAssetLedgerStintValue(
  inputs: AflTradeRealizedTradeGradeInputs
): AflTradeAssetLedgerStintValue {
  const index = indexAflTradeRealizedStintInputs(inputs);
  const pav = new Map(inputs.pav.map((row) => [pavKey(row.playerId, row.season, row.clubId), row]));
  const firstCoveredSeason = Math.min(...inputs.spellSeasons);
  return (playerId, clubId, fromSeason) => {
    const reviewed = aflTradeRealizedArrivalReviewed(
      index,
      playerId,
      clubId,
      fromSeason - 1,
      fromSeason
    );
    const stint = aflTradeRealizedFirstStint(index, playerId, clubId, fromSeason, reviewed);
    const counted = [...stint.seasonsValued, ...stint.seasonsMissingPav];
    return {
      clubId,
      startSeason: fromSeason,
      endSeason: stint.status === 'closed' && counted.length > 0 ? Math.max(...counted) : null,
      status: stint.status,
      arrivalReviewed: reviewed,
      beganBeforeCoverage: fromSeason === firstCoveredSeason && !reviewed,
      seasons: stint.seasonsValued.map((season) => ({
        season,
        pav: pav.get(pavKey(playerId, season, clubId))?.value ?? 0,
        official: index.official.get(season) === true,
      })),
      seasonsMissingPav: stint.seasonsMissingPav,
      total: stint.pavSum,
      value: Math.max(0, stint.pavSum),
    };
  };
}

/** Each player's candidate stint starts by club: every season spell and every reviewed arrival. */
export function aflTradeAssetLedgerStintStarts(
  inputs: AflTradeRealizedTradeGradeInputs
): Map<string, Map<string, Set<number>>> {
  const starts = new Map<string, Map<string, Set<number>>>();
  for (const { playerId, clubId, season } of [...inputs.seasonSpells, ...inputs.reviewedArrivals]) {
    const clubs = starts.get(playerId) ?? new Map<string, Set<number>>();
    clubs.set(clubId, (clubs.get(clubId) ?? new Set()).add(season));
    starts.set(playerId, clubs);
  }
  return starts;
}

const countsNoSeason = (stint: AflTradeAssetLedgerStint) =>
  stint.seasons.length === 0 && stint.seasonsMissingPav.length === 0;

/** One club's stints: each start not already inside an earlier stint opens a new one. */
function clubStints(
  stintValue: AflTradeAssetLedgerStintValue,
  playerId: string,
  clubId: string,
  seasons: ReadonlySet<number>
): AflTradeAssetLedgerStint[] {
  const stints: AflTradeAssetLedgerStint[] = [];
  let coveredThrough = -Infinity;
  for (const season of [...seasons].sort((left, right) => left - right)) {
    if (season <= coveredThrough) continue;
    const stint = stintValue(playerId, clubId, season);
    // A closed stint that counts no season (he left before playing here) is no stint.
    if (stint.status === 'closed' && countsNoSeason(stint)) {
      coveredThrough = season;
      continue;
    }
    stints.push(stint);
    coveredThrough = stint.endSeason ?? Infinity;
  }
  return stints;
}

/** A player's stints at every club, ordered by start season, then club. */
export function aflTradeAssetLedgerPlayerStints(
  stintValue: AflTradeAssetLedgerStintValue,
  playerId: string,
  starts: ReadonlyMap<string, ReadonlySet<number>> | undefined
): AflTradeAssetLedgerStint[] {
  return [...(starts ?? new Map<string, Set<number>>())]
    .flatMap(([clubId, seasons]) => clubStints(stintValue, playerId, clubId, seasons))
    .sort((left, right) =>
      left.startSeason !== right.startSeason
        ? left.startSeason - right.startSeason
        : left.clubId < right.clubId
          ? -1
          : left.clubId > right.clubId
            ? 1
            : 0
    );
}
