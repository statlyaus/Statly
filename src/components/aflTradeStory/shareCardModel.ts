import type { AflTradePageModel } from '@/server/aflTradeIntelligence/valuation/realizedTradePageContracts';
import type {
  AflTradeStory,
  AflTradeStoryAsset,
} from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import { formatSigned, headline, netText } from './tradePageModel';

/**
 * The share card of one trade (owner-approved design, 2026-11-21): the 1200 × 630 picture Reddit,
 * X, Facebook and chats show under a trade link. The PAV value of what each club got from the trade
 * over time, starting at the trade. A pick passed on keeps its line here, so this is what the club
 * got, not what it still holds. Pure: the image route only draws what this returns.
 */

type Checkpoint = AflTradeStory['checkpoint'];

export interface ShareCardClub {
  readonly clubId: string;
  readonly clubName: string;
  /** "Jeremy Cameron + 2 picks": what the club got, short enough for the card's left column. */
  readonly got: string;
}

export interface ShareCardLine extends ShareCardClub {
  /** PAV value of what the club got from the trade at each point, valued on its lines. Signed. */
  readonly held: readonly number[];
  /** The club ahead is drawn solid with squares; the other dashed with diamonds. */
  readonly lead: boolean;
}

export type ShareCardChart =
  | {
      readonly kind: 'lines';
      readonly points: readonly { readonly checkpoint: Checkpoint; readonly label: string }[];
      readonly clubs: readonly [ShareCardLine, ShareCardLine];
    }
  | { readonly kind: 'summary'; readonly clubs: readonly ShareCardClub[] };

export interface ShareCardModel {
  readonly kicker: string;
  readonly title: string;
  /** "Geelong are ahead" or "Level so far". */
  readonly verdict: string;
  /** The leader's net on the trade, "+18.4" (starred while a value is still to come); null when level. */
  readonly lead: string | null;
  readonly chart: ShareCardChart;
  readonly footer: string;
  readonly alt: string;
}

/** Characters the card's left column holds at 18px Saira. */
const GOT_LENGTH = 30;
const NUMBERED_PICK = /\bpick (\d+)/iu;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * What a club got, in at most `GOT_LENGTH` characters: players by name, then the numbered picks as
 * one group ("picks 13, 15, 20"), then a count of whatever is left ("+ 2 picks", or "+ 2" when
 * players are among it).
 */
export function gotSummary(
  assets: readonly Pick<AflTradeStoryAsset, 'assetKind' | 'label'>[]
): string {
  const players = assets
    .filter(({ assetKind }) => assetKind === 'player')
    .map(({ label }) => label);
  const picks = assets.filter(({ assetKind }) => assetKind === 'pick');
  const numbers = picks
    .map(({ label }) => NUMBERED_PICK.exec(label)?.[1])
    .filter((number): number is string => number !== undefined)
    .map(Number)
    .sort((left, right) => left - right);
  const pickGroup =
    numbers.length === 0
      ? null
      : `${numbers.length === 1 ? 'pick' : 'picks'} ${numbers.join(', ')}`;
  const parts = [
    ...players.map((text) => ({ text, players: 1, picks: 0 })),
    ...(pickGroup ? [{ text: pickGroup, players: 0, picks: numbers.length }] : []),
  ];
  const shown: typeof parts = [];
  for (const part of parts) {
    const next = [...shown, part].map(({ text }) => text).join(', ');
    // Leave room for a "+ N picks" suffix whenever something is left over.
    if (shown.length > 0 && next.length > GOT_LENGTH - 10) break;
    shown.push(part);
  }
  const leftPlayers = players.length - shown.reduce((total, part) => total + part.players, 0);
  const leftPicks = picks.length - shown.reduce((total, part) => total + part.picks, 0);
  const left = leftPlayers + leftPicks;
  const text = shown.map((part) => part.text).join(', ');
  if (left === 0) return text;
  if (text === '') return plural(leftPicks, 'pick');
  const showsPicks = shown.some((part) => part.picks > 0);
  return leftPlayers === 0 && !showsPicks
    ? `${text} + ${plural(leftPicks, 'pick')}`
    : `${text} + ${left}`;
}

const sameCheckpoint = (left: Checkpoint, right: Checkpoint) =>
  left.kind === right.kind && left.season === right.season;

/** The trade, the first draft after it (draft night), then every season end, oldest first. */
function chartCheckpoints(story: AflTradeStory): Checkpoint[] {
  const line = story.nets.tradeAlone[0]?.line.map(({ checkpoint }) => checkpoint) ?? [];
  const firstDraft = line.find(({ kind }) => kind === 'draft');
  return line.filter(
    (checkpoint) =>
      checkpoint.kind === 'trade' ||
      checkpoint.kind === 'season_end' ||
      (firstDraft !== undefined && checkpoint === firstDraft)
  );
}

const axisLabel = ({ kind, season }: Checkpoint) =>
  kind === 'trade' ? 'Trade' : kind === 'draft' ? 'Draft' : String(season);

/** Each club's held PAV at each checkpoint, or null when any value it holds is still to come. */
function heldLines(story: AflTradeStory, checkpoints: readonly Checkpoint[]) {
  const legs = new Map(story.lineage.assets.map((asset) => [asset.transferId, asset.line]));
  return story.sides.map((side) =>
    checkpoints.map((checkpoint) => {
      let total = 0;
      for (const { transferId } of side.received) {
        const point = legs.get(transferId)?.find((at) => sameCheckpoint(at.checkpoint, checkpoint));
        if (point?.value === null || point?.value === undefined) return null;
        total += point.value;
      }
      return total;
    })
  );
}

export function tradeShareCardModel(model: AflTradePageModel): ShareCardModel {
  const { story, throughSeason } = model;
  const clubs = story.trade.clubs.map(({ clubName }) => clubName);
  const nets = [...story.nets.tradeAlone].sort((left, right) => right.net - left.net);
  const verdictText = headline(model).replace(/ so far$/u, '');
  const level = verdictText === 'Level';
  const leader = level ? null : nets[0]!;
  const summaries: ShareCardClub[] = story.sides.map(({ clubId, clubName, received }) => ({
    clubId,
    clubName,
    got: gotSummary(received),
  }));

  const checkpoints = chartCheckpoints(story);
  const held = heldLines(story, checkpoints);
  let chart: ShareCardChart = { kind: 'summary', clubs: summaries };
  if (
    story.sides.length === 2 &&
    checkpoints.length >= 2 &&
    held.every((line) => line.every((value) => value !== null))
  ) {
    const leadId = leader?.clubId ?? story.sides[0]!.clubId;
    const line = (index: 0 | 1): ShareCardLine => ({
      ...summaries[index]!,
      held: held[index] as number[],
      lead: summaries[index]!.clubId === leadId,
    });
    const [first, second] = [line(0), line(1)];
    chart = {
      kind: 'lines',
      points: checkpoints.map((checkpoint) => ({ checkpoint, label: axisLabel(checkpoint) })),
      clubs: [first, second],
    };
  }

  const title = clubs.join(clubs.length === 2 ? ' ⇄ ' : ' · ');
  const leadText = leader ? netText(leader) : null;
  const what = leader
    ? `${leader.clubName} are ahead by ${formatSigned(leader.net).replace(/^\+/u, '')} PAV`
    : 'The clubs are level';
  const gotText = summaries.map(({ clubName, got }) => `${clubName} got ${got}`).join('; ');
  return {
    kicker: `AFL trades · ${story.trade.year}`,
    title,
    verdict: level ? 'Level so far' : verdictText,
    lead: leadText,
    chart,
    footer: `Values to the end of ${throughSeason} · statly.com.au/afl/trades`,
    alt:
      `Share card for the ${story.trade.year} ${clubs.join(' and ')} trade. ${gotText}. ` +
      `${what} at the end of ${throughSeason}` +
      (chart.kind === 'lines' ? ', shown as the PAV value of what each club got, over time.' : '.'),
  };
}
