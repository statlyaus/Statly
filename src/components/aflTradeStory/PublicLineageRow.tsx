import type { ReactNode } from 'react';
import { ArrowRight, CornerDownRight } from 'lucide-react';

import type { AflTradeStoryLineageAsset } from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import { Outcome } from './LineageParts';
import { formatPav, knownPav, type AflTradePageBidShare } from './tradePageModel';

type PlayerOutcome = Extract<AflTradeStoryLineageAsset['outcome'], { kind: 'player' }>;

/** Where the player was drafted or joined, and the other club when he did not stay. */
function draftedText(player: PlayerOutcome, isPlayer: boolean, receiver: string): string | null {
  if (isPlayer) return `joined ${receiver}`;
  return player.selection
    ? `Pick ${player.selection.selectionNumber}, ${player.selection.draftYear}`
    : null;
}

/** The player an asset became, his value, and its bar on the shared scale. */
function BecamePlayer({
  player,
  away,
  isPlayer,
  receiver,
  value,
  colour,
  scaleMax,
  ticks,
}: {
  player: PlayerOutcome;
  away: boolean;
  isPlayer: boolean;
  receiver: string;
  value: number;
  colour: string;
  scaleMax: number;
  ticks: readonly number[];
}) {
  return (
    <>
      <div className="mp-became">
        <div>
          <p className="mp-player">
            <CornerDownRight aria-hidden="true" size={16} />
            <span>{player.playerName}</span>
          </p>
          <p className="mp-drafted">
            {draftedText(player, isPlayer, receiver)}
            {away ? (
              <>
                {' '}
                · at <b>{player.clubName}</b>
              </>
            ) : null}
          </p>
        </div>
        <p className="mp-value">
          <b>{formatPav(value)}</b>
          <span>{away ? `PAV · to ${player.clubName}` : 'PAV'}</span>
        </p>
      </div>
      <div className="mp-track" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick} className="mp-tick" style={{ left: `${(tick / scaleMax) * 100}%` }} />
        ))}
        <span
          className={away ? 'mp-bar mp-bar-away' : 'mp-bar'}
          style={{
            width: `${Math.min(100, (Math.max(0, value) / scaleMax) * 100)}%`,
            backgroundColor: away ? undefined : colour,
          }}
        />
      </div>
    </>
  );
}

/**
 * One asset on the public lineage map (the owner's Magic Patterns design, 2026-11-17): what was
 * traded, any trades it came through or went on to, the player it became, his value, and a bar on
 * the scale every row shares. Value a player gave another club is drawn hollow and says so.
 */
export function PublicLineageRow({
  asset,
  isPlayer,
  receiver,
  receiverId,
  colour,
  scaleMax,
  ticks,
  maxValue,
  share,
  cameVia,
  tradedOn,
  panel,
}: {
  asset: AflTradeStoryLineageAsset;
  /** A player traded as himself, not a pick. */
  isPlayer: boolean;
  receiver: string;
  receiverId: string;
  colour: string;
  scaleMax: number;
  ticks: readonly number[];
  maxValue: number;
  share: AflTradePageBidShare | null;
  /** The earlier trades the asset came through, as buttons or plain text. */
  cameVia: readonly ReactNode[];
  /** The later trades it was passed on in. */
  tradedOn: readonly ReactNode[];
  panel: ReactNode;
}) {
  const { outcome } = asset;
  const player = outcome.kind === 'player' ? outcome : null;
  const away = player !== null && player.clubId !== receiverId;
  const value = knownPav(asset.value) ?? 0;
  return (
    <li className={`mp-row ${away ? 'mp-row-away' : ''}`}>
      {away ? <p className="mp-hand mp-away-note">Didn’t stay at {receiver}</p> : null}
      <div className="mp-traded">
        <span className="mp-chip">{isPlayer ? 'Player' : asset.label}</span>
        {isPlayer ? <span className="mp-aside">traded straight across</span> : null}
        {cameVia.length > 0 ? (
          <span className="mp-hand mp-via">
            came via{' '}
            {cameVia.map((node, at) => (
              <span key={at}>
                {at > 0 ? ' then ' : null}
                {node}
              </span>
            ))}
          </span>
        ) : null}
      </div>
      {tradedOn.length > 0 ? (
        <div className="mp-hops">
          <span className="mp-hand mp-via">traded on to</span>
          {tradedOn.map((node, at) => (
            <span key={at} className="mp-hop">
              {at > 0 ? <ArrowRight aria-hidden="true" size={14} /> : null}
              {node}
            </span>
          ))}
        </div>
      ) : null}
      {player ? (
        <BecamePlayer
          player={player}
          away={away}
          isPlayer={isPlayer}
          receiver={receiver}
          value={value}
          colour={colour}
          scaleMax={scaleMax}
          ticks={ticks}
        />
      ) : (
        <div className="mp-other">
          <Outcome asset={asset} groupClubId={receiverId} maxValue={maxValue} share={share} />
        </div>
      )}
      {panel}
    </li>
  );
}
