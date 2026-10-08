import type { AflTradeExternalReconciliationCandidateRecord } from '../source/externalReconciliationCandidateContracts';
import { hpnDpv3ValueForPick } from '../modeling/hpnPickValueBenchmark';
import {
  AFL_TRADE_REALIZED_TRADE_GRADE_BATCH_SCHEMA_VERSION,
  AFL_TRADE_REALIZED_TRADE_GRADE_RULE_VERSION,
  createAflTradeRealizedTradeGradeBatch,
  expectedAflTradeRealizedTradeGradeClubs,
  type AflTradeRealizedGradeReason,
  type AflTradeRealizedTradeGrade,
  type AflTradeRealizedTradeGradeBatch,
  type AflTradeRealizedTradeGradeBatchContent,
  type AflTradeRealizedTradeGradeLeg,
} from './realizedTradeGradeContracts';

type CandidateContent = AflTradeExternalReconciliationCandidateRecord['content'];
type Transaction = CandidateContent['transactions'][number];
type Transfer = CandidateContent['transfers'][number];
type PickOutcome = NonNullable<CandidateContent['pickOutcomes']>[number];

/** Everything the MVP grader reads, already loaded; the grader itself does no I/O. */
export interface AflTradeRealizedTradeGradeInputs {
  candidateId: string;
  candidate: Pick<CandidateContent, 'transactions' | 'transfers' | 'pickOutcomes'>;
  /** One pinned HPN PAV calculation per season, and whether that season is official. */
  pavCalculations: readonly { season: number; calculationId: string; official: boolean }[];
  /** HPN PAV per player per season at one club, from the pinned calculations. */
  pav: readonly { playerId: string; season: number; clubId: string; value: number }[];
  /** v3 season spells: each club a player appeared for in a season. */
  seasonSpells: readonly { playerId: string; season: number; clubId: string }[];
  /** The seasons the season spells cover. A departure can only be seen in these. */
  spellSeasons: readonly number[];
  /** Current reviewed (v4) arrivals: a player's first season at a club. */
  reviewedArrivals: readonly { playerId: string; clubId: string; season: number }[];
  pickProjectionBenchmarkId: string;
  spellCutoffAt: string;
  gradedAt: string;
}

type Leg = AflTradeRealizedTradeGradeLeg;
type Ungraded = AflTradeRealizedTradeGradeBatchContent['ungraded'][number];
const SINGLE: AflTradeRealizedGradeReason = 'single_source_pick_outcome';
const sorted = (reasons: Iterable<AflTradeRealizedGradeReason>) => [...new Set(reasons)].sort();

interface Stint {
  status: 'closed' | 'open';
  seasonsValued: number[];
  seasonsMissingPav: number[];
  value: number;
  appearedAfter: boolean;
}

function indexInputs(inputs: AflTradeRealizedTradeGradeInputs) {
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
type Index = ReturnType<typeof indexInputs>;

/**
 * The first stint of a player at a club from `firstSeason`. It ends at the first covered season he
 * appears for another club (that season's PAV at this club still counts, since he left during it) or
 * before a later reviewed arrival at the same club (delisted and redrafted is a new stint). Uncovered
 * seasons cannot show a departure, so the stint runs through them with their PAV listed as missing. A
 * stint that never ends inside the covered seasons is open.
 */
function firstStint(
  index: Index,
  playerId: string,
  clubId: string,
  firstSeason: number,
  arrivedReviewed: boolean
): Stint {
  const stint: Stint = {
    status: 'open',
    seasonsValued: [],
    seasonsMissingPav: [],
    value: 0,
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
        stint.value += index.pav.get(`${playerId}|${season}|${clubId}`) ?? 0;
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

/** A stint none of whose seasons has a pinned PAV calculation has no known value at all. */
const noPavCoverage = (stint: Stint) =>
  stint.seasonsValued.length === 0 && stint.seasonsMissingPav.length > 0;

function stintReasons(index: Index, stint: Stint): AflTradeRealizedGradeReason[] {
  const reasons: AflTradeRealizedGradeReason[] = [];
  if (stint.status === 'open') reasons.push('stint_open');
  if (stint.seasonsMissingPav.length) reasons.push('pav_seasons_missing');
  if (stint.seasonsValued.some((season) => index.official.get(season) === false))
    reasons.push('pav_season_not_official');
  if (!stint.appearedAfter && stint.status === 'open') reasons.push('no_appearances_after_trade');
  return reasons;
}

/** A reviewed arrival at the club for this move: first season there between `from` and `through`. */
function arrivalReviewed(
  index: Index,
  playerId: string,
  clubId: string,
  from: number,
  through: number
) {
  return (index.arrivals.get(`${playerId}|${clubId}`) ?? []).some(
    (season) => season >= from && season <= through
  );
}

function atTradeView(
  inputs: AflTradeRealizedTradeGradeInputs,
  index: Index,
  transfer: Transfer,
  tradeYear: number
): Leg['atTrade'] {
  const asset = transfer.asset;
  if (asset.kind === 'player') {
    if (!index.official.has(tradeYear) || !asset.playerId)
      return { kind: 'unavailable', reason: 'trade_season_pav_missing' };
    return {
      kind: 'player_trade_season_pav',
      season: tradeYear,
      value: index.pav.get(`${asset.playerId}|${tradeYear}|${transfer.fromClubId}`) ?? 0,
    };
  }
  if (asset.kind !== 'pick_entitlement' || asset.draftType !== 'national')
    return { kind: 'unavailable', reason: 'pick_outside_projection_domain' };
  if (asset.nominalPick === null)
    return { kind: 'unavailable', reason: 'future_pick_slot_unknown' };
  if (asset.nominalPick > 90)
    return { kind: 'unavailable', reason: 'pick_outside_projection_domain' };
  return {
    kind: 'pick_projection',
    benchmarkId: inputs.pickProjectionBenchmarkId,
    selectionNumber: asset.nominalPick,
    value: hpnDpv3ValueForPick(asset.nominalPick),
  };
}

// The batch's club id format (aflTradePublicIdSchema). A club the batch cannot name is unresolved.
const representableClub = (clubId: string | null): clubId is string =>
  !!clubId && clubId.length <= 160 && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(clubId);

/** True when `later` cannot have happened before `earlier`. */
function notBefore(later: Transaction, earlier: Transaction) {
  if (later.seasonYear !== earlier.seasonYear) return later.seasonYear > earlier.seasonYear;
  if (later.occurredOn && earlier.occurredOn) return later.occurredOn > earlier.occurredOn;
  return true;
}

/** Grades every trade in the candidate into one sealed private batch. */
export function gradeAflTradesOnRealizedValue(
  inputs: AflTradeRealizedTradeGradeInputs
): AflTradeRealizedTradeGradeBatch {
  const index = indexInputs(inputs);
  const transfersByTransaction = new Map<string, Transfer[]>();
  for (const transfer of inputs.candidate.transfers)
    transfersByTransaction.set(transfer.transactionId, [
      ...(transfersByTransaction.get(transfer.transactionId) ?? []),
      transfer,
    ]);
  // A trade the batch cannot represent as legs is named, never dropped.
  const ungraded: Ungraded[] = [];
  const transactions = new Map<string, Transaction>();
  for (const transaction of inputs.candidate.transactions) {
    if (transaction.transactionType !== 'trade') continue;
    const transfers = transfersByTransaction.get(transaction.transactionId) ?? [];
    if (transfers.length === 0)
      ungraded.push({ transactionId: transaction.transactionId, reason: 'no_transfers' });
    else if (
      transfers.some(
        ({ fromClubId, toClubId }) =>
          !representableClub(fromClubId) || !representableClub(toClubId) || fromClubId === toClubId
      )
    )
      ungraded.push({ transactionId: transaction.transactionId, reason: 'club_unresolved' });
    else transactions.set(transaction.transactionId, transaction);
  }
  const transfersByPick = new Map<string, Transfer[]>();
  for (const transfer of inputs.candidate.transfers)
    if (transactions.has(transfer.transactionId) && transfer.asset.kind === 'pick_entitlement')
      transfersByPick.set(transfer.asset.pickId, [
        ...(transfersByPick.get(transfer.asset.pickId) ?? []),
        transfer,
      ]);
  const outcomes = new Map<string, PickOutcome>(
    (inputs.candidate.pickOutcomes ?? []).map((outcome) => [outcome.transferId, outcome])
  );
  const graded = new Map<string, AflTradeRealizedTradeGrade>();

  const blocked = (
    base: Omit<Leg, 'state' | 'basis' | 'reasons'>,
    reasons: AflTradeRealizedGradeReason[]
  ): Leg => ({ ...base, state: 'blocked', basis: 'unavailable', reasons: sorted(reasons) }) as Leg;

  function gradeLeg(transfer: Transfer, transaction: Transaction, stack: readonly string[]): Leg {
    const asset = transfer.asset;
    const tradeYear = transaction.seasonYear;
    const receiving = transfer.toClubId!;
    const base = {
      transferId: transfer.transferId,
      assetKind: asset.kind === 'player' ? ('player' as const) : ('pick' as const),
      sendingClubId: transfer.fromClubId!,
      receivingClubId: receiving,
      atTrade: atTradeView(inputs, index, transfer, tradeYear),
    };
    if (asset.kind === 'player') {
      if (!asset.playerId) return blocked(base, ['player_identity_unresolved']);
      const reviewed = arrivalReviewed(index, asset.playerId, receiving, tradeYear, tradeYear + 1);
      const stint = firstStint(index, asset.playerId, receiving, tradeYear + 1, reviewed);
      if (noPavCoverage(stint)) return blocked(base, ['hpn_pav_head_missing']);
      const reasons = stintReasons(index, stint);
      if (!reviewed) reasons.push('arrival_unreviewed');
      return {
        ...base,
        state: 'valued',
        basis: 'player_first_stint',
        realizedValue: stint.value,
        stint: {
          status: stint.status,
          seasonsValued: stint.seasonsValued,
          seasonsMissingPav: stint.seasonsMissingPav,
        },
        reasons: sorted(reasons),
      };
    }
    if (asset.kind !== 'pick_entitlement')
      return blocked(base, ['special_entitlement_unsupported']);
    const outcome = outcomes.get(transfer.transferId);
    if (!outcome || outcome.outcomeStatus === 'unresolved')
      return blocked(base, ['pick_outcome_unresolved']);
    if (outcome.outcomeStatus === 'pending') return blocked(base, ['pick_outcome_pending']);
    if (outcome.disposition === 'selected') {
      if (!outcome.playerId) return blocked(base, ['player_identity_unresolved']);
      // A pick is drafted at or after the trade; an earlier draft year cannot be this pick's outcome.
      if (asset.draftYear < tradeYear) return blocked(base, ['pick_outcome_unresolved']);
      const reviewed = arrivalReviewed(
        index,
        outcome.playerId,
        receiving,
        asset.draftYear,
        asset.draftYear + 1
      );
      const stint = firstStint(index, outcome.playerId, receiving, asset.draftYear + 1, reviewed);
      if (noPavCoverage(stint)) return blocked(base, ['hpn_pav_head_missing']);
      const reasons = [SINGLE, ...stintReasons(index, stint)];
      if (!reviewed) reasons.push('arrival_unreviewed');
      return {
        ...base,
        state: 'valued',
        basis: 'pick_selected_first_stint',
        realizedValue: stint.value,
        stint: {
          status: stint.status,
          seasonsValued: stint.seasonsValued,
          seasonsMissingPav: stint.seasonsMissingPav,
        },
        reasons: sorted(reasons),
      };
    }
    if (outcome.disposition === 'not_used') {
      if (outcome.nominationBasis === 'club_took_no_nominated_player')
        return {
          ...base,
          state: 'valued',
          basis: 'pick_not_used_no_nominee',
          realizedValue: 0,
          reasons: [SINGLE],
        };
      if (outcome.nominationBasis === 'club_took_nominated_player')
        return {
          ...base,
          state: 'excluded',
          basis: 'pick_not_used_nominee_excluded',
          reasons: sorted([SINGLE, 'not_used_nominee_excluded']),
        };
      return blocked(base, ['not_used_no_access_evidence']);
    }
    // Traded on: follow the pick into the one later trade where its club gave it away.
    const onwardTransfers = (transfersByPick.get(asset.pickId) ?? []).filter((candidate) => {
      const onwardTransaction = transactions.get(candidate.transactionId)!;
      return (
        candidate.fromClubId === receiving &&
        candidate.transactionId !== transfer.transactionId &&
        notBefore(onwardTransaction, transaction)
      );
    });
    if (onwardTransfers.length !== 1) return blocked(base, ['traded_on_return_unlinked']);
    const onwardTransfer = onwardTransfers[0]!;
    if (stack.includes(onwardTransfer.transactionId))
      return blocked(base, ['traded_on_return_blocked']);
    const onward = gradeTrade(onwardTransfer.transactionId, stack);
    if (onward.state === 'blocked') return blocked(base, ['traded_on_return_blocked']);
    const pickLeg = onward.legs.find((leg) => leg.transferId === onwardTransfer.transferId)!;
    if (pickLeg.state === 'excluded')
      return {
        ...base,
        state: 'excluded',
        basis: 'pick_traded_on_return_unallocated',
        onwardTransactionId: onward.transactionId,
        reasons: sorted([SINGLE, 'traded_on_return_unallocated']),
      };
    const club = onward.clubs.find(({ clubId }) => clubId === receiving)!;
    const given = onward.legs.filter((leg) => leg.sendingClubId === receiving);
    const returnValue = club.received!;
    const givenUp = club.givenUp!;
    const weight = pickLeg.state === 'valued' ? pickLeg.realizedValue : 0;
    const allocation =
      given.length === 1 ? 'sole_asset' : givenUp > 0 ? 'relative_value' : ('equal_split' as const);
    const share =
      allocation === 'sole_asset'
        ? 1
        : allocation === 'relative_value'
          ? weight / givenUp
          : 1 / given.length;
    const reasons: AflTradeRealizedGradeReason[] = [SINGLE];
    if (allocation === 'equal_split') reasons.push('equal_split_tiebreak');
    if (onward.state === 'provisional') reasons.push('traded_on_return_provisional');
    return {
      ...base,
      state: 'valued',
      basis: 'pick_traded_on_return',
      realizedValue: share * returnValue,
      onward: {
        transactionId: onward.transactionId,
        allocation,
        returnValue,
        givenAssetCount: given.length,
        weight: allocation === 'relative_value' ? weight : null,
        weightTotal: allocation === 'relative_value' ? givenUp : null,
        share,
      },
      reasons: sorted(reasons),
    };
  }

  function gradeTrade(
    transactionId: string,
    stack: readonly string[] = []
  ): AflTradeRealizedTradeGrade {
    const done = graded.get(transactionId);
    if (done) return done;
    const transaction = transactions.get(transactionId)!;
    const legs = [...transfersByTransaction.get(transactionId)!]
      .sort((left, right) => (left.transferId < right.transferId ? -1 : 1))
      .map((transfer) => gradeLeg(transfer, transaction, [...stack, transactionId]));
    const reasons = sorted(legs.flatMap((leg) => leg.reasons));
    const trade: AflTradeRealizedTradeGrade = {
      transactionId,
      tradeYear: transaction.seasonYear,
      state: legs.some((leg) => leg.state === 'blocked')
        ? 'blocked'
        : reasons.length
          ? 'provisional'
          : 'complete',
      reasons,
      clubs: expectedAflTradeRealizedTradeGradeClubs(legs),
      legs,
    };
    graded.set(transactionId, trade);
    return trade;
  }

  if (transactions.size === 0 && ungraded.length === 0)
    throw new Error('The candidate holds no trades to grade.');
  const trades = [...transactions.keys()].sort().map((transactionId) => gradeTrade(transactionId));
  return createAflTradeRealizedTradeGradeBatch({
    schemaVersion: AFL_TRADE_REALIZED_TRADE_GRADE_BATCH_SCHEMA_VERSION,
    ruleVersion: AFL_TRADE_REALIZED_TRADE_GRADE_RULE_VERSION,
    environment: 'non_production',
    valueUnit: 'career_pav',
    inputs: {
      candidateId: inputs.candidateId,
      pavCalculations: [...inputs.pavCalculations].sort(
        (left, right) => left.season - right.season
      ),
      pickProjectionBenchmarkId: inputs.pickProjectionBenchmarkId,
      spellCutoffAt: inputs.spellCutoffAt,
    },
    gradedAt: inputs.gradedAt,
    trades,
    ungraded: ungraded.sort((left, right) => (left.transactionId < right.transactionId ? -1 : 1)),
    summary: {
      complete: trades.filter(({ state }) => state === 'complete').length,
      provisional: trades.filter(({ state }) => state === 'provisional').length,
      blocked: trades.filter(({ state }) => state === 'blocked').length,
      ungraded: ungraded.length,
    },
    publicationEligible: false,
    publicationProhibited: true,
    limitation:
      'Private local non-production realized trade grade in career_pav; single-source pick outcomes; not public factual, publication, production or activation authority.',
  });
}
