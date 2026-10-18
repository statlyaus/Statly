import type { AflTradeAssetLedgerBidMatch } from '../valuation/assetLedgerContracts';
import { aflTradeMatchedBidShares } from '../valuation/matchedBidShares';
import type {
  AflTradePageBidMatch,
  AflTradePageModel,
} from '../valuation/realizedTradePageContracts';
import { buildAflTradeStory } from '../valuation/realizedTradeStory';
import { CLUB, cameronChainBatch, cameronChainNames } from './tradeStorySampleChain';

/**
 * The private trade page's sample source: the Jeremy Cameron chain (the #965 fixture) and Sam
 * Darcy's 2021 matched bid, until the page reads a sealed batch and ledger. Sample data only, never
 * publication evidence.
 */

const THROUGH_SEASON = 2026;
/** Sam Darcy's first stint at the Bulldogs to 2026, from the approved mockups. */
const DARCY_FIRST_STINT_PAV = 34.71;

/** The board's spent picks: native id, label, the story's pick id where it is one, points used. */
const DARCY_SPENT = [
  ['7449', 'Pick 34', 'pick:2021-34-gee', 542],
  ['6042', 'Pick 42', 'pick:2021-42-nth', 395],
  ['6057', 'Pick 43', 'pick:2021-43-wbd', 378],
  ['7451', 'Pick 44', 'pick:2021-44-wbd', 362],
  ['5727', 'Pick 45', 'pick:2021-45-wbd', 347],
] as const;

function darcyBidMatch(): AflTradePageBidMatch {
  const shares = aflTradeMatchedBidShares({
    draftYear: 2021,
    selectionNumber: 2,
    roundNumber: 1,
    points: 2517,
    consumedPicks: DARCY_SPENT.map(([nativePickId, , , pointsUsed]) => ({
      nativePickId,
      pointsUsed,
    })),
    leftoverPicks: [{ nativePickId: '5792', points: 135 }],
  });
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
      playerId: 'player:sam-darcy',
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
        total: DARCY_FIRST_STINT_PAV,
        value: DARCY_FIRST_STINT_PAV,
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
      const [, label, pickId] = DARCY_SPENT[index]!;
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
        value: share.share * DARCY_FIRST_STINT_PAV,
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

export interface AflTradeStorySampleSummary {
  readonly tradeId: string;
  readonly year: number;
  readonly clubNames: readonly string[];
}

export interface AflTradeStorySampleSource {
  list(): readonly AflTradeStorySampleSummary[];
  load(tradeId: string): AflTradePageModel | null;
}

const clubName = (clubId: string) => cameronChainNames.clubs.get(clubId) ?? clubId;

export const aflTradeStorySamples: AflTradeStorySampleSource = {
  list: () =>
    cameronChainBatch.content.trades.map((trade) => ({
      tradeId: trade.transactionId,
      year: trade.tradeYear,
      clubNames: trade.clubs.map(({ clubId }) => clubName(clubId)),
    })),
  load(tradeId) {
    if (!cameronChainBatch.content.trades.some((trade) => trade.transactionId === tradeId))
      return null;
    const story = buildAflTradeStory(cameronChainBatch, tradeId, cameronChainNames);
    const pickIds = new Set(
      story.lineage.trades.flatMap(({ assets }) => assets.map(({ assetId }) => assetId))
    );
    return {
      story,
      source: { kind: 'sample', label: 'Sample data from the approved mockups' },
      throughSeason: THROUGH_SEASON,
      bidMatches: BID_MATCHES.filter(({ match }) =>
        match.spentPicks.some(({ pickId }) => pickId !== null && pickIds.has(pickId))
      ),
    };
  },
};
