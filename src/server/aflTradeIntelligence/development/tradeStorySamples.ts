import type { AflTradeAssetLedgerBidMatch } from '../valuation/assetLedgerContracts';
import type {
  AflTradePageBidMatch,
  AflTradePageModel,
} from '../valuation/realizedTradePageContracts';
import { buildAflTradeClubChains, type AflTradeClubChains } from '../valuation/clubTradeChains';
import { buildAflTradeStory } from '../valuation/realizedTradeStory';
import {
  CAMERON_CHAIN_THROUGH_SEASON,
  CLUB,
  DARCY,
  cameronChainLines,
  cameronChainNames,
} from './tradeStorySampleChain';

/**
 * The private trade page's sample source: the Jeremy Cameron chain (the #965 fixture) as a trade
 * structure and value lines, and Sam Darcy's 2021 matched bid, until the page reads sealed value
 * lines and a ledger. Sample data only, never publication evidence.
 */

function darcyBidMatch(): AflTradePageBidMatch {
  const { shares } = DARCY;
  if (shares.status !== 'shared') throw new Error('The Darcy sample bid is not priced.');
  const match: AflTradeAssetLedgerBidMatch = {
    bidMatchId: 'sample:bid-match:2021-darcy',
    draftYear: 2021,
    draftType: 'national',
    selectionNumber: 2,
    clubId: CLUB.wbd,
    bidClubId: null,
    basis: 'father_son',
    nominee: {
      selectionId: 'sample:selection:2021-2',
      playerId: DARCY.playerId,
      // Sample: the stint's value only. A ledger stint lists its seasons.
      firstStint: {
        clubId: CLUB.wbd,
        startSeason: 2022,
        endSeason: null,
        status: 'open',
        arrivalReviewed: true,
        beganBeforeCoverage: false,
        seasons: [],
        seasonsMissingPav: [],
        total: DARCY.firstStintPav,
        value: DARCY.firstStintPav,
      },
    },
    pricing: {
      status: 'shared',
      ruleId: shares.ruleId,
      pricePoints: shares.pricePoints,
      leftover: shares.leftover,
      deficit: shares.deficit,
    },
    spentPicks: shares.picks.map((share, index) => {
      const [, label, pickId] = DARCY.spent[index]!;
      return {
        nativePickId: share.nativePickId,
        label,
        originalNumber: Number(label.replace('Pick ', '')),
        originalClubId: null,
        pointsUsed: share.pointsUsed,
        pickId,
        link: 'custody',
        countedPoints: share.countedPoints,
        share: share.share,
        use: share.use,
        value: share.share * DARCY.firstStintPav,
      };
    }),
  };
  return {
    match,
    nomineeName: 'Sam Darcy',
    clubName: 'Western Bulldogs',
    leftoverLabels: ['Pick 61'],
  };
}

const BID_MATCHES: readonly AflTradePageBidMatch[] = [darcyBidMatch()];

const SOURCE: AflTradePageModel['source'] = {
  kind: 'sample',
  label:
    'Sample data: values to 2026 from the approved mockups, draft-night and at-trade values illustrative',
};

export interface AflTradeStorySampleSummary {
  readonly tradeId: string;
  readonly year: number;
  readonly clubNames: readonly string[];
  /** The trade's clubs, in the same order as `clubNames`. */
  readonly clubIds: readonly string[];
}

export interface AflTradeStorySampleList {
  readonly source: AflTradePageModel['source'];
  readonly stories: readonly AflTradeStorySampleSummary[];
}

export interface AflTradeStorySampleSource {
  list(): AflTradeStorySampleList;
  load(tradeId: string): AflTradePageModel | null;
  /** Every chain of one club (#1051), or null for a club the source does not know. */
  loadClub(clubId: string): AflTradeClubChainsModel | null;
}

export interface AflTradeClubChainsModel {
  readonly chains: AflTradeClubChains;
  readonly source: AflTradePageModel['source'];
}

const clubName = (clubId: string) => cameronChainNames.clubs.get(clubId) ?? clubId;

export const aflTradeStorySamples: AflTradeStorySampleSource = {
  list: () => ({
    source: SOURCE,
    stories: cameronChainLines.structure.content.trades.map((trade) => ({
      tradeId: trade.transactionId,
      year: trade.tradeYear,
      clubNames: trade.clubs.map(({ clubId }) => clubName(clubId)),
      clubIds: trade.clubs.map(({ clubId }) => clubId),
    })),
  }),
  loadClub: (clubId) =>
    cameronChainNames.clubs.has(clubId)
      ? {
          chains: buildAflTradeClubChains(cameronChainLines, clubId, cameronChainNames),
          source: SOURCE,
        }
      : null,
  load(tradeId) {
    if (
      !cameronChainLines.structure.content.trades.some((trade) => trade.transactionId === tradeId)
    )
      return null;
    const story = buildAflTradeStory(cameronChainLines, tradeId, cameronChainNames);
    const pickIds = new Set(
      story.lineage.trades.flatMap(({ assets }) => assets.map(({ assetId }) => assetId))
    );
    return {
      story,
      source: SOURCE,
      throughSeason: CAMERON_CHAIN_THROUGH_SEASON,
      bidMatches: BID_MATCHES.filter(({ match }) =>
        match.spentPicks.some(({ pickId }) => pickId !== null && pickIds.has(pickId))
      ),
    };
  },
};
