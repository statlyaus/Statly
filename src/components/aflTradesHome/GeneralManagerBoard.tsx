import Link from 'next/link';

import type {
  GeneralManagerLadder,
  GeneralManagerLadderRow,
} from '@/components/aflGeneralManagers/generalManagerLadder';
import { formatSigned } from '@/components/aflTradeStory/tradePageModel';
import { clubSquareBackground } from '@/lib/clubGuernseys';

/**
 * The front page's general managers board (owner, 2026-11-26): the five heads of football whose
 * clubs' trades came out furthest ahead and the five furthest behind, leading to the full ladder.
 */

const SHOWN = 5;
const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

function Column({
  id,
  title,
  rows,
}: {
  id: string;
  title: string;
  rows: readonly GeneralManagerLadderRow[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 id={id} className="font-display text-2xl font-bold">
        {title}
      </h3>
      <ol aria-labelledby={id} className="tabular-nums">
        {rows.map((row) => (
          <li
            key={`${row.person}|${row.club}`}
            className="flex items-center justify-between gap-3 border-b border-foreground/15 py-2"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-display font-bold">
                {row.person}
                {row.unconfirmed ? (
                  <>
                    <span aria-hidden="true">*</span>
                    <span className="sr-only"> (dates in the role not confirmed yet)</span>
                  </>
                ) : null}
              </span>
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <span
                  aria-hidden="true"
                  data-club-square=""
                  className="size-[11px] flex-none border border-foreground"
                  style={{ background: clubSquareBackground(row.club) }}
                />
                {row.club}, {row.deals} {row.deals === 1 ? 'trade' : 'trades'}
              </span>
            </span>
            <b className="font-display text-xl font-extrabold">
              {formatSigned(row.net)}
              <span className="sr-only"> PAV</span>
            </b>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function GeneralManagerBoard({
  ladder,
  titleClassName,
}: {
  ladder: GeneralManagerLadder;
  titleClassName: string;
}) {
  const { rows } = ladder;
  if (rows.length < SHOWN * 2) return null;
  const top = rows.slice(0, SHOWN);
  const bottom = rows.slice(-SHOWN).reverse();
  return (
    <section aria-labelledby="general-managers">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2 border-b-4 border-foreground pb-3">
        <h2 id="general-managers" className={titleClassName}>
          General managers
        </h2>
        <Link
          href="/afl/trades/general-managers"
          className={`inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4 ${focusRing}`}
        >
          Every general manager
        </Link>
      </div>
      <p className="mt-3 max-w-3xl text-muted-foreground">
        Each club’s head of football since 2019, by the net PAV of the trades made on their watch.
      </p>
      <div className="mt-5 grid gap-8 sm:grid-cols-2">
        <Column id="general-managers-top" title="Furthest ahead" rows={top} />
        <Column id="general-managers-bottom" title="Furthest behind" rows={bottom} />
      </div>
      {[...top, ...bottom].some(({ unconfirmed }) => unconfirmed) ? (
        <p className="mt-3 text-sm text-muted-foreground">* Dates in the role not confirmed yet.</p>
      ) : null}
    </section>
  );
}
