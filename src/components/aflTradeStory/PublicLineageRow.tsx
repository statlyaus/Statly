import type { ReactNode } from 'react';

import type { AflTradeStoryLineageAsset } from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import { Connector, Outcome } from './LineageParts';
import { formatPav, knownPav, type AflTradePageBidShare } from './tradePageModel';

type PlayerOutcome = Extract<AflTradeStoryLineageAsset['outcome'], { kind: 'player' }>;

/** "2024 pick 11 (Collingwood)" as the pick and whose it was; a player as himself. */
export function assetLines(label: string, isPlayer: boolean): readonly [string, string] {
  if (isPlayer) return [label, 'player'];
  const match = /^(.*) \((.+)\)$/u.exec(label);
  return match ? [match[1]!, `${match[2]}’s pick`] : [label, 'pick'];
}

/** The player an asset became, his value, and its bar on the scale every row shares. */
function BecamePlayer({
  player,
  away,
  isPlayer,
  value,
  colour,
  scaleMax,
  ticks,
}: {
  player: PlayerOutcome;
  away: boolean;
  isPlayer: boolean;
  value: number;
  colour: string;
  scaleMax: number;
  ticks: readonly number[];
}) {
  const tone = away ? 'text-(--ts-ink2)' : '';
  const drafted = player.selection
    ? `(pick ${player.selection.selectionNumber}, ${player.selection.draftYear})`
    : isPlayer
      ? 'traded as a player'
      : null;
  return (
    <div className="min-w-0 sm:col-start-2 lg:col-start-auto">
      <div className="flex items-baseline justify-between gap-3">
        <p className={`truncate ts-body font-bold ${tone}`}>{player.playerName}</p>
        <p className={`shrink-0 ts-body font-bold tabular-nums ${tone}`}>{formatPav(value)}</p>
      </div>
      <div className="relative mt-1 h-2 rounded-full bg-(--ts-surface)/80" aria-hidden="true">
        {ticks.map((tick) => (
          <span
            key={tick}
            className="absolute -top-0.5 -bottom-0.5 w-px bg-(--ts-line)"
            style={{ left: `${(tick / scaleMax) * 100}%` }}
          />
        ))}
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${away ? 'border-[1.5px] border-dashed border-(--ts-muted)' : ''}`}
          style={{
            width: `${Math.min(100, (Math.max(0, value) / scaleMax) * 100)}%`,
            backgroundColor: away ? undefined : colour,
          }}
        />
      </div>
      <p className="mt-2.5 ts-small leading-tight text-(--ts-ink2)">
        {drafted}
        {away ? (
          <>
            {' '}
            at <span className="font-semibold text-(--ts-ink)">{player.clubName}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}

/**
 * One asset on the public lineage map (the owner's refined design, Magic Patterns, 2026-11-17). It
 * reads left to right as a path: what was traded, any earlier trade it came through, this trade's
 * square, each later trade, then the player it became with his value on a bar. Three fixed columns
 * keep every path starting level.
 */
export function PublicLineageRow({
  asset,
  isPlayer,
  receiverId,
  colour,
  scaleMax,
  ticks,
  maxValue,
  share,
  via,
  tradedOn,
  panel,
}: {
  asset: AflTradeStoryLineageAsset;
  /** A player traded as himself, not a pick. */
  isPlayer: boolean;
  receiverId: string;
  colour: string;
  scaleMax: number;
  ticks: readonly number[];
  maxValue: number;
  share: AflTradePageBidShare | null;
  /** The earlier trade or trades the asset came through, already worded. */
  via: ReactNode;
  /** The later trades it was passed on in, as buttons. */
  tradedOn: readonly ReactNode[];
  panel: ReactNode;
}) {
  const player = asset.outcome.kind === 'player' ? asset.outcome : null;
  const away = player !== null && player.clubId !== receiverId;
  const [name, note] = assetLines(asset.label, isPlayer);
  return (
    <li className="py-4 sm:py-5">
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[9.5rem_minmax(0,1fr)] lg:grid-cols-[10rem_minmax(0,1fr)_19rem] lg:items-center">
        <div className="min-w-0">
          <p className="ts-body leading-tight font-semibold">{name}</p>
          <p className="mt-0.5 ts-small leading-tight text-(--ts-ink2)">{note}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-y-2 sm:flex-nowrap">
          {/* A fixed slot from 640px up, so this trade's square sits at the same place on every row. */}
          <span className="flex shrink-0 items-center sm:w-[11.5rem]">
            {via ? (
              <>
                {via}
                <span
                  aria-hidden="true"
                  className="h-0 min-w-3 flex-1 border-t-2 border-dashed border-(--ts-muted)"
                />
              </>
            ) : null}
          </span>
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[2px] bg-(--ts-accent)" />
          {tradedOn.map((node, at) => (
            <span key={at} className="flex items-center">
              <Connector dashed={at > 0} />
              {node}
            </span>
          ))}
          <span
            aria-hidden="true"
            className={`h-0 min-w-6 flex-1 border-t-2 ${away ? 'border-dashed border-(--ts-muted)' : 'border-(--ts-accent)'}`}
          />
        </div>
        {player ? (
          <BecamePlayer
            player={player}
            away={away}
            isPlayer={isPlayer}
            value={knownPav(asset.value) ?? 0}
            colour={colour}
            scaleMax={scaleMax}
            ticks={ticks}
          />
        ) : (
          <div className="min-w-0 sm:col-start-2 lg:col-start-auto">
            <Outcome asset={asset} groupClubId={receiverId} maxValue={maxValue} share={share} />
          </div>
        )}
      </div>
      {panel}
    </li>
  );
}
