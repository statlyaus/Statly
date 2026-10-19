import type {
  AflTradeStoryAsset,
  AflTradeStoryBatch,
  AflTradeStoryClub,
  AflTradeStoryLeg,
  AflTradeStoryNames,
  AflTradeStoryOutcome,
  AflTradeStoryPendingReason,
  AflTradeStoryTrade,
  AflTradeStoryValue,
} from './realizedTradeStoryContracts';

/** One hop of an asset: the trade, and its leg in that trade. */
export interface AflTradeStoryHopRef {
  readonly trade: AflTradeStoryTrade;
  readonly leg: AflTradeStoryLeg;
}

type Resolution = Pick<AflTradeStoryAsset, 'outcome' | 'value'>;

const onwardTradeIdOf = (leg: AflTradeStoryLeg) =>
  leg.onward?.transactionId ?? leg.onwardTransactionId;

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`The trade story has no ${what}.`);
  return value;
}

const pending = (reason: AflTradeStoryPendingReason): Resolution => ({
  value: { kind: 'pending', pending: reason },
  outcome: { kind: 'pending', pending: reason },
});

/**
 * Follows assets through a realized-trade-grade batch. A pick traded on is followed through each
 * onward trade to its final leg, and its one intrinsic value is what that leg became: the drafted
 * player's first-stint PAV at the club that used it. The batch's traded-on return value (the old
 * return rule) is never read.
 */
export class AflTradeStoryIndex {
  private readonly trades: ReadonlyMap<string, AflTradeStoryTrade>;
  /** Each trade by id, with the legs that name it as their onward trade. */
  private readonly inbound = new Map<string, AflTradeStoryHopRef[]>();
  private readonly resolved = new Map<string, AflTradeStoryAsset>();

  constructor(
    batch: AflTradeStoryBatch,
    private readonly names: AflTradeStoryNames
  ) {
    this.trades = new Map(batch.content.trades.map((trade) => [trade.transactionId, trade]));
    for (const trade of batch.content.trades)
      for (const leg of trade.legs) this.addInbound({ trade, leg });
  }

  trade(tradeId: string): AflTradeStoryTrade {
    return required(this.trades.get(tradeId), `trade ${tradeId} in its batch`);
  }

  club(clubId: string): AflTradeStoryClub {
    return { clubId, clubName: required(this.names.clubs.get(clubId), `name for club ${clubId}`) };
  }

  /** The player or pick id a leg moves, the same in every trade the asset passes through. */
  assetId(leg: AflTradeStoryLeg): string {
    const asset = this.transferAsset(leg);
    return asset.kind === 'player' ? asset.playerId : asset.pickId;
  }

  /** The asset's next hop: its leg in the onward trade it was passed into, if any. */
  nextHop(ref: AflTradeStoryHopRef): AflTradeStoryHopRef | undefined {
    const onwardId = onwardTradeIdOf(ref.leg);
    if (onwardId === undefined) return undefined;
    const trade = this.trade(onwardId);
    const leg = trade.legs.find((onward) => this.continues(ref.leg, onward));
    return { trade, leg: required(leg, `onward leg for transfer ${ref.leg.transferId}`) };
  }

  /** The hop that brought the asset into this trade's sending club, if the batch holds one. */
  priorHop(ref: AflTradeStoryHopRef): AflTradeStoryHopRef | undefined {
    return this.inbound
      .get(ref.trade.transactionId)
      ?.find((prior) => this.continues(prior.leg, ref.leg));
  }

  /** This hop and every later one, to the asset's final leg. */
  forward(ref: AflTradeStoryHopRef): AflTradeStoryHopRef[] {
    return this.walk(ref, (hop) => this.nextHop(hop));
  }

  /** The asset's final leg: where it ended up. */
  finalHop(ref: AflTradeStoryHopRef): AflTradeStoryHopRef {
    return this.forward(ref).reduce((_, hop) => hop);
  }

  /** What the asset became, the same for every hop: its final trade and transfer. */
  identity(ref: AflTradeStoryHopRef): string {
    const final = this.finalHop(ref);
    return `${final.trade.transactionId}|${final.leg.transferId}`;
  }

  /** Every earlier hop the batch holds, oldest first, without this one. */
  backward(ref: AflTradeStoryHopRef): AflTradeStoryHopRef[] {
    return this.walk(ref, (hop) => this.priorHop(hop))
      .slice(1)
      .reverse();
  }

  /** The asset a leg moves, with what it became and its one intrinsic value. */
  resolve(ref: AflTradeStoryHopRef): AflTradeStoryAsset {
    const key = `${ref.trade.transactionId}|${ref.leg.transferId}`;
    const cached = this.resolved.get(key);
    if (cached) return cached;
    const asset: AflTradeStoryAsset = {
      transferId: ref.leg.transferId,
      assetKind: ref.leg.assetKind,
      assetId: this.assetId(ref.leg),
      label: this.label(ref.leg),
      fromClubId: ref.leg.sendingClubId,
      toClubId: ref.leg.receivingClubId,
      ...this.resolution(this.finalHop(ref)),
    };
    this.resolved.set(key, asset);
    return asset;
  }

  private addInbound(ref: AflTradeStoryHopRef) {
    const onwardId = onwardTradeIdOf(ref.leg);
    if (onwardId !== undefined)
      this.inbound.set(onwardId, [...(this.inbound.get(onwardId) ?? []), ref]);
  }

  private walk(
    ref: AflTradeStoryHopRef,
    step: (hop: AflTradeStoryHopRef) => AflTradeStoryHopRef | undefined
  ): AflTradeStoryHopRef[] {
    const hops = [ref];
    for (let hop = step(ref); hop; hop = step(hop)) {
      if (hops.length > this.trades.size)
        throw new Error(`The trade story found a cycle at transfer ${ref.leg.transferId}.`);
      hops.push(hop);
    }
    return hops;
  }

  private transferAsset(leg: AflTradeStoryLeg) {
    return required(
      this.names.transfers.get(leg.transferId),
      `asset for transfer ${leg.transferId}`
    );
  }

  /**
   * Whether `onward` is the next hop of `leg`: given on by the club that received it, and either the
   * same asset or, for a special entitlement, its successor transfer (an ordinary pick).
   */
  private continues(leg: AflTradeStoryLeg, onward: AflTradeStoryLeg): boolean {
    if (onward.sendingClubId !== leg.receivingClubId) return false;
    const successorId = leg.specialEntitlement?.successorTransferId;
    return successorId === undefined
      ? this.assetId(onward) === this.assetId(leg)
      : onward.transferId === successorId;
  }

  private label(leg: AflTradeStoryLeg): string {
    const asset = this.transferAsset(leg);
    return asset.kind === 'pick' ? asset.label : this.playerName(asset.playerId);
  }

  private playerName(playerId: string): string {
    return required(this.names.players.get(playerId), `name for player ${playerId}`);
  }

  /** What the asset's final leg became, and its value. */
  private resolution(final: AflTradeStoryHopRef): Resolution {
    switch (final.leg.basis) {
      case 'player_first_stint':
      case 'pick_selected_first_stint':
        return { value: this.firstStintValue(final.leg), outcome: this.playerOutcome(final.leg) };
      case 'pick_not_used_no_nominee':
        return { value: { kind: 'known', pav: 0 }, outcome: { kind: 'not_used' } };
      case 'pick_not_used_nominee_excluded':
        return pending('matched_bid');
      case 'pick_projected_from_order':
        return pending('draft_not_in_evidence');
      case 'unavailable':
        return pending('unavailable');
      case 'pick_traded_on_return':
      case 'pick_traded_on_return_unallocated':
        throw new Error(`The trade story did not follow transfer ${final.leg.transferId} on.`);
    }
  }

  private firstStintValue(leg: AflTradeStoryLeg): AflTradeStoryValue {
    return {
      kind: 'known',
      pav: required(leg.realizedValue, `first-stint value for transfer ${leg.transferId}`),
    };
  }

  private playerOutcome(leg: AflTradeStoryLeg): AflTradeStoryOutcome {
    const asset = this.transferAsset(leg);
    const [playerId, selection] =
      asset.kind === 'player' ? ([asset.playerId, null] as const) : this.selectionOf(asset.pickId);
    return {
      kind: 'player',
      ...this.club(leg.receivingClubId),
      playerId,
      playerName: this.playerName(playerId),
      selection,
      stint: required(leg.stint, `stint for transfer ${leg.transferId}`).status,
    };
  }

  private selectionOf(pickId: string) {
    const { playerId, selectionNumber, draftYear } = required(
      this.names.picks.get(pickId),
      `selection for pick ${pickId}`
    );
    return [playerId, { selectionNumber, draftYear }] as const;
  }
}
