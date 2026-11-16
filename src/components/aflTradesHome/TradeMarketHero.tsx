import './marketHero.css';

/**
 * The top of the home page (owner's concept E, 2026-11-16): "Every October, footy goes to market."
 * A vintage cut-out collage of a high mark over a stadium, a price chart behind it and pit traders
 * in front. The pictures were generated with AI and show invented people, which the page says.
 */

const ART = '/Assets/stories/market';

export function TradeMarketHero({
  headingId,
  recordHref,
}: {
  headingId: string;
  /** Where "Read the record deal" goes. */
  recordHref: string;
}) {
  return (
    <div className="mh-stage">
      {/* eslint-disable @next/next/no-img-element -- cut-outs placed by shares of the stage */}
      <div className="mh-art">
        <img className="mh-chart" src={`${ART}/price-chart.svg`} alt="" aria-hidden="true" />
        <img
          className="mh-stadium"
          src={`${ART}/stadium.webp`}
          alt="Vintage halftone aerial view of a huge oval football stadium with light towers, its grass tinted green"
        />
        <img
          className="mh-mark"
          src={`${ART}/high-mark.webp`}
          alt="Vintage halftone cut-out of a footballer leaping over another player’s back to take a one-handed mark"
        />
        <img
          className="mh-traders"
          src={`${ART}/traders.webp`}
          alt="Vintage halftone cut-out of four traders in suits shouting bids, arms up waving trade slips"
        />
      </div>
      {/* eslint-enable @next/next/no-img-element */}
      <div className="mh-rule mh-label">
        <span>AFL stories</span>
        <span>The trade period</span>
      </div>
      <div className="mh-words">
        <p className="mh-kicker mh-label">Players · Picks · Prices</p>
        <h1 id={headingId} className="mh-title mh-label">
          Every October, footy goes to market.
        </h1>
        <p className="mh-lede">
          For a few weeks a year the game turns into a trading floor. Clubs bid in players, picks
          and futures, and the biggest deals go down to the final seconds.
        </p>
        <p className="mh-record mh-label">
          <b style={{ fontWeight: 600 }}>The record:</b> picks 13, 15 and 20 for one forward. GWS to
          Geelong, 2020.
        </p>
        <a href={recordHref} className="mh-button mh-label">
          Read the record deal ↓
        </a>
      </div>
      <p className="mh-note mh-label">Illustrations generated with AI · figures are invented</p>
    </div>
  );
}
