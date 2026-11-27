import Link from 'next/link';

import type { GeneralManagerLadder } from './generalManagerLadder';
import { GeneralManagersTable } from './GeneralManagersTable';

/**
 * The general managers page (/afl/trades/general-managers, owner 2026-11-26): every club's head of
 * football since 2019, ranked by the net PAV of the trades made while they ran the football
 * department, or by per trade when the reader picks it. An asterisk marks a person whose dates in the role are not confirmed yet.
 */

const focusRing =
  'focus-visible:outline-[3px] focus-visible:outline-ring focus-visible:outline-dashed';

export function GeneralManagersPage({ ladder }: { ladder: GeneralManagerLadder }) {
  const { rows, uncredited, projected } = ladder;
  const anyUnconfirmed = rows.some(({ unconfirmed }) => unconfirmed);
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
      <header className="flex max-w-3xl flex-col gap-4">
        <h1 className="font-display text-5xl leading-none font-extrabold sm:text-6xl">
          General managers of football
        </h1>
        <p className="text-lg leading-7">
          Every club’s head of football since 2019, ranked by how their club’s trades turned out
          while they ran the football department.
        </p>
        <p className="leading-7 text-muted-foreground">
          Each trade a club made goes to the person in the role in that October’s trade period
          (November in 2020). Their number is the sum of those trades’ results: what the club got,
          minus what it gave, in PAV, the same number each trade’s page shows. Where two people
          shared the role, each gets half. A trade no season has been played since is still a
          projection, so it waits until one has, as on the trade ladder.{' '}
          <Link
            href="/afl/trades/method"
            className={`font-semibold text-foreground underline underline-offset-4 ${focusRing}`}
          >
            How the numbers work
          </Link>
        </p>
      </header>

      <GeneralManagersTable rows={rows} />

      <div className="flex max-w-3xl flex-col gap-2 text-sm leading-6 text-muted-foreground">
        {anyUnconfirmed ? (
          <p>
            * We haven’t confirmed this person’s start or finish month in the role yet, so a trade
            near the change may belong to the person before or after.
          </p>
        ) : null}
        {projected > 0 ? (
          <p>
            {projected} {projected === 1 ? 'trade side is' : 'trade sides are'} waiting for a season
            to be played before they count.
          </p>
        ) : null}
        {uncredited > 0 ? (
          <p>
            {uncredited} {uncredited === 1 ? 'trade side is' : 'trade sides are'} left out because
            the club had nobody in the role during that trade period.
          </p>
        ) : null}
      </div>
    </div>
  );
}
