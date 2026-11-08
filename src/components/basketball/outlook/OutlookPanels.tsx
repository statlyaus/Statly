/**
 * The Outlook page's ranked lists, which replace the sheet's 'Role Model Charts'. Server-safe: no
 * hooks, tokens only, signs and words with every colour.
 */

import type { ReactNode } from 'react';

import type { OutlookDriver, OutlookPlayer } from '@/server/basketball/readModels/roleOutlook';

import { InjuryBadge, OwnerLabel } from '../analysis/AnalysisBits';
import { formatSigned } from '../analysis/format';
import type { OutlookPanels as Panels } from './outlookView';

/** "Gafford out +2.1": his minutes without that teammate minus with him, as the sheet shows. */
export const driverText = (driver: OutlookDriver) =>
  `${driver.name} ${driver.status === 'OUT' ? 'out' : 'back'} ${formatSigned(driver.minutes)}`;

/** A signed change on its result token; the sign carries the meaning, not the colour. */
export function SignedChange({ value, unit = '' }: { value: number; unit?: string }) {
  const tone = value > 0 ? 'text-result-win' : value < 0 ? 'text-result-loss' : 'text-foreground';
  return (
    <span className={`font-semibold tabular-nums ${tone}`}>
      {formatSigned(value)}
      {unit}
    </span>
  );
}

function RankedList({
  label,
  players,
  stale,
  detail,
  value,
}: {
  label: string;
  players: OutlookPlayer[];
  stale: boolean;
  detail: (player: OutlookPlayer) => string;
  value: (player: OutlookPlayer) => number;
}) {
  if (players.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">No player today.</p>;
  }
  return (
    <ol aria-label={label} className="divide-y divide-border">
      {players.map((player, index) => (
        <li key={player.playerId} className="flex min-h-12 items-center gap-2 py-1.5">
          <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-semibold text-foreground">{player.fullName}</span>
              <OwnerLabel owner={player.owner} />
              <InjuryBadge
                injury={player.injury}
                seasonEnding={player.injury?.seasonEnding}
                stale={stale}
              />
            </span>
            <span className="block truncate text-xs text-muted-foreground" title={detail(player)}>
              {detail(player)}
            </span>
          </span>
          <SignedChange value={value(player)} />
        </li>
      ))}
    </ol>
  );
}

function Panel({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-border bg-card p-4">
      <h3 id={id} className="font-display text-lg font-bold text-foreground">
        {title}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}

const n1 = (value: number) => value.toFixed(1);

/** The three lists: minute changes (up and down), injury shifts, points against average. */
export function OutlookPanels({ panels, stale }: { panels: Panels; stale: boolean }) {
  const minutes = (player: OutlookPlayer) =>
    `${player.teamCode} · ${n1(player.role.minutesLast5)} → ${n1(player.role.minutesNext5)} min`;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel
        id="outlook-minutes"
        title="Biggest minute changes"
        note="Minutes a game, next 5 against last 5. Players on 15+ minutes."
      >
        <div>
          <h4 className="text-sm font-semibold text-foreground">Gaining minutes</h4>
          <RankedList
            label="Gaining minutes"
            players={panels.gaining}
            stale={stale}
            detail={minutes}
            value={(player) => player.role.minutesChange}
          />
        </div>
        <div>
          <h4 className="text-sm font-semibold text-foreground">Losing minutes</h4>
          <RankedList
            label="Losing minutes"
            players={panels.losing}
            stale={stale}
            detail={minutes}
            value={(player) => player.role.minutesChange}
          />
        </div>
      </Panel>
      <Panel
        id="outlook-injuries"
        title="Minutes shift from injuries"
        note="Minutes a game: teammates newly out (+) or coming back (−)."
      >
        <RankedList
          label="Minutes shift from injuries"
          players={panels.injuryShifts}
          stale={stale}
          detail={(player) =>
            [player.teamCode, player.role.drivers.map(driverText).join('; ')]
              .filter(Boolean)
              .join(' · ')
          }
          value={(player) => player.role.injuryMinutesShift}
        />
      </Panel>
      <Panel
        id="outlook-points"
        title="Points against season average"
        note="Projected points a game, next 5, against his season average. Players on 15+ minutes."
      >
        <RankedList
          label="Points against season average"
          players={panels.pointsVsAverage}
          stale={stale}
          detail={(player) =>
            `${player.teamCode} · ${n1(player.next5.stats.pts)} next 5, ${n1(
              player.next5.stats.pts - player.next5.vsSeason.pts
            )} season`
          }
          value={(player) => player.next5.vsSeason.pts}
        />
      </Panel>
    </div>
  );
}
