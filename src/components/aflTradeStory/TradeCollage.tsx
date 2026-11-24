import type { CSSProperties } from 'react';

import { STORY_COLLAGE_CLASS } from '@/components/aflStories/CameronMasthead';
import { GUERNSEY_SKETCH, GUERNSEY_VIEW_BOX } from '@/components/aflStories/guernseySketch';
import type { AflTradeStory } from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import {
  clubStyle,
  formatSigned,
  inSentence,
  isProjection,
  netText,
  tradeLeader,
  tradeName,
  verdictTail,
} from './tradePageModel';

/**
 * The top of a public trade page (owner, 2026-11-16: every trade gets a collage). It is drawn from
 * the trade's own values and nothing else: each club's guernsey in its colours, its result on a taped
 * note, what it got, and a band of who was ahead at each point the value lines hold.
 */

type Asset = AflTradeStory['sides'][number]['received'][number];

/** "Pick 13 → Conor Stone" when a pick became a player; otherwise the asset's own label. */
function assetText(asset: Asset): string {
  const became =
    asset.assetKind === 'pick' &&
    (asset.outcome.kind === 'player' || asset.outcome.kind === 'bid_share')
      ? ` → ${asset.outcome.playerName}`
      : '';
  return `${inSentence(asset.label)}${became}`;
}

const SHOWN = 4;
const level = (net: number) => Number(Math.abs(net).toFixed(1)) === 0;

function ClubGuernsey({ clubName }: { clubName: string }) {
  const style = clubStyle(clubName);
  return (
    <svg
      aria-hidden="true"
      className="tc-guernsey"
      viewBox={GUERNSEY_VIEW_BOX}
      style={{ '--g-fill': style.fill, '--g-trim': style.trim } as CSSProperties}
      // The owner's own sketch, shipped with the site: static markup, no user input.
      dangerouslySetInnerHTML={{ __html: GUERNSEY_SKETCH }}
    />
  );
}

/** Who was ahead at each checkpoint, left to right, in the leader's colour. */
function LeadBand({ story }: { story: AflTradeStory }) {
  const nets = story.nets.tradeAlone;
  const points = nets[0]?.line ?? [];
  if (points.length < 2) return null;
  const stops = points.map(({ checkpoint }, index) => {
    const leader = nets.reduce((top, club) =>
      (club.line[index]?.net ?? -Infinity) > (top.line[index]?.net ?? -Infinity) ? club : top
    );
    const net = leader.line[index]?.net ?? 0;
    const tied = level(net);
    return {
      key: `${checkpoint.kind}-${checkpoint.season}`,
      year: checkpoint.season,
      kind:
        checkpoint.kind === 'trade'
          ? 'The trade'
          : checkpoint.kind === 'draft'
            ? 'Draft'
            : 'Season',
      boxed: checkpoint.kind === 'trade',
      draft: checkpoint.kind === 'draft',
      text: tied ? 'Level' : `${leader.clubName} ${formatSigned(net)}`,
      style: tied ? null : clubStyle(leader.clubName),
    };
  });
  return (
    <div className="tc-band-scroll">
      <ol
        className="tc-band"
        aria-label="Who was ahead, point by point"
        style={{ gridTemplateColumns: `repeat(${stops.length}, minmax(6.5rem, 1fr))` }}
      >
        {stops.map((stop, index) => (
          <li key={stop.key} className={index % 2 === 0 ? 'tc-stop tc-stop-up' : 'tc-stop'}>
            <span className="tc-stop-words">
              <span className="sc-line-chapter">{stop.kind}</span>
              <span className="sc-hand tc-stop-lead">{stop.text}</span>
            </span>
            <span
              className="tc-stop-year sc-label"
              style={{
                background: stop.style?.fill ?? 'var(--sc-grey)',
                borderColor: stop.style?.trim ?? 'var(--sc-grey)',
                color: stop.style?.ink ?? 'var(--sc-paper)',
              }}
            >
              <b className={stop.boxed ? 'tc-boxed' : undefined}>{stop.year}</b>
              {stop.draft ? <small>draft</small> : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function TradeCollage({ story, headline }: { story: AflTradeStory; headline: string }) {
  const nets = story.nets.tradeAlone;
  const leader = tradeLeader(story);
  const leaderStyle = leader ? clubStyle(leader.clubName) : null;
  return (
    // data-collage: the head is a story collage the owner is redesigning (ticket 06h); the brand
    // conformance check in tests/e2e/public-trades-brand.test.ts skips it.
    <header className={`${STORY_COLLAGE_CLASS} tc`} data-collage>
      <div className="sc-bar sc-label" style={{ fontSize: 15 }}>
        <span>AFL trades · {story.trade.year}</span>
        <span>{tradeName(story.trade.clubs)}</span>
      </div>
      <h1 className="sc-marker tc-title">
        {!leader || !leaderStyle ? (
          headline
        ) : (
          <>
            <span
              className="sc-tornB"
              style={{ background: leaderStyle.fill, color: leaderStyle.ink }}
            >
              {leader.clubName}
            </span>{' '}
            are ahead {verdictTail(story)}
          </>
        )}
      </h1>
      <ul className="tc-clubs" aria-label="Each club’s result and what it got">
        {story.sides.map((side, index) => {
          const net = nets.find(({ clubId }) => clubId === side.clubId);
          const more = side.received.length - SHOWN;
          return (
            <li key={side.clubId} className="tc-club">
              <span className="tc-hang" style={{ transform: `rotate(${index % 2 ? 5 : -5}deg)` }}>
                <span aria-hidden="true" className="sc-tape tc-tape" />
                <ClubGuernsey clubName={side.clubName} />
              </span>
              <div className="tc-club-words">
                <p className="sc-hand sc-hand-xl">{side.clubName}</p>
                {net ? (
                  <div className="sc-note tc-note">
                    <b className="sc-label">{netText(net)}</b>
                    <p className="sc-hand sc-hand-sm">
                      {isProjection(story) ? 'PAV projected' : 'PAV so far'}
                    </p>
                  </div>
                ) : null}
                <div className="tc-got">
                  <p className="sc-hand" style={{ color: 'var(--sc-red)' }}>
                    got
                  </p>
                  <ul>
                    {side.received.slice(0, SHOWN).map((asset) => (
                      <li key={asset.transferId}>{assetText(asset)}</li>
                    ))}
                    {more > 0 ? <li>and {more} more</li> : null}
                  </ul>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <LeadBand story={story} />
    </header>
  );
}
