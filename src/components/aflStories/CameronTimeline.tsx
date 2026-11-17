import { Fragment } from 'react';

import { Sketch } from './collageParts';

/**
 * The Jeremy Cameron story as one band read left to right (owner's design, 2026-11-16): orange while
 * he was a Giant, navy hoops once he was a Cat, the change at the 2020 trade. Each year has a sketch
 * on one side of the band and its chapter on the other; picking a year goes to that chapter.
 */

interface Stop {
  readonly year: string;
  readonly boxed?: boolean;
  /** Which chapter (1 to 6) the stop opens. */
  readonly chapter: number;
  readonly label: string;
  readonly name: string;
  readonly words: string;
  /** Where the words sit; the sketch takes the other side. */
  readonly wordsSide: 'top' | 'bottom';
  readonly sketch: string;
  readonly sketchWidth: string;
}

const STOPS: readonly Stop[] = [
  {
    year: '2010',
    chapter: 1,
    label: 'Ch. 1',
    name: 'Dartmoor',
    words: 'Town of ~150. Signed by GWS at 17.',
    wordsSide: 'bottom',
    sketch: 'country-ground',
    sketchWidth: '112%',
  },
  {
    year: '2012',
    chapter: 2,
    label: 'Ch. 2',
    name: 'Giants orange',
    words: '29 goals in year one. Top goalkicker 9 years.',
    wordsSide: 'top',
    sketch: 'guernsey-orange',
    sketchWidth: '80%',
  },
  {
    year: '2019',
    chapter: 2,
    label: 'Ch. 2',
    name: 'Coleman Medal',
    words: '67 goals, nine of them in his 150th game.',
    wordsSide: 'bottom',
    sketch: 'football',
    sketchWidth: '90%',
  },
  {
    year: '2020',
    boxed: true,
    chapter: 3,
    label: 'Ch. 3: the break',
    name: 'The trade',
    words: 'Picks 13, 15 & 20, in the dying seconds.',
    wordsSide: 'top',
    sketch: 'stopwatch',
    sketchWidth: '90%',
  },
  {
    year: '2021',
    chapter: 4,
    label: 'Ch. 4',
    name: 'New stripes',
    words: 'Home to Victoria. 15 games, year one.',
    wordsSide: 'bottom',
    sketch: 'light-tower',
    sketchWidth: '72%',
  },
  {
    year: '2022',
    chapter: 5,
    label: 'Ch. 5',
    name: 'Best & fairest',
    words: 'Carji Greeves Medal. All-Australian again.',
    wordsSide: 'top',
    sketch: 'guernsey-hoops',
    sketchWidth: '80%',
  },
  {
    year: '24.09',
    boxed: true,
    chapter: 6,
    label: 'Ch. 6',
    name: 'Premiers',
    words: 'Geelong by 81 points in front of 100,024.',
    wordsSide: 'bottom',
    sketch: 'cup',
    sketchWidth: '104%',
  },
];

export function CameronTimeline({
  base = '',
  hint,
  onOpen,
}: {
  /** The story page's address when the band sits on another page. */
  base?: string;
  hint: string;
  onOpen?: (chapter: number) => void;
}) {
  return (
    <nav aria-label="The story, year by year">
      <p className="sc-hand" style={{ fontSize: '2rem', color: 'var(--sc-red)' }}>
        {hint}
      </p>
      <div className="sc-line-scroll">
        <div className="sc-line">
          <span
            aria-hidden="true"
            className="sc-line-band sc-halftone-o"
            style={{ gridColumn: '1 / 5', marginRight: '12.5%' }}
          />
          <span
            aria-hidden="true"
            className="sc-line-band sc-line-band-navy"
            style={{ gridColumn: '4 / 8', marginLeft: '12.5%' }}
          />
          {STOPS.map((stop, index) => {
            const column = index + 1;
            const artSide = stop.wordsSide === 'top' ? 'bottom' : 'top';
            return (
              <Fragment key={stop.year}>
                <a
                  href={`${base}#ch${stop.chapter}`}
                  className={`sc-line-slot sc-line-slot-${stop.wordsSide}`}
                  style={{ gridColumn: column }}
                  onClick={onOpen ? () => onOpen(stop.chapter - 1) : undefined}
                >
                  <span className="sc-line-chapter">{stop.label}</span>
                  <b className="sc-label sc-line-name">{stop.name}</b>
                  <span className="sc-line-words">{stop.words}</span>
                  <span className="sc-label sc-line-read">
                    Read →<span className="sr-only"> the {stop.year} chapter</span>
                  </span>
                </a>
                <b
                  aria-hidden="true"
                  className={`sc-label sc-line-year${stop.boxed ? ' sc-line-year-boxed' : ''}`}
                  style={{ gridColumn: column }}
                >
                  {stop.year}
                </b>
                <span
                  aria-hidden="true"
                  className={`sc-line-slot sc-line-art sc-line-slot-${artSide}`}
                  style={{ gridColumn: column }}
                >
                  <Sketch
                    name={stop.sketch}
                    style={{ position: 'static', width: stop.sketchWidth }}
                  />
                </span>
              </Fragment>
            );
          })}
          <span
            aria-hidden="true"
            className="sc-tape"
            style={{
              position: 'relative',
              gridRow: 2,
              gridColumn: 4,
              zIndex: 1,
              width: '34%',
              height: 'auto',
              margin: '-1.3rem 0 -1.3rem 34%',
              transform: 'rotate(4deg)',
            }}
          />
        </div>
      </div>
    </nav>
  );
}
