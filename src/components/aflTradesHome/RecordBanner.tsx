import Link from 'next/link';

import './marketHero.css';

/**
 * The record deal as a taped paper strip under the home hero, leading to that trade's page (owner,
 * 2026-11-18: the record line and its button moved out of the hero into "a banner below leading to
 * that trade"). It sits inside the story collage section, so it uses the collage's typefaces.
 */
export function RecordBanner({ href, result }: { href: string; result?: string }) {
  return (
    <div className="mh-banner-wrap">
      <span className="mh-banner-tape" aria-hidden="true" />
      <Link href={href} className="mh-banner">
        <span className="mh-banner-kicker sc-marker">The record</span>
        <span className="mh-banner-deal sc-label">
          Picks 13, 15 and 20 for one forward. GWS to Geelong, 2020.
        </span>
        {result ? <span className="mh-banner-result sc-hand">{result}</span> : null}
        <span className="mh-banner-cta sc-label">
          Read the trade <span aria-hidden="true">→</span>
        </span>
      </Link>
    </div>
  );
}
