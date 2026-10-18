/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- A wide timeline needs a named keyboard-scroll target. */
import type { AflTradeStory } from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import {
  BAND,
  bandPath,
  Callout,
  END_BLOCK,
  EndBlock,
  Fringe,
  FRINGE,
  HEIGHT,
  Panels,
  topEdge,
} from './ScarfParts';
import { scarfPlayers, scarfSteps } from './scarfTimeline';
import { clubStyle, formatPav, netText, tradeName } from './tradePageModel';

/**
 * The scarf timeline hero: who the trade came down to, as club-coloured panels in the order they
 * arrived, with every trade, draft and sourced event pinned along it. A static SVG, drawn on the
 * server; the same facts are listed for screen readers.
 */
export function TradeScarf({
  story,
  throughSeason,
}: {
  story: AflTradeStory;
  throughSeason: number;
}) {
  const players = scarfPlayers(story);
  const steps = scarfSteps(story);
  const clubs = new Map(
    story.lineage.trades.flatMap(({ clubs: tradeClubs }) =>
      tradeClubs.map((club) => [club.clubId, club.clubName])
    )
  );
  const pending = story.nets.withNextMoves.some(({ pendingCount }) => pendingCount > 0);

  const width = Math.max(820, 260 + steps.length * 95);
  const bandStart = 30 + FRINGE;
  const bandEnd = width - 30 - FRINGE;
  const endX = bandEnd - END_BLOCK;
  const bandMid = topEdge((bandStart + endX) / 2) + BAND / 2;
  const first = steps.length > 1 ? bandStart + 50 : (bandStart + endX) / 2;
  const spacing = steps.length > 1 ? (endX - 40 - first) / (steps.length - 1) : 0;
  const fringeColours = (clubName: string | undefined) => {
    const style = clubStyle(clubName ?? '');
    return [style.fill, style.trim];
  };

  return (
    <figure
      aria-labelledby="scarf-title"
      className="overflow-hidden rounded-2xl lg:grid lg:grid-cols-[220px_1fr]"
    >
      <div className="bg-(--ts-scarf-side) p-5 text-(--ts-scarf-side-ink)">
        <p id="scarf-title" className="text-xl font-bold leading-tight">
          {tradeName(story.trade.clubs)}, {story.trade.year}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-1">
          <p className="flex flex-col">
            <span className="text-3xl font-bold tabular-nums">{story.lineage.trades.length}</span>
            <span className="text-sm text-(--ts-scarf-side-muted)">trades in the chain</span>
          </p>
          <p className="flex flex-col">
            <span className="text-3xl font-bold tabular-nums">{clubs.size}</span>
            <span className="text-sm text-(--ts-scarf-side-muted)">clubs involved</span>
          </p>
        </div>
        {players.length > 0 ? (
          <>
            <p className="mt-5 text-sm font-semibold">Who it came down to</p>
            <ul className="mt-2 space-y-2">
              {[...players]
                .sort((left, right) => right.value - left.value)
                .map((player) => {
                  const style = clubStyle(player.clubName);
                  return (
                    <li key={player.key} className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="flex size-9 flex-none items-center justify-center rounded-full border-2 text-xs font-bold"
                        style={{
                          background: style.fill,
                          color: style.ink,
                          borderColor: style.trim,
                        }}
                      >
                        {player.name
                          .split(' ')
                          .map((part) => part[0])
                          .join('')
                          .slice(0, 2)}
                      </span>
                      <span className="text-sm leading-tight">
                        <span className="block font-semibold">{player.name}</span>
                        <span className="text-(--ts-scarf-side-muted)">
                          {formatPav(player.value)} ·{' '}
                          {player.gotAway ? 'got away' : player.clubName}
                        </span>
                      </span>
                    </li>
                  );
                })}
            </ul>
          </>
        ) : null}
        {pending ? (
          <p className="mt-5 text-xs text-(--ts-scarf-side-muted)">
            * Leaves out picks with a value pending.
          </p>
        ) : null}
      </div>

      <div className="bg-(--ts-scarf-bg)">
        <p className="px-4 pt-3 text-sm text-(--ts-ink2) lg:hidden">
          Swipe sideways to follow the timeline.
        </p>
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Timeline picture. It scrolls sideways."
        >
          <svg
            viewBox={`0 0 ${width} ${HEIGHT}`}
            width={width}
            height={HEIGHT}
            className="block h-auto max-w-none lg:w-full lg:max-w-full"
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <clipPath id="scarf-band">
                <path d={bandPath(bandStart, endX)} />
              </clipPath>
            </defs>
            <path d={bandPath(bandStart, bandEnd, 14)} fill="var(--ts-scarf-shadow)" />
            <Fringe x={bandStart} direction={-1} colours={fringeColours(players[0]?.clubName)} />
            <Fringe
              x={bandEnd}
              direction={1}
              colours={fringeColours(story.trade.clubs[0]?.clubName)}
            />
            <g clipPath="url(#scarf-band)">
              <Panels players={players} start={bandStart} end={endX} bandMid={bandMid} />
            </g>
            <EndBlock story={story} throughSeason={throughSeason} x={endX} />
            {steps.map((step, index) => {
              const x = first + index * spacing;
              const wrap = Math.max(
                18,
                Math.min(34, Math.floor((Math.min(2 * spacing, width - x) - 20) / 7.5))
              );
              return (
                <Callout key={step.key} step={step} x={x} above={index % 2 === 0} wrap={wrap} />
              );
            })}
          </svg>
        </div>
      </div>

      <figcaption className="sr-only">
        <p>Timeline, oldest first.</p>
        <ol>
          {steps.map((step) => (
            <li key={step.key}>
              {step.label}. {step.title}. {step.text}
            </li>
          ))}
          <li>
            {throughSeason}:{' '}
            {story.nets.withNextMoves.map((net) => `${net.clubName} ${netText(net)}`).join(', ')}.
          </li>
        </ol>
      </figcaption>
    </figure>
  );
}
