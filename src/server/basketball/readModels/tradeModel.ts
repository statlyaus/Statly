import 'server-only';

import type { EasternDate } from '@/lib/basketball/fantasyWeeks';
import { evaluateTrade, type TradeEvaluation } from '@/lib/basketball/trade';
import type { BasketballLeagueDetail } from '@/server/basketball/leagues/basketballLeagueDto';

import { loadPlayerPool, type NbaReadClient, type PlayerPool, type PoolPlayer } from './playerPool';

/** Players per side of a trade check. */
export const MAX_TRADE_PLAYERS = 6;

export interface TradeView {
  pool: PlayerPool;
  /** My valued players, highest value first: the give choices. */
  myPlayers: PoolPlayer[];
  /** Every other valued player (other teams, rostered elsewhere, free agents): the get choices. */
  otherPlayers: PoolPlayer[];
  give: PoolPlayer[];
  get: PoolPlayer[];
  /** null until at least one player is picked. */
  evaluation: TradeEvaluation | null;
}

/**
 * The sheet's Trades tab: per-category z net of the players I get over the players I give, with the
 * league's punts marked. Give ids must be on my roster, get ids must not; anything else is ignored.
 */
export async function loadTrade(
  league: BasketballLeagueDetail,
  options: {
    give: readonly string[];
    get: readonly string[];
    today?: EasternDate;
    client?: NbaReadClient;
  }
): Promise<TradeView> {
  const pool = await loadPlayerPool(league, { today: options.today, client: options.client });
  const myPlayers = pool.players.filter((player) => player.owner.kind === 'MINE');
  const otherPlayers = pool.players.filter((player) => player.owner.kind !== 'MINE');
  const pick = (ids: readonly string[], from: PoolPlayer[]) => {
    const byId = new Map(from.map((player) => [player.playerId, player]));
    return [...new Set(ids)].flatMap((id) => byId.get(id) ?? []).slice(0, MAX_TRADE_PLAYERS);
  };
  const give = pick(options.give, myPlayers);
  const get = pick(options.get, otherPlayers);

  return {
    pool,
    myPlayers,
    otherPlayers,
    give,
    get,
    evaluation:
      give.length + get.length > 0
        ? evaluateTrade({
            give,
            get,
            categories: league.categories,
            punts: league.puntCategories,
          })
        : null,
  };
}
