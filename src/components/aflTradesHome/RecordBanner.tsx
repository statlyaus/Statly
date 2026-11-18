import type { ReactNode } from 'react';

import Link from 'next/link';

import './marketHero.css';

/**
 * The record deal as a filled-in trade slip under the home hero, like the slips its traders wave,
 * leading to that trade's page (owner, 2026-11-18: the record line moved out of the hero into "a
 * banner below leading to that trade"; concept A of the Magic Patterns canvas "Record Trade
 * Banner"). It sits inside the story collage section, so it uses the collage's typefaces.
 */
export function RecordBanner({
  href,
  clubName,
  result,
}: {
  href: string;
  clubName: string;
  /** The receiving club's result so far, signed, in PAV. */
  result: string;
}) {
  return (
    <Link href={href} className="mh-slip">
      <span className="mh-slip-stub">
        <span className="sc-label">Trade slip</span>
        <span className="mh-slip-no sc-marker">No.1</span>
        <span className="sc-label">Oct 2020</span>
      </span>
      <span className="mh-slip-fields">
        <span className="mh-slip-kicker sc-label">The record deal · GWS to Geelong, 2020</span>
        <Field label="Seller">GWS Giants</Field>
        <Field label="Buyer">Geelong</Field>
        <Field label="Lot" wide>
          One forward: Jeremy Cameron
        </Field>
        <Field label="Price paid" wide>
          Picks <Circled n={13} /> <Circled n={15} /> and <Circled n={20} />
        </Field>
      </span>
      <span className="mh-slip-result">
        <span className="mh-slip-stamp sc-label" aria-hidden="true">
          Sold
        </span>
        <span>
          <span className="mh-slip-label sc-label">Return so far</span>
          <span className="mh-slip-value sc-marker">{result}</span>
          <span className="mh-slip-note sc-hand">to {clubName}, in PAV</span>
        </span>
        <span className="mh-slip-cta sc-label">
          Read the trade <span aria-hidden="true">→</span>
        </span>
      </span>
    </Link>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <span className={wide ? 'mh-slip-field mh-slip-wide' : 'mh-slip-field'}>
      <span className="mh-slip-label sc-label">{label}</span>
      <span className="mh-slip-entry sc-hand">{children}</span>
    </span>
  );
}

/** A pick number ringed in red marker, as a trader would on the slip. */
function Circled({ n }: { n: number }) {
  return (
    <span className="mh-slip-ring">
      {n}
      <svg aria-hidden="true" viewBox="0 0 60 44" preserveAspectRatio="none">
        <path d="M8 24 C6 10 24 3 38 5 C54 7 58 20 52 31 C46 41 22 43 12 35 C7 31 6 27 9 22" />
      </svg>
    </span>
  );
}
