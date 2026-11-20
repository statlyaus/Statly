import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'How Statly values AFL trades | Statly',
  description:
    'The method behind Statly’s AFL trade values: what is counted, where the numbers come from, and what is not final.',
};

const link =
  'underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const sources = [
  {
    name: 'HPN Footy',
    use: 'The Player Approximate Value (PAV) method and its published values. PAV is their work; Statly calculates seasons with their published method and checks against their published numbers.',
  },
  {
    name: 'AFL Tables',
    use: 'Player statistics and match results, the main input to every season’s PAV.',
  },
  {
    name: 'Footywire and the AFL',
    use: 'A second copy of the same player statistics, used only to confirm the AFL Tables numbers.',
  },
  {
    name: 'Draftguru and the AFL',
    use: 'Trades, draft selections and which club held each pick.',
  },
  { name: 'Footyinfo', use: 'Draft boards, including the picks spent to match a bid.' },
] as const;

/** The public method page: plain words, what is counted, what is not final, who is credited. */
export default function TradeMethodPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted-foreground">
        <Link href="/afl/trades" className={link}>
          AFL trades
        </Link>{' '}
        / How this works
      </nav>
      <h1 className="text-3xl font-semibold text-foreground text-balance">
        How Statly values AFL trades
      </h1>
      <div className="mt-4 max-w-[65ch] space-y-8 text-foreground">
        <section aria-labelledby="method-idea">
          <h2 id="method-idea" className="text-xl font-semibold">
            The idea
          </h2>
          <p className="mt-2">
            A trade is judged on the seasons after it. Each club’s result is what it received minus
            what it gave up, measured in PAV (Player Approximate Value), a single number for how
            much a player contributed in a season.
          </p>
        </section>

        <section aria-labelledby="method-counted">
          <h2 id="method-counted" className="text-xl font-semibold">
            What is counted
          </h2>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>
              <b>A traded player</b> counts for his first stint at the club that got him: every
              season from the trade until he leaves. If he later returns, that second stint is not
              counted.
            </li>
            <li>
              <b>A draft pick</b> counts as the player it was used on, for his first stint at the
              club that drafted him.
            </li>
            <li>
              <b>A pick spent matching a bid</b> counts for its share of the player the club matched
              the bid on, by the draft points it covered.
            </li>
            <li>
              <b>A pick whose draft is still to come</b> is valued at what its draft position has
              been worth on average.
            </li>
            <li>
              <b>A player still at his club</b> has what he has produced so far, plus what a stint
              like his usually goes on to add.
            </li>
          </ul>
          <p className="mt-3">
            Every trade balances: what one club gains, the others give up. Where a club traded a
            pick on, the trades are shown as a chain.
          </p>
        </section>

        <section aria-labelledby="method-not-final">
          <h2 id="method-not-final" className="text-xl font-semibold">
            What is not final
          </h2>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>
              Values move every season while a player is still at his club. A result only settles
              once every player in the trade has left the club that got him.
            </li>
            <li>
              A value marked * is not in yet, usually a pick whose path through the draft Statly has
              not confirmed. Totals leave it out, so they will change.
            </li>
            <li>
              The expected part of an open stint is an estimate from how similar stints have gone.
              It is not a prediction about any one player.
            </li>
            <li>These are Statly’s numbers. No club or the AFL has endorsed them.</li>
          </ul>
        </section>

        <section aria-labelledby="method-sources">
          <h2 id="method-sources" className="text-xl font-semibold">
            Where the numbers come from
          </h2>
          <dl className="mt-2 space-y-3">
            {sources.map((source) => (
              <div key={source.name}>
                <dt className="font-semibold">{source.name}</dt>
                <dd className="text-muted-foreground">{source.use}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-muted-foreground">
            Club colours only: Statly does not use club logos.
          </p>
        </section>
      </div>
    </div>
  );
}
