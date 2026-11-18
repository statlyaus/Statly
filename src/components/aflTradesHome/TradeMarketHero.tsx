import './marketHero.css';

/**
 * The top of the home page (owner's concept E, 2026-11-16): "Every October, footy goes to market."
 * A vintage cut-out collage of a high mark over a stadium, a price chart behind it and pit traders
 * in front. The pictures were generated with AI and show invented people; the owner chose not to
 * caption them (2026-11-17). On load the leaper climbs into the mark and the traders pump their slips
 * (owner, 2026-11-18); with reduced motion everything stays still. The record deal sits in a paper
 * strip under the hero (`RecordBanner`), not in it (owner, 2026-11-18).
 */

const ART = '/Assets/stories/market';
const LAYERS = `${ART}/layers`;
const TRADER_ARMS = ['a', 'b', 'c', 'd', 'e'] as const;

export function TradeMarketHero({ headingId }: { headingId: string }) {
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
        {/* Paper puppets cut by Scripts/design/slice-market-hero.mjs; at rest they make the original cut-outs. */}
        <div
          className="mh-mark"
          role="img"
          aria-label="Vintage halftone cut-out of a footballer leaping over another player’s back to take a one-handed mark"
        >
          <img className="mh-layer" src={`${LAYERS}/mark-base.webp`} alt="" />
          <div className="mh-layer mh-leap">
            <div className="mh-layer mh-hang">
              <img className="mh-layer" src={`${LAYERS}/mark-leaper.webp`} alt="" />
              <div className="mh-layer mh-reach">
                <img className="mh-layer mh-reach-hang" src={`${LAYERS}/mark-arm.webp`} alt="" />
              </div>
            </div>
          </div>
        </div>
        <div
          className="mh-traders"
          role="img"
          aria-label="Vintage halftone cut-out of four traders in suits shouting bids, arms up waving trade slips"
        >
          <img className="mh-layer" src={`${LAYERS}/traders-base.webp`} alt="" />
          {TRADER_ARMS.map((arm) => (
            <img
              key={arm}
              className={`mh-layer mh-pump mh-pump-${arm}`}
              src={`${LAYERS}/traders-arm-${arm}.webp`}
              alt=""
            />
          ))}
        </div>
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
      </div>
    </div>
  );
}
