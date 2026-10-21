import type { AflTradeGradingInputs } from './gradingInputs';

/**
 * A player's first stint at a club, the realized-value rule (whole first stint at the receiving club,
 * no cap, return stints excluded). The asset ledger (`assetLedgerStints.ts`) reads every stint
 * through these rules, so a ledger stint and a value line's stint cannot drift.
 */
export interface AflTradeStint {
  status: 'closed' | 'open';
  seasonsValued: number[];
  seasonsMissingPav: number[];
  /** The signed HPN PAV sum of the valued seasons. */
  pavSum: number;
  appearedAfter: boolean;
}

type StintInputs = Pick<
  AflTradeGradingInputs,
  'pav' | 'seasonSpells' | 'reviewedArrivals' | 'pavCalculations' | 'spellSeasons'
>;

/** The stint rules' lookups over one candidate's inputs. */
export function indexAflTradeStintInputs(inputs: StintInputs) {
  const pav = new Map(
    inputs.pav.map((row) => [`${row.playerId}|${row.season}|${row.clubId}`, row.value])
  );
  const spells = new Map<string, Set<string>>();
  for (const row of inputs.seasonSpells) {
    const key = `${row.playerId}|${row.season}`;
    spells.set(key, (spells.get(key) ?? new Set()).add(row.clubId));
  }
  const arrivals = new Map<string, number[]>();
  for (const row of inputs.reviewedArrivals) {
    const key = `${row.playerId}|${row.clubId}`;
    arrivals.set(key, [...(arrivals.get(key) ?? []), row.season]);
  }
  const official = new Map(inputs.pavCalculations.map((row) => [row.season, row.official]));
  const spellSeasons = new Set(inputs.spellSeasons);
  const lastSeason = Math.max(
    0,
    ...inputs.pavCalculations.map(({ season }) => season),
    ...inputs.spellSeasons
  );
  return { pav, spells, arrivals, official, spellSeasons, lastSeason };
}
export type AflTradeStintIndex = ReturnType<typeof indexAflTradeStintInputs>;

/**
 * The first stint of a player at a club from `firstSeason`. It ends at the first covered season he
 * appears for another club (that season's PAV at this club still counts, since he left during it) or
 * before a later reviewed arrival at the same club (delisted and redrafted is a new stint). Uncovered
 * seasons cannot show a departure, so the stint runs through them with their PAV listed as missing. A
 * stint that never ends inside the covered seasons is open. HPN PAV is signed, so the sum may be below 0.
 */
export function aflTradeFirstStint(
  index: AflTradeStintIndex,
  playerId: string,
  clubId: string,
  firstSeason: number,
  arrivedReviewed: boolean
): AflTradeStint {
  const stint: AflTradeStint = {
    status: 'open',
    seasonsValued: [],
    seasonsMissingPav: [],
    pavSum: 0,
    appearedAfter: false,
  };
  // A later reviewed arrival at the same club starts a new stint, but only once this move's own arrival
  // is reviewed; otherwise the later record may be this move's arrival, recorded late.
  const reArrival = arrivedReviewed
    ? Math.min(
        ...(index.arrivals.get(`${playerId}|${clubId}`) ?? []).filter(
          (season) => season > firstSeason
        )
      )
    : Infinity;
  for (let season = firstSeason; season <= index.lastSeason; season++) {
    if (season >= reArrival) {
      stint.status = 'closed';
      break;
    }
    const clubs = index.spells.get(`${playerId}|${season}`);
    if (clubs?.size) stint.appearedAfter = true;
    const departed =
      index.spellSeasons.has(season) && !!clubs && [...clubs].some((club) => club !== clubId);
    const playedHere = !!clubs?.has(clubId);
    if (!departed || playedHere) {
      if (index.official.has(season)) {
        stint.seasonsValued.push(season);
        stint.pavSum += index.pav.get(`${playerId}|${season}|${clubId}`) ?? 0;
      } else {
        stint.seasonsMissingPav.push(season);
      }
    }
    if (departed) {
      stint.status = 'closed';
      break;
    }
  }
  return stint;
}

/** A reviewed arrival at the club for this move: first season there between `from` and `through`. */
export function aflTradeArrivalReviewed(
  index: AflTradeStintIndex,
  playerId: string,
  clubId: string,
  from: number,
  through: number
) {
  return (index.arrivals.get(`${playerId}|${clubId}`) ?? []).some(
    (season) => season >= from && season <= through
  );
}
