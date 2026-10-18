import type {
  AflTradeStory,
  AflTradeStoryPlayer,
} from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import { bidShareAnchor } from './BidMatchShareCard';
import { ClubBadge } from './ClubBadge';
import {
  bidShareOf,
  bidShareValue,
  formatPav,
  knownPav,
  PENDING_TEXT,
  type AflTradePageBidShare,
} from './tradePageModel';

/** How the club got the player, in one sentence. */
export function acquiredText(
  player: AflTradeStoryPlayer,
  clubNames: ReadonlyMap<string, string>,
  tradeYears: ReadonlyMap<string, number>
): string {
  const from = clubNames.get(player.acquired.fromClubId) ?? player.acquired.fromClubId;
  const { outcome } = player;
  const pick = player.acquired.pickLabel;
  if (outcome.kind === 'not_used') return `From ${from}. Not used at the draft.`;
  if (outcome.kind === 'pending') {
    const reason = PENDING_TEXT[outcome.pending];
    return `From ${from}. ${reason[0]!.toUpperCase()}${reason.slice(1)}.`;
  }
  if (outcome.selection === null) {
    const year = tradeYears.get(player.acquired.tradeId);
    return `From ${from} in the ${year ?? ''} trade.`.replace('  ', ' ');
  }
  const taken = `Taken with pick ${outcome.selection.selectionNumber} in ${outcome.selection.draftYear}`;
  return player.group === 'got_away'
    ? `${taken} by ${outcome.clubName}, with ${pick}.`
    : `${taken}, with ${pick} from ${from}.`;
}

function PlayerCard({
  player,
  clubNames,
  tradeYears,
  maxValue,
  shares,
}: {
  player: AflTradeStoryPlayer;
  clubNames: ReadonlyMap<string, string>;
  tradeYears: ReadonlyMap<string, number>;
  maxValue: number;
  shares: ReadonlyMap<string, AflTradePageBidShare>;
}) {
  const value = knownPav(player.value);
  const name =
    player.outcome.kind === 'player'
      ? player.outcome.playerName
      : (player.acquired.pickLabel ?? 'Pick');
  const away = player.group === 'got_away';
  const share = bidShareOf(player, shares);
  const shareValue = bidShareValue(share);
  return (
    <li
      className={`rounded-xl border border-(--ts-line) p-4 ${away ? 'bg-(--ts-bg2)' : 'bg-(--ts-surface)'}`}
    >
      <h4 className="flex items-center gap-2 font-semibold">
        <ClubBadge clubName={player.clubName} />
        {name}
      </h4>
      <p className="mt-1.5 ts-body text-(--ts-ink2)">
        {acquiredText(player, clubNames, tradeYears)}
      </p>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5">
        <span className="ts-head font-semibold tabular-nums">
          {value !== null ? formatPav(value) : shareValue !== null ? formatPav(shareValue, 2) : '—'}
        </span>
        <span className="ts-small text-(--ts-muted)">
          {value !== null ? (
            'PAV to date'
          ) : share && shareValue !== null ? (
            <a
              href={`#${bidShareAnchor(player.assetId)}`}
              className="text-(--ts-accent) underline underline-offset-2"
            >
              share of {share.bid.nomineeName}, not in the totals yet
            </a>
          ) : (
            'value not in yet'
          )}
        </span>
      </p>
      {player.outcome.kind === 'player' ? (
        <p className="mt-2 flex items-center gap-1.5 ts-small text-(--ts-ink2)">
          <span
            aria-hidden="true"
            className={`inline-block size-2 rounded-full ${player.stillAtClub ? 'bg-(--ts-live)' : 'border border-(--ts-muted)'}`}
          />
          {player.stillAtClub
            ? `Still at ${player.outcome.clubName} · value will move`
            : `Left ${player.outcome.clubName} · value is final`}
        </p>
      ) : null}
      <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-(--ts-bg2)">
        {value !== null && maxValue > 0 ? (
          <span
            className={`block h-full rounded-full ${away ? 'bg-(--ts-muted)' : 'bg-(--ts-accent)'}`}
            style={{ width: `${Math.max(1, (value / maxValue) * 100)}%` }}
          />
        ) : null}
      </div>
    </li>
  );
}

/** What each club ended up with along its chain, then the players now at other clubs. */
export function TradePlayerCards({
  story,
  clubNames,
  shares,
}: {
  story: AflTradeStory;
  clubNames: ReadonlyMap<string, string>;
  shares: ReadonlyMap<string, AflTradePageBidShare>;
}) {
  const tradeYears = new Map(story.lineage.trades.map(({ tradeId, year }) => [tradeId, year]));
  const maxValue = Math.max(0, ...story.players.map(({ value }) => knownPav(value) ?? 0));
  const groups = [
    ...story.trade.clubs.map((club) => ({
      key: club.clubId,
      club,
      title: `What ${club.clubName} ended up with`,
      players: story.players.filter(
        ({ group, clubId }) => group === 'ended_with' && clubId === club.clubId
      ),
    })),
    {
      key: 'got-away',
      club: null,
      title: 'Now at other clubs',
      players: story.players.filter(({ group }) => group === 'got_away'),
    },
  ].filter(({ players }) => players.length > 0);

  return (
    <section aria-labelledby="players-title" className="mt-12">
      <h2 id="players-title" className="ts-head font-semibold">
        Who they ended up with
      </h2>
      <p className="mt-1 text-(--ts-ink2)">
        Each player, after every later trade. A green dot means the player is still at the club.
      </p>
      {groups.map((group) => (
        <div key={group.key}>
          <h3 className="mt-6 mb-3 flex items-center gap-2 font-semibold">
            {group.club ? <ClubBadge clubName={group.club.clubName} named /> : null}
            {group.title}
          </h3>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.players.map((player) => (
              <PlayerCard
                key={`${player.group}:${player.clubId}:${player.assetId}`}
                player={player}
                clubNames={clubNames}
                tradeYears={tradeYears}
                maxValue={maxValue}
                shares={shares}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
