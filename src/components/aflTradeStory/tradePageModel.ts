import { guernseyFor } from '@/lib/clubGuernseys';
import { getTeamAbbreviation } from '@/lib/teamLogos';
import type { AflTradePageBidMatch } from '@/server/aflTradeIntelligence/valuation/realizedTradePageContracts';
import type {
  AflTradeStory,
  AflTradeStoryAsset,
  AflTradeStoryNet,
  AflTradeStoryPendingReason,
  AflTradeStoryValue,
} from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

export type {
  AflTradePageBidMatch,
  AflTradePageModel,
} from '@/server/aflTradeIntelligence/valuation/realizedTradePageContracts';

/** One spent pick of a matched bid, joined to the story asset it is. */
export interface AflTradePageBidShare {
  readonly bid: AflTradePageBidMatch;
  readonly spentIndex: number;
}

/** The private reader's trade page path. Never a public path. */
export const tradeStoryHref = (tradeId: string) =>
  `/dev/afl-trade-stories/${encodeURIComponent(tradeId)}`;

/** The lineage hash for one trade, so a trade opens from a link. */
export const tradeHash = (tradeId: string) => `#trade=${encodeURIComponent(tradeId)}`;

export function tradeIdFromHash(hash: string): string | null {
  const match = /^#trade=(.+)$/u.exec(hash);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

const MINUS = '−';

/** A PAV value, one decimal by default. */
export function formatPav(value: number, digits = 1): string {
  const fixed = Math.abs(value).toFixed(digits);
  return value < 0 && Number(fixed) !== 0 ? `${MINUS}${fixed}` : fixed;
}

/** A signed PAV value: +50.9, −50.9, 0.0. */
export function formatSigned(value: number, digits = 1): string {
  const fixed = Math.abs(value).toFixed(digits);
  if (Number(fixed) === 0) return fixed;
  return `${value < 0 ? MINUS : '+'}${fixed}`;
}

export const formatPoints = (points: number) =>
  points.toLocaleString('en-AU', { maximumFractionDigits: 1 });

export const formatPercent = (share: number) => `${(share * 100).toFixed(1)}%`;

export const knownPav = (value: AflTradeStoryValue) => (value.kind === 'known' ? value.pav : null);

/** Each value line's pending reason, in a few words. */
export const PENDING_TEXT: Record<AflTradeStoryPendingReason, string> = {
  matched_bid: 'used to match a bid not priced yet',
  draft_not_in_evidence: 'draft result not in yet',
  slot_unknown: 'pick slot not known yet',
  traded_player_fit_not_stored: 'estimate not in yet',
  unavailable: 'value not available yet',
};

export interface ClubStyle {
  readonly abbreviation: string;
  /** The guernsey's main colour, and a text colour that reads on it. */
  readonly fill: string;
  readonly ink: string;
  readonly trim: string;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

const contrast = (left: number, right: number) =>
  (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);

/** Black or white, whichever has the higher contrast on the fill (never below 4.5:1 on a hex). */
export function inkOn(fill: string): string {
  const fillLuminance = luminance(fill);
  return contrast(fillLuminance, 0) >= contrast(fillLuminance, 1) ? '#000000' : '#ffffff';
}

/**
 * A club's colours. A near-white guernsey (Geelong, North Melbourne, Sydney) shows its trim
 * instead, so the club still reads as a colour on a light page.
 */
export function clubStyle(clubName: string): ClubStyle {
  const guernsey = guernseyFor(clubName);
  const [fill, trim] =
    luminance(guernsey.base) > 0.7
      ? [guernsey.trim, guernsey.base]
      : [guernsey.base, guernsey.trim];
  return { abbreviation: getTeamAbbreviation(clubName), fill, ink: inkOn(fill), trim };
}

/** Each matched-bid share, by the story pick id it was spent as. */
export function bidSharesByPickId(
  bidMatches: readonly AflTradePageBidMatch[]
): ReadonlyMap<string, AflTradePageBidShare> {
  const shares = new Map<string, AflTradePageBidShare>();
  for (const bid of bidMatches)
    bid.match.spentPicks.forEach((spent, spentIndex) => {
      if (spent.pickId !== null) shares.set(spent.pickId, { bid, spentIndex });
    });
  return shares;
}

/** The ledger's matched bid a pick was spent on, if the pick's value line is a share of it. */
export function bidShareOf(
  asset: Pick<AflTradeStoryAsset, 'assetId' | 'outcome'>,
  shares: ReadonlyMap<string, AflTradePageBidShare>
): AflTradePageBidShare | null {
  if (asset.outcome.kind !== 'bid_share') return null;
  return shares.get(asset.assetId) ?? null;
}

/** A value: a known PAV (a matched-bid share to 2 decimals), else null. */
export function valueText(value: AflTradeStoryValue, outcome?: AflTradeStoryAsset['outcome']) {
  if (value.kind !== 'known') return null;
  return formatPav(value.pav, outcome?.kind === 'bid_share' ? 2 : 1);
}

/** A pick label inside a sentence: "pick 13", capitalised only where a label starts a line. */
export const inSentence = (label: string) => label.replace(/^Pick\b/u, 'pick');

/** "Geelong ⇄ GWS". */
export const tradeName = (clubs: readonly { clubName: string }[]) =>
  clubs.map(({ clubName }) => clubName).join(' ⇄ ');

/** A net's ink: neutral when it reads 0.0, so a level net is never painted ahead or behind. */
export const netTone = (value: number) =>
  Number(Math.abs(value).toFixed(1)) === 0
    ? 'text-(--ts-ink)'
    : value < 0
      ? 'text-(--ts-neg)'
      : 'text-(--ts-pos)';

/** Where the story read its values: "the end of 2026", "the 2026 draft", "the 2026 trade period". */
export function checkpointText({ kind, season }: AflTradeStory['checkpoint']): string {
  if (kind === 'season_end') return `the end of ${season}`;
  return kind === 'draft' ? `the ${season} draft` : `the ${season} trade period`;
}

/** A net's value, starred when pending assets are left out. */
export const netText = (net: Pick<AflTradeStoryNet, 'net' | 'pendingCount'>) =>
  `${formatSigned(net.net)}${net.pendingCount > 0 ? '*' : ''}`;

/** Every club the story names, by id. */
export function storyClubNames(story: AflTradeStory): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const club of [
    ...story.trade.clubs,
    ...story.lineage.trades.flatMap(({ clubs }) => clubs),
    ...story.players,
  ])
    names.set(club.clubId, club.clubName);
  return names;
}

/** "GEE ⇄ WBD". */
export const tradeShortName = (clubs: readonly { clubName: string }[]) =>
  clubs.map(({ clubName }) => clubStyle(clubName).abbreviation).join(' ⇄ ');

/** What an asset became, in a few words. */
export function becameText(asset: AflTradeStoryAsset, clubNames: ReadonlyMap<string, string>) {
  const { outcome } = asset;
  if (outcome.kind === 'not_used') return 'not used';
  if (outcome.kind === 'pending') return PENDING_TEXT[outcome.pending];
  if (outcome.kind === 'pick')
    return `${outcome.draftYear} draft to come, valued at pick ${outcome.selectionNumber}`;
  if (outcome.kind === 'bid_share') return 'used to match a bid';
  if (asset.assetKind === 'player') return `first stint at ${outcome.clubName}`;
  const elsewhere = outcome.clubId !== asset.toClubId;
  return `became ${outcome.playerName}${elsewhere ? ` (at ${clubNames.get(outcome.clubId) ?? outcome.clubName})` : ''}`;
}
