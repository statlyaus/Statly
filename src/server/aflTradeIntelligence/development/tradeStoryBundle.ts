import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import type {
  AflTradeAssetLedger,
  AflTradeAssetLedgerLabels,
} from '../valuation/assetLedgerContracts';
import type {
  AflTradePageBidMatch,
  AflTradePageModel,
} from '../valuation/realizedTradePageContracts';
import { buildAflTradeStory } from '../valuation/realizedTradeStory';
import type { AflTradeStoryNames } from '../valuation/realizedTradeStoryContracts';
import {
  aflTradeStructureSchema,
  type AflTradeStructure,
} from '../valuation/tradeStructureContracts';
import {
  AFL_TRADE_VALUE_LINES_SCHEMA_VERSION,
  type AflTradeValueLines,
} from '../valuation/valueLineContracts';
import type { AflTradeStorySampleSource } from './tradeStorySamples';

/**
 * The private trade page's genuine source (statlyaus/Statly#789, #1052): one sealed bundle of the
 * stored value lines, the trade structure they were computed on, the names the story needs and the
 * ledger's matched bids. It is built on the grading machine from governed inputs and read on a
 * development machine by `privateTradeStoryReads`; it is private, never publication evidence.
 */

export const AFL_TRADE_STORY_BUNDLE_SCHEMA_VERSION = 'afl-trade-story-bundle/v1' as const;
const BUNDLE_PREFIX = 'trade-story-bundle';

export interface AflTradeStoryBundleContent {
  readonly schemaVersion: typeof AFL_TRADE_STORY_BUNDLE_SCHEMA_VERSION;
  readonly environment: 'non_production';
  readonly structure: AflTradeStructure;
  readonly valueLines: AflTradeValueLines;
  /** Sorted [id, name] pairs: only the clubs, players and pick transfers the stories name. */
  readonly names: {
    readonly clubs: readonly (readonly [string, string])[];
    readonly players: readonly (readonly [string, string])[];
    readonly labels: readonly (readonly [string, string])[];
  };
  readonly bidMatches: readonly AflTradePageBidMatch[];
  readonly publicationEligible: false;
  readonly publicationProhibited: true;
}

export interface AflTradeStoryBundle {
  readonly bundleId: string;
  readonly content: AflTradeStoryBundleContent;
}

/** A pick transfer as the candidate carries it, enough to name it. */
export interface AflTradeStoryBundleTransfer {
  readonly transferId: string;
  readonly asset:
    | { readonly kind: 'player' }
    | {
        readonly kind: 'pick_entitlement';
        readonly draftYear: number;
        readonly nominalRound: number | null;
        readonly nominalPick: number | null;
        readonly originalClubId: string | null;
        readonly recordedLabel: string | null;
      }
    | { readonly kind: string };
}

const sorted = (map: ReadonlyMap<string, string>) =>
  [...map].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

/** How a pick transfer is named on the page: the source's own label, else its year, slot and club. */
export function aflTradeStoryPickLabel(
  asset: AflTradeStoryBundleTransfer['asset'],
  clubName: (clubId: string) => string
): string {
  if (asset.kind !== 'pick_entitlement') return 'Special draft entitlement';
  const pick = asset as Extract<AflTradeStoryBundleTransfer['asset'], { kind: 'pick_entitlement' }>;
  if (pick.recordedLabel !== null) return pick.recordedLabel;
  const slot =
    pick.nominalPick !== null
      ? `pick ${pick.nominalPick}`
      : pick.nominalRound !== null
        ? `round ${pick.nominalRound}`
        : 'pick';
  const club = pick.originalClubId === null ? '' : ` (${clubName(pick.originalClubId)})`;
  return `${pick.draftYear} ${slot}${club}`;
}

/**
 * Builds the sealed bundle. Refuses value lines that are not `afl-trade-value-lines/v3`, whose content
 * address does not match, or that were computed on another structure; a name the stories need and the
 * labels lack fails, never guessed.
 */
export function createAflTradeStoryBundle(input: {
  structure: AflTradeStructure;
  valueLines: AflTradeValueLines;
  ledger: AflTradeAssetLedger;
  labels: AflTradeAssetLedgerLabels;
  transfers: readonly AflTradeStoryBundleTransfer[];
}): AflTradeStoryBundle {
  const { structure, valueLines, ledger, labels } = input;
  verifyLines(structure, valueLines);
  const clubNames = new Map(labels.clubs.map(({ clubId, name }) => [clubId, name]));
  const playerNames = new Map(labels.players.map(({ playerId, name }) => [playerId, name]));
  const clubName = (clubId: string) => {
    const name = clubNames.get(clubId);
    if (name === undefined) throw new Error(`The bundle has no name for club ${clubId}.`);
    return name;
  };
  const playerName = (playerId: string) => {
    const name = playerNames.get(playerId);
    if (name === undefined) throw new Error(`The bundle has no name for player ${playerId}.`);
    return name;
  };

  const clubs = new Map<string, string>();
  const players = new Map<string, string>();
  const pickLabels = new Map<string, string>();
  const transfers = new Map(input.transfers.map((transfer) => [transfer.transferId, transfer]));
  for (const trade of structure.content.trades) {
    for (const { clubId } of trade.clubs) clubs.set(clubId, clubName(clubId));
    for (const leg of trade.legs) {
      if (leg.assetKind !== 'pick') continue;
      const transfer = transfers.get(leg.transferId);
      if (!transfer) throw new Error(`The bundle has no candidate transfer ${leg.transferId}.`);
      pickLabels.set(leg.transferId, aflTradeStoryPickLabel(transfer.asset, clubName));
    }
  }
  for (const asset of valueLines.content.assets) {
    if (asset.clubId !== null) clubs.set(asset.clubId, clubName(asset.clubId));
    if (asset.playerId !== null) players.set(asset.playerId, playerName(asset.playerId));
  }

  const bidMatches: AflTradePageBidMatch[] = [];
  for (const match of ledger.content.bidMatches) {
    if (match.nominee === null || match.clubId === null) continue;
    players.set(match.nominee.playerId, playerName(match.nominee.playerId));
    clubs.set(match.clubId, clubName(match.clubId));
    const leftover = match.pricing.status === 'shared' ? match.pricing.leftover : null;
    bidMatches.push({
      match,
      nomineeName: playerName(match.nominee.playerId),
      clubName: clubName(match.clubId),
      leftoverLabels:
        leftover === null
          ? []
          : leftover.boardLeftoverPickIds.map(
              () => `Leftover-points pick (${leftover.remainderPoints} points)`
            ),
    });
  }

  const content: AflTradeStoryBundleContent = {
    schemaVersion: AFL_TRADE_STORY_BUNDLE_SCHEMA_VERSION,
    environment: 'non_production',
    structure,
    valueLines,
    names: { clubs: sorted(clubs), players: sorted(players), labels: sorted(pickLabels) },
    bidMatches,
    publicationEligible: false,
    publicationProhibited: true,
  };
  return { bundleId: createAflTradeContentAddress(BUNDLE_PREFIX, content), content };
}

function verifyLines(structure: AflTradeStructure, valueLines: AflTradeValueLines) {
  aflTradeStructureSchema.parse(structure);
  if (valueLines.content.schemaVersion !== AFL_TRADE_VALUE_LINES_SCHEMA_VERSION)
    throw new Error(`The value lines are not ${AFL_TRADE_VALUE_LINES_SCHEMA_VERSION}.`);
  if (createAflTradeContentAddress('value-lines', valueLines.content) !== valueLines.valueLinesId)
    throw new Error('The value lines id does not match their content.');
  if (valueLines.content.inputs.structureId !== structure.structureId)
    throw new Error(
      `The value lines were computed on ${valueLines.content.inputs.structureId}, not ${structure.structureId}.`
    );
}

/** Checks a read bundle: its content address, the structure's and the value lines'. */
export function verifyAflTradeStoryBundle(value: unknown): AflTradeStoryBundle {
  const bundle = value as AflTradeStoryBundle;
  if (
    typeof bundle !== 'object' ||
    bundle === null ||
    typeof bundle.bundleId !== 'string' ||
    bundle.content?.schemaVersion !== AFL_TRADE_STORY_BUNDLE_SCHEMA_VERSION
  )
    throw new TypeError(`Not an ${AFL_TRADE_STORY_BUNDLE_SCHEMA_VERSION} bundle.`);
  if (createAflTradeContentAddress(BUNDLE_PREFIX, bundle.content) !== bundle.bundleId)
    throw new Error('The trade story bundle id does not match its content.');
  verifyLines(bundle.content.structure, bundle.content.valueLines);
  return bundle;
}

/** The page source over one verified bundle: the same list and load shape as the samples. */
export function createAflTradeStoryBundleSource(
  bundle: AflTradeStoryBundle
): AflTradeStorySampleSource {
  const { structure, valueLines, names, bidMatches } = bundle.content;
  const storyNames: AflTradeStoryNames = {
    clubs: new Map(names.clubs),
    players: new Map(names.players),
    labels: new Map(names.labels),
  };
  const throughSeason = valueLines.content.inputs.throughSeason;
  const source: AflTradePageModel['source'] = {
    kind: 'sealed_batch',
    label: `Genuine value lines ${valueLines.valueLinesId.slice(0, 24)}…, values to ${throughSeason}; private, not for publication`,
  };
  const trades = new Set(structure.content.trades.map(({ transactionId }) => transactionId));
  return {
    list: () => ({
      source,
      stories: structure.content.trades.map((trade) => ({
        tradeId: trade.transactionId,
        year: trade.tradeYear,
        clubNames: trade.clubs.map(({ clubId }) => storyNames.clubs.get(clubId) ?? clubId),
      })),
    }),
    load(tradeId) {
      if (!trades.has(tradeId)) return null;
      const story = buildAflTradeStory({ structure, valueLines }, tradeId, storyNames);
      const pickIds = new Set(
        story.lineage.trades.flatMap(({ assets }) => assets.map(({ assetId }) => assetId))
      );
      return {
        story,
        source,
        throughSeason,
        bidMatches: bidMatches.filter(({ match }) =>
          match.spentPicks.some(({ pickId }) => pickId !== null && pickIds.has(pickId))
        ),
      };
    },
  };
}
