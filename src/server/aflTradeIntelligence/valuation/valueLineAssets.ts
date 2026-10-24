import type { AflTradePlayerSeasonGames } from '../modeling/playerSeasonGames';
import type {
  AflTradeTradedPlayerDraftOrigin,
  AflTradeTradedPlayerValueEvaluator,
  AflTradeTradedPlayerValueInput,
} from '../modeling/tradedPlayerValueLineContracts';
import {
  aflTradeTradedPlayerBirthYears,
  aflTradeTradedPlayerCareerStart,
  aflTradeTradedPlayerFirstDraftOrigins,
  aflTradeTradedPlayerStage,
} from '../modeling/tradedPlayerValueLineFit';
import {
  AFL_TRADE_VALUE_LINE_FIT_RULES,
  aflTradeValueLinePointAt,
  aflTradeValueLineSlotCurve,
  type AflTradeValueLineCredibility,
  type AflTradeValueLineFitParameters,
  type AflTradeValueLineSlotCurve,
} from '../modeling/valueLineFit';
import type { AflTradeAssetLedgerStint } from './assetLedgerContracts';
import {
  AFL_TRADE_VALUE_LINE_RULES,
  type AflTradeValueLineCheckpoint,
  type AflTradeValueLinePendingReason,
  type AflTradeValueLinePoint,
  type AflTradeValueLineSlotSource,
} from './valueLineContracts';

/** A point before its checkpoint, share and rounding are applied. */
export type AflTradeValueLineRawPoint = Omit<AflTradeValueLinePoint, 'checkpoint'>;

const KIND_ORDER = { season_end: 0, trade: 1, draft: 2 } as const;

/** Checkpoint order: the end of season Y, then the trade period of Y, then the draft of Y. */
export const aflTradeValueLineCheckpointOrder = ({ kind, season }: AflTradeValueLineCheckpoint) =>
  season * 3 + KIND_ORDER[kind];

export const aflTradeValueLinePending = (
  reason: AflTradeValueLinePendingReason,
  produced: number | null = null
): AflTradeValueLineRawPoint => ({
  state: 'pending',
  value: null,
  produced,
  expectedRemaining: null,
  slot: null,
  tenure: null,
  pending: reason,
});

const CLOSURE = AFL_TRADE_VALUE_LINE_RULES.inactivityClosureSeasons;
const HORIZON = AFL_TRADE_VALUE_LINE_FIT_RULES.horizonSeasons;

interface StintSeason {
  season: number;
  games: number;
  pav: number;
}

/** The traded-player fit's evidence, indexed: careers, first games and stage origins as the fit read them. */
interface TradedEvidence {
  firstReadSeason: number;
  lastReadSeason: number;
  career: Map<string, { games: number; pav: number }>;
  gameSeasons: Map<string, number[]>;
  origins: Map<string, AflTradeTradedPlayerDraftOrigin>;
  birthYears: Map<string, number>;
}

/**
 * Indexes the traded-player fit's games read model, refusing one that is not of the value lines' method,
 * pins another calculation for a season they share, or does not start at the fit's first read season.
 */
function tradedEvidence(
  games: AflTradePlayerSeasonGames,
  evaluator: AflTradeTradedPlayerValueEvaluator
): TradedEvidence {
  const fitGames = evaluator.games;
  if (fitGames.methodId !== games.methodId)
    throw new Error("The traded-player fit's games are not of the value lines' HPN PAV method.");
  if (fitGames.discrepancies.length > 0)
    throw new Error("The traded-player fit's games have discrepancies.");
  const read = fitGames.seasons.map(({ season }) => season).sort((left, right) => left - right);
  if (
    fitGames.seasons.some(({ availability }) => availability !== 'available') ||
    read.some((season, index) => index > 0 && season !== read[index - 1]! + 1)
  )
    throw new Error(
      "Every season of the traded-player fit's games must be available, without a gap."
    );
  const { firstReadSeason } = evaluator.parameters;
  if (read[0] !== firstReadSeason)
    throw new Error(
      `The traded-player fit's games do not start at its first read season ${firstReadSeason}.`
    );
  const pinned = new Map(games.seasons.map(({ season, calculationId }) => [season, calculationId]));
  for (const { season, calculationId } of fitGames.seasons)
    if (pinned.has(season) && pinned.get(season) !== calculationId)
      throw new Error(
        `Season ${season}: the traded-player fit's games pin another HPN PAV calculation.`
      );
  const career = new Map<string, { games: number; pav: number }>();
  for (const row of fitGames.rows) {
    const key = `${row.playerId}|${row.season}`;
    const known = career.get(key) ?? { games: 0, pav: 0 };
    career.set(key, { games: known.games + row.games, pav: known.pav + row.pav });
  }
  const gameSeasons = new Map<string, number[]>();
  for (const [key, { games: played }] of career) {
    if (played <= 0) continue;
    const [playerId, season] = key.split('|') as [string, string];
    gameSeasons.set(playerId, [...(gameSeasons.get(playerId) ?? []), Number(season)]);
  }
  return {
    firstReadSeason,
    lastReadSeason: read[read.length - 1]!,
    career,
    gameSeasons,
    origins: aflTradeTradedPlayerFirstDraftOrigins(evaluator.draftOrigins),
    birthYears: aflTradeTradedPlayerBirthYears(evaluator.birthYears),
  };
}

/**
 * Reads value-line points from the stored fit, the ledger's stints and the games read model. Every
 * point reads only seasons through its checkpoint: the season a checkpoint closes is
 * `checkpoint.season` for every kind (a trade or draft of year Y follows the end of season Y).
 */
export class AflTradeValueLineReader {
  private readonly curves = new Map<number, AflTradeValueLineSlotCurve>();
  private readonly pickValues = new Map<number, number>();
  private readonly gamesByKey = new Map<string, { games: number; pav: number }>();
  private readonly clubsBySeason = new Map<string, Set<string>>();
  private readonly firstReadSeason: number;
  private readonly lastReadSeason: number;
  private readonly credibility: AflTradeValueLineCredibility;
  private readonly tradedEvidence: TradedEvidence | null;

  constructor(
    private readonly parameters: AflTradeValueLineFitParameters,
    games: AflTradePlayerSeasonGames,
    private readonly tradedPlayers: AflTradeTradedPlayerValueEvaluator | undefined
  ) {
    this.credibility = parameters;
    const seasons = games.seasons.map(({ season }) => season);
    this.firstReadSeason = Math.min(...seasons);
    this.lastReadSeason = Math.max(...seasons);
    for (const row of games.rows) {
      this.gamesByKey.set(`${row.playerId}|${row.season}|${row.clubId}`, row);
      const key = `${row.playerId}|${row.season}`;
      const clubs = this.clubsBySeason.get(key) ?? new Set<string>();
      this.clubsBySeason.set(key, clubs.add(row.clubId));
    }
    this.tradedEvidence = tradedPlayers ? tradedEvidence(games, tradedPlayers) : null;
  }

  /** The slot's first-stint pick curve value, `V(slot)`. */
  pickValue(slot: number): number {
    const cached = this.pickValues.get(slot);
    if (cached !== undefined) return cached;
    const value = aflTradeValueLinePointAt(this.curve(slot), this.credibility, [], 0).value;
    this.pickValues.set(slot, value);
    return value;
  }

  pickPoint(
    selectionNumber: number,
    source: AflTradeValueLineSlotSource
  ): AflTradeValueLineRawPoint {
    const value = this.pickValue(selectionNumber);
    return {
      state: 'pick',
      value,
      produced: 0,
      expectedRemaining: value,
      slot: { selectionNumber, source },
      tenure: null,
      pending: null,
    };
  }

  /**
   * A drafted player's point from his draft (tenure 0, the used slot's curve) onward, through the
   * shared evaluator: produced plus expected remaining for the slot, moved by his own form.
   */
  drafted(
    slot: { selectionNumber: number; source: AflTradeValueLineSlotSource },
    draftYear: number,
    playerId: string,
    stint: AflTradeAssetLedgerStint,
    checkpoint: AflTradeValueLineCheckpoint
  ): AflTradeValueLineRawPoint {
    const tenure = checkpoint.season - draftYear;
    if (tenure < 0)
      throw new Error(`Checkpoint ${checkpoint.season} is before draft ${draftYear}.`);
    if (tenure > HORIZON)
      throw new Error(
        `Tenure ${tenure} of the ${draftYear} draft is past the ${HORIZON}-season horizon.`
      );
    if (stint.startSeason !== draftYear + 1)
      throw new Error(`The ledger stint of ${playerId} does not start the season after its draft.`);
    const read = this.stintSeasons(stint, playerId, checkpoint.season);
    if (read === null) return aflTradeValueLinePending('unavailable');
    const point = aflTradeValueLinePointAt(
      this.curve(slot.selectionNumber),
      this.credibility,
      read.seasons.map(({ season, games, pav }) => ({ tenure: season - draftYear, games, pav })),
      tenure,
      { ended: read.ended }
    );
    return {
      state: point.state,
      value: point.value,
      produced: point.produced,
      expectedRemaining: point.expectedRemaining,
      slot,
      tenure,
      pending: null,
    };
  }

  /**
   * A traded player's point: what his stint at the receiving club has produced, and while it is
   * open, the injected traded-player fit's expected remaining (pending without one).
   */
  traded(
    playerId: string,
    tradeSeason: number,
    stint: AflTradeAssetLedgerStint,
    checkpoint: AflTradeValueLineCheckpoint
  ): AflTradeValueLineRawPoint {
    const tenure = checkpoint.season - tradeSeason;
    if (tenure < 0)
      throw new Error(`Checkpoint ${checkpoint.season} is before trade ${tradeSeason}.`);
    if (stint.startSeason !== tradeSeason + 1)
      throw new Error(`The ledger stint of ${playerId} does not start the season after its trade.`);
    const read = this.stintSeasons(stint, playerId, checkpoint.season);
    if (read === null) return aflTradeValueLinePending('unavailable');
    const produced = read.seasons.reduce((sum, { pav }) => sum + pav, 0);
    if (read.ended)
      return {
        state: 'closed',
        value: produced,
        produced,
        expectedRemaining: 0,
        slot: null,
        tenure,
        pending: null,
      };
    if (this.tradedPlayers === undefined)
      return { ...aflTradeValueLinePending('traded_player_fit_not_stored', produced), tenure };
    const input = this.tradedPlayerInput(
      playerId,
      tradeSeason,
      stint,
      read.seasons,
      checkpoint.season
    );
    if (input === null) return aflTradeValueLinePending('unavailable', produced);
    const { parameters, valueAt } = this.tradedPlayers;
    const point = valueAt(parameters, input, checkpoint.season);
    if (point.fitId !== parameters.fitId || point.checkpointSeason !== checkpoint.season)
      throw new Error(
        `The traded-player fit answered for another fit or checkpoint (${playerId}).`
      );
    if (Math.abs(point.produced - produced) > 1e-6)
      throw new Error(`The traded-player fit's produced PAV for ${playerId} is not the ledger's.`);
    return {
      state: point.state,
      value: point.value,
      produced: point.produced,
      expectedRemaining: point.expectedRemaining,
      slot: null,
      tenure,
      pending: null,
    };
  }

  private curve(slot: number): AflTradeValueLineSlotCurve {
    const cached = this.curves.get(slot);
    if (cached) return cached;
    const curve = aflTradeValueLineSlotCurve(this.parameters, slot);
    this.curves.set(slot, curve);
    return curve;
  }

  private games(playerId: string, season: number, clubId: string): number {
    if (season < this.firstReadSeason || season > this.lastReadSeason)
      throw new Error(`Season ${season} is not in the games read model.`);
    return this.gamesByKey.get(`${playerId}|${season}|${clubId}`)?.games ?? 0;
  }

  /**
   * The season whose games reveal that a ledger-closed stint ended: its last counted season when he
   * also played for another club then (the ledger counts a departure season he played here), else
   * the season after it (a departure without a game here, or a re-arrival). The ledger's end is
   * derived from that later season, so a checkpoint before it must not see the closure.
   */
  private closingSeason(stint: AflTradeAssetLedgerStint, playerId: string): number | null {
    if (stint.status !== 'closed') return null;
    const endSeason = stint.endSeason ?? stint.startSeason - 1;
    const clubs = this.clubsBySeason.get(`${playerId}|${endSeason}`);
    const departedThen = !!clubs && [...clubs].some((club) => club !== stint.clubId);
    return endSeason >= stint.startSeason && departedThen ? endSeason : endSeason + 1;
  }

  /**
   * The stint's seasons from its start through `season`, cut where it ended by then, or null when a
   * counted season has no pinned PAV. No later season is read. It ends at the ledger's end once the
   * season revealing it is read, or after three consecutive seasons with no game here, which is
   * terminal: a later return is not first-stint PAV (value-line method, "First stint"). The at-trade
   * and draft views read no stint season, so never know it will close.
   */
  private stintSeasons(
    stint: AflTradeAssetLedgerStint,
    playerId: string,
    season: number
  ): { seasons: StintSeason[]; ended: boolean } | null {
    const closing = this.closingSeason(stint, playerId);
    let ended = closing !== null && closing <= season;
    const last = ended ? (stint.endSeason ?? stint.startSeason - 1) : season;
    const pav = new Map(stint.seasons.map((row) => [row.season, row.pav]));
    const seasons: StintSeason[] = [];
    let zeroRun = 0;
    for (let year = stint.startSeason; year <= last; year++) {
      if (zeroRun >= CLOSURE) {
        ended = true;
        break;
      }
      if (stint.seasonsMissingPav.includes(year)) return null;
      const value = pav.get(year);
      if (value === undefined)
        throw new Error(`The ledger stint of ${playerId} has no season ${year}.`);
      const games = this.games(playerId, year, stint.clubId);
      seasons.push({ season: year, games, pav: value });
      zeroRun = games === 0 ? zeroRun + 1 : 0;
    }
    if (zeroRun >= CLOSURE) ended = true;
    return { seasons, ended };
  }

  /**
   * The traded-player fit's input, built as the fit builds a leg's (`aflTradeTradedPlayerFitLegInputs`):
   * his stage by the fit's one rule (`aflTradeTradedPlayerStage`) against his first trade in the
   * window, from the fit's merged draft origins, birth years and games; his career at any club from
   * his career start (`aflTradeTradedPlayerCareerStart`) through the checkpoint; his earlier trades in the window; and the
   * stint so far. Null where the fit refuses the leg: a trade season it did not fit, or a draft origin
   * at or after his first trade.
   */
  private tradedPlayerInput(
    playerId: string,
    tradeSeason: number,
    stint: AflTradeAssetLedgerStint,
    seasons: readonly StintSeason[],
    checkpointSeason: number
  ): AflTradeTradedPlayerValueInput | null {
    const evidence = this.tradedEvidence!;
    const { tradeSeasons, playerTradeSeasons } = this.tradedPlayers!;
    if (!tradeSeasons.includes(tradeSeason)) return null;
    const trades = playerTradeSeasons.get(playerId) ?? [];
    if (!trades.includes(tradeSeason))
      throw new Error(`The traded-player fit has no ${tradeSeason} trade of ${playerId}.`);
    const stage = aflTradeTradedPlayerStage({
      draftOrigin: evidence.origins.get(playerId) ?? null,
      birthYear: evidence.birthYears.get(playerId) ?? null,
      gameSeasons: evidence.gameSeasons.get(playerId) ?? [],
      firstTradeSeason: Math.min(...trades),
      firstReadSeason: evidence.firstReadSeason,
    });
    if (stage === null) return null;
    if (checkpointSeason > evidence.lastReadSeason)
      throw new Error(`The traded-player fit's games do not read season ${checkpointSeason}.`);
    const career = [];
    for (
      let year = aflTradeTradedPlayerCareerStart(stage, evidence.firstReadSeason);
      year <= checkpointSeason;
      year++
    )
      career.push({
        season: year,
        ...(evidence.career.get(`${playerId}|${year}`) ?? { games: 0, pav: 0 }),
      });
    return {
      playerId,
      receivingClubId: stint.clubId,
      tradeSeason,
      stage,
      career,
      // Only an open stint reaches the fit: a closed one is worth what it produced.
      stint: { status: 'open', endSeason: null, seasons },
      earlierTradeSeasons: trades.filter((season) => season < tradeSeason),
    };
  }
}
