import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import {
  AFL_TRADE_ASSET_LEDGER_LIMITATION,
  AFL_TRADE_ASSET_LEDGER_SCHEMA_VERSION,
  type AflTradeAssetLedger,
  type AflTradeAssetLedgerClub,
  type AflTradeAssetLedgerContent,
  type AflTradeAssetLedgerLabels,
  type AflTradeAssetLedgerOutcomeKind,
  type AflTradeAssetLedgerPick,
  type AflTradeAssetLedgerPickOutcome,
  type AflTradeAssetLedgerPlayer,
} from './assetLedgerContracts';
import {
  aflTradeAssetLedgerPickIdentities,
  aflTradeAssetLedgerPickTrails,
} from './assetLedgerPickHops';
import {
  aflTradeAssetLedgerPickOutcome,
  createAflTradeAssetLedgerOutcomeSources,
} from './assetLedgerPickOutcome';
import {
  aflTradeAssetLedgerPlayerStints,
  aflTradeAssetLedgerStintStarts,
  createAflTradeAssetLedgerStintValue,
  type AflTradeAssetLedgerStintValue,
} from './assetLedgerStints';
import type { AflTradeRealizedTradeGradeInputs } from './realizedTradeGrade';

/**
 * The asset ledger read model (issue 789): one joined-up, private view of every player's club stints
 * and every pick's custody and outcome, built from the realized grader's own inputs
 * (`loadAflTradeRealizedTradeGradeInputs`) and its own stint rules. Pure: labels are injected.
 */
export interface AflTradeAssetLedgerReadModel {
  readonly ledger: AflTradeAssetLedger;
  /** Any player's first stint at any club from a season. */
  readonly stintValue: AflTradeAssetLedgerStintValue;
  /** A ledger pick's outcome, or undefined for a pick id the ledger does not hold. */
  readonly pickOutcome: (pickId: string) => AflTradeAssetLedgerPickOutcome | undefined;
}

const byCodeUnit = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/** Every player id the inputs or labels name, so no player in evidence is left out. */
function playerIdsOf(inputs: AflTradeRealizedTradeGradeInputs, labels: AflTradeAssetLedgerLabels) {
  const { candidate } = inputs;
  return new Set<string>([
    ...labels.players.map(({ playerId }) => playerId),
    ...inputs.seasonSpells.map(({ playerId }) => playerId),
    ...inputs.reviewedArrivals.map(({ playerId }) => playerId),
    ...inputs.pav.map(({ playerId }) => playerId),
    ...(candidate.draftSelections ?? []).flatMap(({ playerId }) => (playerId ? [playerId] : [])),
    ...candidate.transfers.flatMap(({ asset }) =>
      asset.kind === 'player' && asset.playerId ? [asset.playerId] : []
    ),
  ]);
}

/** Every club id the inputs or labels name. */
function clubsOf(
  inputs: AflTradeRealizedTradeGradeInputs,
  labels: AflTradeAssetLedgerLabels
): AflTradeAssetLedgerClub[] {
  const names = new Map(labels.clubs.map(({ clubId, name }) => [clubId, name]));
  const { candidate } = inputs;
  const ids = new Set<string>([
    ...names.keys(),
    ...inputs.seasonSpells.map(({ clubId }) => clubId),
    ...inputs.reviewedArrivals.map(({ clubId }) => clubId),
    ...candidate.transfers.flatMap(({ fromClubId, toClubId }) =>
      [fromClubId, toClubId].filter((id): id is string => id !== null)
    ),
    ...(candidate.draftSelections ?? []).flatMap(({ clubId }) => (clubId ? [clubId] : [])),
    ...(candidate.pickCustody ?? []).flatMap(({ originalClubId, currentClubId }) =>
      [originalClubId, currentClubId].filter((id): id is string => id !== null)
    ),
    ...candidate.transfers.flatMap(({ asset }) =>
      asset.kind === 'pick_entitlement' && asset.originalClubId ? [asset.originalClubId] : []
    ),
  ]);
  return [...ids].sort(byCodeUnit).map((clubId) => ({ clubId, name: names.get(clubId) ?? null }));
}

function playersOf(
  inputs: AflTradeRealizedTradeGradeInputs,
  labels: AflTradeAssetLedgerLabels,
  stintValue: AflTradeAssetLedgerStintValue
): AflTradeAssetLedgerPlayer[] {
  const names = new Map(labels.players.map(({ playerId, name }) => [playerId, name]));
  const starts = aflTradeAssetLedgerStintStarts(inputs);
  return [...playerIdsOf(inputs, labels)].sort(byCodeUnit).map((playerId) => ({
    playerId,
    name: names.get(playerId) ?? null,
    stints: aflTradeAssetLedgerPlayerStints(stintValue, playerId, starts.get(playerId)),
  }));
}

function picksOf(
  inputs: AflTradeRealizedTradeGradeInputs,
  stintValue: AflTradeAssetLedgerStintValue
): AflTradeAssetLedgerPick[] {
  const trails = aflTradeAssetLedgerPickTrails(inputs);
  const sources = createAflTradeAssetLedgerOutcomeSources(inputs.candidate, stintValue);
  return [...aflTradeAssetLedgerPickIdentities(inputs.candidate).values()]
    .sort((left, right) => byCodeUnit(left.pickId, right.pickId))
    .map((pick) => {
      const trail = trails.get(pick.pickId) ?? { hopOrder: 'trail' as const, hops: [] };
      return {
        ...pick,
        hopOrder: trail.hopOrder,
        hops: trail.hops,
        outcome: aflTradeAssetLedgerPickOutcome(sources, pick, trail),
      };
    });
}

function summaryOf(
  players: readonly AflTradeAssetLedgerPlayer[],
  picks: readonly AflTradeAssetLedgerPick[]
): AflTradeAssetLedgerContent['summary'] {
  const outcomes: Record<AflTradeAssetLedgerOutcomeKind, number> = {
    selected: 0,
    not_used: 0,
    matched_bid: 0,
    passed: 0,
    future: 0,
    unresolved: 0,
  };
  for (const { outcome } of picks) outcomes[outcome.kind]++;
  const stints = players.flatMap((player) => player.stints);
  return {
    players: players.length,
    playersWithoutName: players.filter(({ name }) => name === null).length,
    stints: stints.length,
    openStints: stints.filter(({ status }) => status === 'open').length,
    picks: picks.length,
    outcomes,
  };
}

/** Builds and seals the ledger, and returns it with its lookup helpers. */
export function createAflTradeAssetLedger(
  inputs: AflTradeRealizedTradeGradeInputs,
  labels: AflTradeAssetLedgerLabels
): AflTradeAssetLedgerReadModel {
  const stintValue = createAflTradeAssetLedgerStintValue(inputs);
  const players = playersOf(inputs, labels, stintValue);
  const picks = picksOf(inputs, stintValue);
  const content: AflTradeAssetLedgerContent = {
    schemaVersion: AFL_TRADE_ASSET_LEDGER_SCHEMA_VERSION,
    environment: 'non_production',
    valueUnit: 'hpn_pav',
    inputs: {
      candidateId: inputs.candidateId,
      pavCalculations: [...inputs.pavCalculations].sort(
        (left, right) => left.season - right.season
      ),
      spellSeasons: [...inputs.spellSeasons].sort((left, right) => left - right),
      spellCutoffAt: inputs.spellCutoffAt,
    },
    builtAt: inputs.gradedAt,
    clubs: clubsOf(inputs, labels),
    players,
    picks,
    summary: summaryOf(players, picks),
    publicationEligible: false,
    publicationProhibited: true,
    limitation: AFL_TRADE_ASSET_LEDGER_LIMITATION,
  };
  const outcomes = new Map(picks.map((pick) => [pick.pickId, pick.outcome]));
  return {
    ledger: { ledgerId: createAflTradeContentAddress('asset-ledger', content), content },
    stintValue,
    pickOutcome: (pickId) => outcomes.get(pickId),
  };
}
