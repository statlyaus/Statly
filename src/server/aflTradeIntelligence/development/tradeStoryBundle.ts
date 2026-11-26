import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import { aflTradeAssetLedgerLeftoverParts } from '../valuation/assetLedgerBidLeftovers';
import type {
  AflTradeAssetLedger,
  AflTradeAssetLedgerBidMatch,
  AflTradeAssetLedgerBidSpentPick,
  AflTradeAssetLedgerLabels,
} from '../valuation/assetLedgerContracts';
import type {
  AflTradePageBidMatch,
  AflTradePageModel,
} from '../valuation/realizedTradePageContracts';
import { buildAflTradeClubChains } from '../valuation/clubTradeChains';
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
import { aflTradeStoryListResults } from './tradeStoryListResults';
import type { AflTradeStorySampleSource } from './tradeStorySamples';

/**
 * The private trade page's genuine source (statlyaus/Statly#789, #1052): one sealed bundle of the
 * stored value lines, the trade structure they were computed on, the names the story needs and the
 * ledger's matched bids. It is built on the grading machine from governed inputs and read on a
 * development machine by `privateTradeStoryReads`; it is private, never publication evidence.
 */

export const AFL_TRADE_STORY_BUNDLE_SCHEMA_VERSION = 'afl-trade-story-bundle/v1' as const;

/**
 * A club's name on the page, where its canonical record still carries a historical name (#789 step 7
 * polish, 2026-10-23). Footscray has been the Western Bulldogs since 1997; the canonical club's
 * `current_name` is to be corrected in the outcomes data, after which this map can go. Applied when a
 * bundle is built and again when one is read, so a bundle built before the fix shows the AFL name too.
 */
export const AFL_TRADE_STORY_CLUB_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  Footscray: 'Western Bulldogs',
};

const displayClubName = (name: string) => AFL_TRADE_STORY_CLUB_DISPLAY_NAMES[name] ?? name;
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
        readonly pickId?: string;
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

/** Names in a sentence: "Melbourne", "Melbourne and Sydney", "Melbourne, Port Adelaide and Sydney". */
export function aflTradeStoryNameList(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** Whose compensation a pick was, from its order row's origin; null when the row does not say. */
function compensationText(label: string | undefined): string | null {
  const freeAgency =
    label === undefined ? null : /^Band [1-5] Free Agency Comp for (.+)$/u.exec(label);
  return freeAgency ? `compensation for losing ${freeAgency[1]} in free agency` : null;
}

/**
 * How the page names a pick a Draftguru order row spent on a bid (owner, 2026-11-24): its live slot,
 * then where it came from, "Pick 13 (from Melbourne via Port Adelaide)". A club's own pick is just
 * "Pick 6", and a compensation pick says whose compensation it was when its row says (2026-11-26). A
 * board's spent pick keeps the board's label. Any club without a name leaves the slot alone.
 */
export function aflTradeStoryOrderSpentLabel(
  pick: AflTradeAssetLedgerBidSpentPick,
  holderClubId: string | null,
  clubName: (clubId: string) => string | undefined
): string {
  if (pick.asPick === undefined) return pick.label;
  const slot = `Pick ${pick.asPick}`;
  if (pick.originKind === 'compensation')
    return `${slot} (${compensationText(pick.compensationLabel) ?? 'compensation pick'})`;
  if (pick.originKind === 'leftover_points') return `${slot} (from leftover points)`;
  if (pick.originKind !== 'entitlement' || pick.originalClubId === null) return slot;
  const via = pick.viaClubIds ?? [];
  if (pick.originalClubId === holderClubId && via.length === 0) return slot;
  const names = [pick.originalClubId, ...via].map((clubId) =>
    clubId === null ? undefined : clubName(clubId)
  );
  if (names.some((name) => name === undefined)) return slot;
  const [from, ...through] = names as string[];
  return `${slot} (from ${from}${through.length > 0 ? ` via ${aflTradeStoryNameList(through)}` : ''})`;
}

/**
 * What a matched bid's leftover points became, as a phrase the page puts after "which became"
 * (2026-11-26): "a new pick 13, used on Jake Eime", "a new pick, used to match the bid for Jaspa
 * Fletcher", "a new pick that was not used", or "a new pick" when the evidence does not say. Empty
 * when no leftover pick is listed.
 */
export function aflTradeStoryLeftoverLabels(
  match: AflTradeAssetLedgerBidMatch,
  playerName: (playerId: string) => string | undefined,
  bidMatches: readonly AflTradeAssetLedgerBidMatch[] = [match]
): string[] {
  const leftover = match.pricing.status === 'shared' ? match.pricing.leftover : null;
  if (leftover === null) return [];
  const use = leftover.use;
  if (use?.status === 'selected') {
    const name = playerName(use.playerId);
    const pick = `a new pick ${use.selectionNumber}`;
    return [name === undefined ? pick : `${pick}, used on ${name}`];
  }
  if (use?.status === 'spent') {
    const later = bidMatches.find(({ bidMatchId }) => bidMatchId === use.bidMatchId);
    const name = later?.nominee ? playerName(later.nominee.playerId) : undefined;
    return [name === undefined ? 'a new pick' : `a new pick, used to match the bid for ${name}`];
  }
  if (use?.status === 'not_used') return ['a new pick that was not used'];
  const listed = match.orderLeftovers ?? leftover.boardLeftoverPickIds.map(() => null);
  if (listed.length === 0) return [];
  const [only] = listed;
  return [
    listed.length === 1 && only?.pickNumber != null
      ? `a new pick ${only.pickNumber}`
      : 'a new pick',
  ];
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
  /**
   * The candidate's pick custody: a pick transfer that names no original club is labelled with the one
   * original club its custody rows name (2026-10-23), never a guess when they name none or several.
   */
  custody?: readonly { pickId: string; originalClubId: string | null }[];
}): AflTradeStoryBundle {
  const { structure, valueLines, ledger, labels } = input;
  verifyLines(structure, valueLines);
  const clubNames = new Map(
    labels.clubs.map(({ clubId, name }) => [clubId, displayClubName(name)])
  );
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
  const custodyClubs = new Map<string, Set<string>>();
  for (const row of input.custody ?? [])
    if (row.originalClubId !== null)
      custodyClubs.set(
        row.pickId,
        (custodyClubs.get(row.pickId) ?? new Set()).add(row.originalClubId)
      );
  const withCustodyClub = (asset: AflTradeStoryBundleTransfer['asset']) => {
    if (asset.kind !== 'pick_entitlement') return asset;
    const pick = asset as Extract<
      AflTradeStoryBundleTransfer['asset'],
      { kind: 'pick_entitlement' }
    >;
    const clubs = pick.pickId === undefined ? undefined : custodyClubs.get(pick.pickId);
    return pick.originalClubId === null && clubs?.size === 1
      ? { ...pick, originalClubId: [...clubs][0]! }
      : asset;
  };
  for (const trade of structure.content.trades) {
    for (const { clubId } of trade.clubs) clubs.set(clubId, clubName(clubId));
    for (const leg of trade.legs) {
      if (leg.assetKind !== 'pick') continue;
      const transfer = transfers.get(leg.transferId);
      if (!transfer) throw new Error(`The bundle has no candidate transfer ${leg.transferId}.`);
      pickLabels.set(
        leg.transferId,
        aflTradeStoryPickLabel(withCustodyClub(transfer.asset), clubName)
      );
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
    // The players the last spent pick also carries through its leftover pick (2026-11-26).
    const leftoverPlayers = aflTradeAssetLedgerLeftoverParts(ledger.content.bidMatches, match).map(
      ({ playerId, whole }) => {
        players.set(playerId, playerName(playerId));
        return { name: playerName(playerId), whole };
      }
    );
    bidMatches.push({
      // An order bid's spent picks are named by their slot and route; a board's keep its labels.
      match:
        match.source === 'draftguru_order'
          ? {
              ...match,
              spentPicks: match.spentPicks.map((pick) => ({
                ...pick,
                label: aflTradeStoryOrderSpentLabel(pick, match.clubId, (id) => clubNames.get(id)),
              })),
            }
          : match,
      nomineeName: playerName(match.nominee.playerId),
      clubName: clubName(match.clubId),
      leftoverLabels: aflTradeStoryLeftoverLabels(
        match,
        (id) => playerNames.get(id),
        ledger.content.bidMatches
      ),
      ...(leftoverPlayers.length > 0 ? { leftoverPlayers } : {}),
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

/**
 * The page source over one verified bundle: the same list and load shape as the samples. The label
 * says "private" unless the caller is the public reader showing an owner-approved bundle.
 */
export function createAflTradeStoryBundleSource(
  bundle: AflTradeStoryBundle,
  options: { readonly audience: 'private' | 'public' } = { audience: 'private' }
): AflTradeStorySampleSource {
  const { structure, valueLines, names, bidMatches } = bundle.content;
  const storyNames: AflTradeStoryNames = {
    clubs: new Map(names.clubs.map(([clubId, name]) => [clubId, displayClubName(name)])),
    players: new Map(names.players),
    labels: new Map(names.labels),
  };
  const throughSeason = valueLines.content.inputs.throughSeason;
  const source: AflTradePageModel['source'] = {
    kind: 'sealed_batch',
    ...(options.audience === 'public' ? { audience: 'public' as const } : {}),
    label:
      options.audience === 'public'
        ? `Values to the end of the ${throughSeason} season`
        : `Genuine value lines ${valueLines.valueLinesId.slice(0, 24)}…, values to ${throughSeason}; private, not for publication`,
  };
  const trades = new Set(structure.content.trades.map(({ transactionId }) => transactionId));
  // Computed on the first list and kept: the bundle never changes.
  let results: ReturnType<typeof aflTradeStoryListResults> | null = null;
  return {
    list: () => ({
      source,
      stories: structure.content.trades.map((trade) => ({
        tradeId: trade.transactionId,
        year: trade.tradeYear,
        clubNames: trade.clubs.map(({ clubId }) => storyNames.clubs.get(clubId) ?? clubId),
        clubIds: trade.clubs.map(({ clubId }) => clubId),
        results: (results ??= aflTradeStoryListResults(structure, valueLines, storyNames)).get(
          trade.transactionId
        ),
      })),
    }),
    loadClub: (clubId) =>
      structure.content.trades.some((trade) => trade.clubs.some((club) => club.clubId === clubId))
        ? { chains: buildAflTradeClubChains({ structure, valueLines }, clubId, storyNames), source }
        : null,
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
