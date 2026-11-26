import Link from 'next/link';

import { formatSigned } from '@/components/aflTradeStory/tradePageModel';
import type { GeneralManagerLadder } from './generalManagerLadder';
import { clubSquareBackground } from '@/lib/clubGuernseys';
import { getTeamAbbreviation } from '@/lib/teamLogos';

/**
 * The general managers page (/afl/trades/general-managers, owner 2026-11-26): every club's head of
 * football since 2019, ranked by the net PAV of the trades made while they ran the football
 * department. An asterisk marks a person whose dates in the role are not confirmed yet.
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

      <table className="w-full border-collapse text-left tabular-nums">
        <caption className="sr-only">General managers of football, highest net PAV first</caption>
        <thead>
          <tr className="border-b-2 border-foreground font-display text-xs font-bold text-muted-foreground">
            <th scope="col" className="w-[3ch] px-1 py-2 text-right">
              #
            </th>
            <th scope="col" className="px-2 py-2">
              General manager
            </th>
            <th scope="col" className="px-2 py-2">
              Club
            </th>
            <th scope="col" className="hidden px-2 py-2 sm:table-cell">
              Trade years
            </th>
            <th scope="col" className="px-2 py-2 text-right">
              Trades
            </th>
            <th scope="col" className="hidden px-2 py-2 text-right sm:table-cell">
              Per trade
            </th>
            <th scope="col" className="px-2 py-2 text-right">
              PAV +/−
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.person}|${row.club}`} className="border-b border-foreground/15">
              <td className="px-1 py-2 text-right text-muted-foreground">{index + 1}</td>
              <th scope="row" className="px-2 py-2 font-display font-bold">
                {row.person}
                {row.unconfirmed ? (
                  <>
                    <span aria-hidden="true">*</span>
                    <span className="sr-only"> (dates in the role not confirmed yet)</span>
                  </>
                ) : null}
              </th>
              <td className="px-2 py-2">
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <span
                    aria-hidden="true"
                    data-club-square=""
                    className="size-[13px] flex-none border border-foreground"
                    style={{ background: clubSquareBackground(row.club) }}
                  />
                  <span className="hidden sm:inline">{row.club}</span>
                  <abbr title={row.club} className="no-underline sm:hidden">
                    {getTeamAbbreviation(row.club)}
                  </abbr>
                </span>
              </td>
              <td className="hidden px-2 py-2 whitespace-nowrap sm:table-cell">
                {row.firstYear === row.lastYear
                  ? row.firstYear
                  : `${row.firstYear}–${row.lastYear}`}
              </td>
              <td className="px-2 py-2 text-right">{row.deals}</td>
              <td className="hidden px-2 py-2 text-right sm:table-cell">
                {formatSigned(row.perDeal)}
              </td>
              <td className="px-2 py-2 text-right font-semibold">{formatSigned(row.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>

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
