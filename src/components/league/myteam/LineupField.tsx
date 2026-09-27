'use client';

import { ChevronDown, ChevronUp, Lock } from 'lucide-react';

import { guernseyFor } from '@/lib/clubGuernseys';

import type { LineupAssignment, LineupFieldSpot } from '../matchups/lineupBuilderTypes';
import { FieldOval, GuernseyIcon } from './FieldArt';
import { layoutField, type FieldLine } from './fieldLayout';
import { findAssignment, positionSuitsSlot, type MyTeamSquadPlayer } from './myTeamLineup';

export interface FieldPlayer extends MyTeamSquadPlayer {
  bye?: boolean;
  injury?: string | null;
}

export type FieldTarget = 'here' | 'swap' | null;

export interface LineupFieldProps {
  spots: readonly LineupFieldSpot[];
  assignments: readonly LineupAssignment[];
  squadById: ReadonlyMap<string, FieldPlayer>;
  bench: readonly FieldPlayer[];
  editable: boolean;
  /** The spot or bench player being moved, shared with the table. */
  selectedSpotId: string | null;
  selectedBenchId: string | null;
  isLocked: (playerId: string) => boolean;
  spotTarget: (spot: LineupFieldSpot) => FieldTarget;
  benchTarget: (player: FieldPlayer) => FieldTarget;
  onSpot: (spot: LineupFieldSpot) => void;
  onBench: (player: FieldPlayer) => void;
  /** Phones can shrink the oval to a slim strip to reach the table sooner. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

interface TokenView {
  key: string;
  label: string;
  player: FieldPlayer | undefined;
  /** Shown in an empty spot. */
  slot: string;
  locked: boolean;
  target: FieldTarget;
  selected: boolean;
  flagged: 'bad' | 'warn' | null;
  disabled: boolean;
  onClick: () => void;
}

type Surface = 'grass' | 'card';

const ZONE_SHORT: Record<FieldLine['zone'], string> = { FWD: 'Fwd', CENTRE: 'Mid', DEF: 'Def' };

function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : name;
}

/**
 * Your lineup on an AFL oval, line by line from full-forward to full-back, beside (or above) the
 * lineup table. Utility, interchange and bench sit on a board under the oval. Selection is shared
 * with the table, so a tap here lights up targets there and the other way round.
 */
export function LineupField(props: LineupFieldProps): React.JSX.Element {
  const { spots, assignments, squadById, bench, editable, collapsed } = props;
  const layout = layoutField(spots);
  const selecting =
    props.selectedSpotId !== null ||
    props.selectedBenchId !== null ||
    spots.some((spot) => props.spotTarget(spot) !== null);

  function spotView(spot: LineupFieldSpot): TokenView {
    const assignment = findAssignment(assignments, spot);
    const player = assignment ? squadById.get(assignment.playerId) : undefined;
    const locked = player ? props.isLocked(player.playerId) : false;
    const target = props.spotTarget(spot);
    const selected = spot.id === props.selectedSpotId;
    const outOfPosition = player ? !positionSuitsSlot(player.position, spot.slot) : false;
    const state = [
      locked ? 'locked' : null,
      player?.bye ? 'bye' : null,
      player?.injury ? `injured (${player.injury})` : null,
      outOfPosition ? 'out of position' : null,
      target === 'swap' ? `tap to swap with ${player?.name ?? 'this player'}` : null,
      target === 'here' ? 'tap to move here' : null,
      selected ? 'selected' : null,
    ].filter(Boolean);
    return {
      key: spot.id,
      label: `${spot.label}: ${player?.name ?? 'empty'}${state.length ? `, ${state.join(', ')}` : ''}`,
      player,
      slot: spot.slot === 'INTERCHANGE' ? 'INT' : spot.slot,
      locked,
      target,
      selected,
      flagged: player?.injury || outOfPosition ? 'bad' : player?.bye ? 'warn' : null,
      disabled: !editable || (locked && !target),
      onClick: () => props.onSpot(spot),
    };
  }

  function benchView(player: FieldPlayer): TokenView {
    const locked = props.isLocked(player.playerId);
    const target = props.benchTarget(player);
    const selected = player.playerId === props.selectedBenchId;
    const state = [
      locked ? 'locked' : null,
      player.bye ? 'bye' : null,
      player.injury ? `injured (${player.injury})` : null,
      target ? 'tap to put in the lineup' : null,
      selected ? 'selected' : null,
    ].filter(Boolean);
    return {
      key: player.playerId,
      label: `Bench: ${player.name}${state.length ? `, ${state.join(', ')}` : ''}`,
      player,
      slot: 'BN',
      locked,
      target,
      selected,
      flagged: player.injury ? 'bad' : player.bye ? 'warn' : null,
      disabled: !editable || (locked && !target),
      onClick: () => props.onBench(player),
    };
  }

  const dim = (view: TokenView) => selecting && !view.target && !view.selected;

  return (
    <section
      aria-labelledby="my-team-field-heading"
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h3
          id="my-team-field-heading"
          className="font-display text-lg font-bold leading-tight text-foreground"
        >
          On the field
        </h3>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls="my-team-field-oval"
          onClick={props.onToggleCollapsed}
          className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar lg:hidden"
        >
          {collapsed ? 'Expand field' : 'Collapse field'}
          {collapsed ? (
            <ChevronDown aria-hidden="true" className="size-4" />
          ) : (
            <ChevronUp aria-hidden="true" className="size-4" />
          )}
        </button>
        <p className="hidden text-xs text-muted-foreground lg:block">Attacking end at the top</p>
      </header>

      {/* Collapsed on phones: the same lines as one slim strip. */}
      {collapsed ? (
        <div className="overflow-x-auto bg-[#2f7a31] px-3 py-2 lg:hidden">
          <div
            role="group"
            aria-label="Players on the ground"
            className="flex w-max items-end gap-4"
          >
            {(['FWD', 'CENTRE', 'DEF'] as const).map((zone) => {
              const zoneSpots = layout.lines
                .filter((line) => line.zone === zone)
                .flatMap((line) => line.spots);
              if (zoneSpots.length === 0) return null;
              return (
                <div key={zone} className="flex items-end gap-1.5">
                  <span className="pb-1 text-[0.625rem] font-bold uppercase tracking-wide text-white/80">
                    {ZONE_SHORT[zone]}
                  </span>
                  <ul className="flex gap-1">
                    {zoneSpots.map((spot) => {
                      const view = spotView(spot);
                      return (
                        <li key={view.key} className="w-16">
                          <Token view={view} surface="grass" dimmed={dim(view)} />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div id="my-team-field-oval" className={`px-3 py-4 ${collapsed ? 'hidden lg:block' : ''}`}>
        {/* A gutter on the left carries each line's team-sheet position (FF, HF, C, FOL, HB, FB). */}
        <div className="relative mx-auto w-full max-w-[27rem] py-[12%] pl-10 sm:pl-12">
          <div className="absolute inset-y-0 left-10 right-0 sm:left-12">
            <FieldOval />
          </div>
          <div
            role="group"
            aria-label={collapsed ? undefined : 'Players on the ground'}
            className="relative"
          >
            {layout.lines.map((line, index) => {
              const newZone = index > 0 && layout.lines[index - 1].zone !== line.zone;
              return (
                <ul
                  key={line.key}
                  aria-label={line.label}
                  className={`relative grid ${index > 0 ? (newZone ? 'mt-4' : 'mt-1.5') : ''}`}
                  style={{
                    gridTemplateColumns: `repeat(${line.spots.length}, minmax(0, 1fr))`,
                    paddingInline: `${line.inset + 6}%`,
                  }}
                >
                  <li
                    aria-hidden="true"
                    title={line.label}
                    className="absolute -left-10 bottom-0 flex h-[1.125rem] w-8 items-center sm:-left-12 sm:w-9 justify-center rounded bg-brand-bar text-[0.625rem] font-bold tracking-wide text-brand-bar-foreground"
                  >
                    {line.short}
                  </li>
                  {line.spots.map((spot) => {
                    const view = spotView(spot);
                    return (
                      <li key={view.key} className="flex justify-center px-1">
                        <div className="w-full max-w-[5.25rem]">
                          <Token view={view} surface="grass" dimmed={dim(view)} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              );
            })}
          </div>
        </div>
      </div>

      <div className="divide-y divide-border border-t border-border">
        <StripRow title="Utility" note="Scores" views={layout.utility.map(spotView)} dim={dim} />
        <StripRow
          title="Interchange"
          note="Covers a late out"
          views={layout.interchange.map(spotView)}
          dim={dim}
        />
        <StripRow
          title="Bench"
          note="No score"
          views={bench.map(benchView)}
          dim={dim}
          empty="Every squad player is picked."
        />
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {editable
            ? 'Tap a player, then a highlighted spot here or in the table.'
            : 'This lineup is locked for the round.'}
        </p>
      </div>
    </section>
  );
}

function StripRow({
  title,
  note,
  views,
  dim,
  empty,
}: {
  title: string;
  note: string;
  views: TokenView[];
  dim: (view: TokenView) => boolean;
  empty?: string;
}) {
  if (views.length === 0 && !empty) return null;
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2 px-3 py-2">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">{title}</h4>
        <p className="text-[0.6875rem] text-muted-foreground">{note}</p>
      </div>
      {views.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="grid grid-cols-4 gap-1">
          {views.map((view) => (
            <li key={view.key}>
              <Token view={view} surface="card" dimmed={dim(view)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Token({ view, surface, dimmed }: { view: TokenView; surface: Surface; dimmed: boolean }) {
  const onGrass = surface === 'grass';
  const pill = view.selected
    ? 'bg-[color:var(--chart-1)] text-white shadow-sm'
    : view.target
      ? 'bg-card text-foreground ring-2 ring-brand-bar shadow-sm'
      : onGrass
        ? view.player
          ? 'bg-white text-slate-900 shadow-sm'
          : 'bg-white/20 text-white'
        : 'text-foreground';
  return (
    <button
      type="button"
      aria-label={view.label}
      aria-pressed={view.selected}
      disabled={view.disabled}
      onClick={view.onClick}
      className={`group relative flex w-full flex-col items-center rounded-md pt-2.5 transition-opacity focus-visible:outline-none focus-visible:ring-2 disabled:cursor-default ${
        onGrass ? 'focus-visible:ring-white' : 'focus-visible:ring-brand-bar'
      } ${dimmed ? 'opacity-40' : ''}`}
    >
      {view.target ? (
        <span className="absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded-full bg-brand-bar px-1.5 text-[0.625rem] font-bold uppercase leading-4 text-brand-bar-foreground shadow">
          {view.target === 'swap' ? 'Swap' : 'Here'}
        </span>
      ) : null}
      <span className="relative flex h-9 items-center justify-center">
        {view.player ? (
          <GuernseyIcon
            guernsey={guernseyFor(view.player.club)}
            className={`h-9 w-8 drop-shadow transition-transform ${
              view.selected ? 'scale-110' : 'group-hover:scale-105'
            }`}
          />
        ) : (
          <span
            className={`flex size-8 items-center justify-center rounded-full border-2 border-dashed text-[0.5625rem] font-bold ${
              onGrass
                ? view.target
                  ? 'border-white bg-white/25 text-white'
                  : 'border-white/60 text-white/85'
                : view.target
                  ? 'border-brand-bar text-foreground'
                  : 'border-border text-muted-foreground'
            }`}
          >
            {view.slot}
          </span>
        )}
        {view.flagged ? (
          <span
            aria-hidden="true"
            className={`absolute -right-1.5 top-0 size-2.5 rounded-full ring-2 ${
              onGrass ? 'ring-white' : 'ring-card'
            } ${view.flagged === 'bad' ? 'bg-result-loss' : 'bg-result-draw'}`}
          />
        ) : null}
      </span>
      <span
        className={`mt-0.5 flex w-full min-w-0 items-center justify-center gap-0.5 rounded-sm px-1 text-[0.6875rem] font-semibold leading-[1.125rem] ${pill}`}
      >
        {view.locked ? <Lock aria-hidden="true" className="size-2.5 shrink-0" /> : null}
        <span className="truncate">{view.player ? surname(view.player.name) : 'Empty'}</span>
      </span>
    </button>
  );
}
