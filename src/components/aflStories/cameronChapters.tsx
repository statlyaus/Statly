import type { ReactNode } from 'react';

import { Hand, Note, Sketch, Stage, Tape, place } from './collageParts';

/**
 * "From Giant to Cat": the Jeremy Cameron story, 2010 to 2022 (owner's storyboard, 2026-11-16). Each
 * chapter is a headline, a collage and the words behind it. The facts are from the sources named at
 * the foot of the page; the sketches are original and show club colours only.
 */

export interface StoryChapter {
  readonly kicker: string;
  readonly when: string;
  /** The chapter slip in the masthead: a date and a handwritten name. */
  readonly slip: readonly [string, string];
  readonly slipColour: string;
  readonly slipRotate: number;
  readonly title: ReactNode;
  readonly standfirst: string;
  readonly collage: ReactNode;
  readonly body: readonly string[];
  readonly quote?: { readonly words: string; readonly by: string };
}

/** Confetti for the grand final: [left %, top %, width %, height %, colour, rotation]. */
const CONFETTI: readonly (readonly [number, number, number, number, string, number])[] = [
  [57, 19, 0.9, 2.6, 'var(--sc-navy)', 45],
  [55, 66, 1.2, 3.9, 'var(--sc-navy)', 36],
  [78, 56, 1.4, 3.6, 'var(--sc-navy)', 155],
  [44, 44, 0.9, 3.2, 'var(--sc-navy)', 170],
  [65, 74, 1.2, 2.9, 'var(--sc-sky)', 100],
  [58, 35, 1.5, 2.3, 'var(--sc-paper)', 109],
  [94, 34, 1.0, 3.9, 'var(--sc-paper)', 135],
  [59, 89, 0.9, 3.1, 'var(--sc-paper)', 7],
  [32, 45, 1.5, 2.3, 'var(--sc-navy)', 114],
  [39, 59, 1.1, 2.4, 'var(--sc-navy)', 36],
  [82, 5, 1.0, 2.7, 'var(--sc-navy)', 149],
  [38, 90, 1.2, 2.3, 'var(--sc-paper)', 109],
  [57, 9, 0.9, 2.5, 'var(--sc-paper)', 74],
  [91, 85, 1.1, 3.1, 'var(--sc-paper)', 152],
  [38, 79, 0.9, 2.3, 'var(--sc-sky)', 2],
  [85, 32, 1.1, 2.8, 'var(--sc-navy)', 69],
  [84, 51, 0.9, 2.3, 'var(--sc-sky)', 130],
  [56, 43, 1.0, 3.4, 'var(--sc-sky)', 19],
  [75, 30, 1.4, 3.5, 'var(--sc-paper)', 69],
  [59, 92, 1.5, 3.0, 'var(--sc-sky)', 13],
  [49, 66, 1.1, 3.1, 'var(--sc-paper)', 167],
  [47, 85, 1.1, 3.4, 'var(--sc-paper)', 51],
  [75, 58, 1.6, 3.4, 'var(--sc-navy)', 35],
  [52, 19, 0.8, 2.8, 'var(--sc-sky)', 174],
  [43, 64, 0.9, 3.4, 'var(--sc-navy)', 134],
  [87, 22, 1.5, 2.8, 'var(--sc-navy)', 1],
];

const noteLine = { margin: 0, fontSize: 'clamp(18px, 1.9vw, 26px)', lineHeight: 1.3 } as const;

function CircledPick({ pick }: { pick: string }) {
  return (
    <span style={{ position: 'relative', display: 'inline-block', padding: '0 0.35em' }}>
      <Sketch name="circle" left="-14%" top="-10%" width="128%" style={{ height: '118%' }} />
      <span
        className="sc-hand"
        style={{ position: 'relative', fontSize: 'clamp(40px, 5vw, 76px)', lineHeight: 1 }}
      >
        {pick}
      </span>
    </span>
  );
}

export const CAMERON_CHAPTERS: readonly StoryChapter[] = [
  {
    kicker: 'Chapter 01: Home',
    when: '2010',
    slip: ['2010', 'Dartmoor'],
    slipColour: 'var(--sc-paper)',
    slipRotate: -3,
    title: (
      <>
        A town of <em>150</em> people
      </>
    ),
    standfirst:
      'Before he was anyone’s spearhead, Jeremy Cameron was a kid from the far south-west corner of Victoria.',
    collage: (
      <Stage label="Collage: ink sketch of a country football ground, a one-way ticket from Dartmoor to Western Sydney, and a note that he was 17">
        <div
          className="sc-tornA"
          style={{
            ...place({ left: '1%', top: '6%', width: '60%', rotate: -2, z: 1 }),
            boxSizing: 'border-box',
            padding: '3% 3% 4%',
            background: 'var(--sc-paper)',
          }}
        >
          <Sketch
            name="country-ground"
            style={{ position: 'static', display: 'block', width: '100%' }}
          />
        </div>
        <Tape left="5%" top="2%" width="13%" rotate={-9} z={5} />
        <Tape left="47%" top="3%" width="12%" rotate={7} z={5} />
        <Hand size="xl" left="4%" top="66%" rotate={-2}>
          Dartmoor, Vic. Pop. ~150
        </Hand>
        <Sketch name="underline" left="4%" top="77%" width="28%" rotate={-2} z={1} />
        <div
          className="sc-tornB sc-halftone-o"
          style={{
            ...place({ right: '3%', top: '8%', width: '33%', rotate: 5, z: 3 }),
            boxSizing: 'border-box',
            padding: '4% 4% 4% 7%',
            borderLeft: '3px dashed color-mix(in srgb, var(--sc-ink) 55%, transparent)',
          }}
        >
          <p
            className="sc-marker"
            style={{ margin: 0, fontSize: 'clamp(26px, 3.2vw, 48px)', lineHeight: 1 }}
          >
            One way
          </p>
          <p
            className="sc-label"
            style={{ margin: '0.6rem 0 0', fontSize: 'clamp(13px, 1.3vw, 18px)', lineHeight: 1.3 }}
          >
            Dartmoor → Western Sydney
          </p>
          <p
            className="sc-label"
            style={{ margin: '0.4rem 0 0', fontWeight: 500, fontSize: 'clamp(11px, 1vw, 14px)' }}
          >
            Nov 2010 · Underage recruit
          </p>
        </div>
        <Sketch name="arrow" left="33%" top="62%" width="18%" rotate={-6} z={1} />
        <Note value="17" left="60%" top="62%" width="24%" rotate={-3}>
          years old when the Giants signed him
        </Note>
      </Stage>
    ),
    body: [
      'Jeremy Cameron was born on 1 April 1993 and grew up in Dartmoor, a town of about 150 people between Portland and Mount Gambier. Football took him away early, to Ballarat and the North Ballarat Rebels in the TAC Cup.',
      'In November 2010, aged 17, he was signed as an underage recruit by Greater Western Sydney, a club that was still a year away from playing its first AFL game. For a teenager from the edge of the state, the next stop was not Melbourne. It was Sydney’s west.',
    ],
  },
  {
    kicker: 'Chapter 02: The Giants',
    when: '2012–2019',
    slip: ['2012–19', 'The Giants'],
    slipColour: 'var(--sc-slip-peach)',
    slipRotate: 2,
    title: (
      <>
        The new club’s <em>first</em> great forward
      </>
    ),
    standfirst:
      'An expansion team needed something to build around. It got nine straight seasons of goals.',
    collage: (
      <Stage label="Collage: ink sketch of the orange GWS guernsey with handwritten notes and three goal tallies">
        <div
          aria-hidden="true"
          className="sc-tornC sc-halftone-o"
          style={place({ left: '0%', top: '14%', width: '34%', height: '76%', rotate: -3, z: 0 })}
        />
        <Sketch name="guernsey-orange" left="3%" top="1%" width="29%" rotate={-4} z={2} />
        <Tape left="11%" top="0%" width="12%" rotate={4} z={5} />
        <Hand size="xl" left="40%" top="4%" rotate={-2}>
          Giants orange, 2012–2020
        </Hand>
        <Sketch
          name="arrow"
          left="29%"
          top="6%"
          width="11%"
          z={1}
          style={{ transform: 'rotate(180deg) scaleY(-1)' }}
        />
        <Hand left="40%" top="18%" rotate={-1} weight={600}>
          top goalkicker <span style={{ color: 'var(--sc-red)' }}>9 seasons straight</span>
        </Hand>
        <Sketch name="underline" left="40%" top="28%" width="26%" rotate={-1} z={1} />
        <Note value="29" left="38%" top="40%" width="18%" rotate={-4}>
          goals in year one, 2012
        </Note>
        <Note value="62" left="59%" top="44%" width="18%" rotate={3}>
          goals in 2013, All-Australian
        </Note>
        <Note value="67" circled left="79%" top="38%" width="19%" rotate={-2}>
          H&amp;A goals: 2019 Coleman Medal
        </Note>
        <Hand size="md" red left="40%" top="84%" rotate={-1} weight={600}>
          2019 → first Giant ever to kick a goal in a grand final
        </Hand>
      </Stage>
    ),
    body: [
      'In 2012, the Giants’ first season, Cameron kicked 29 goals from 16 games, became the first GWS player to kick five in a match, and topped the club’s goalkicking. He would top it every year he was there: nine seasons in a row.',
      'A year later he kicked 62, finished third in the Coleman Medal, was named All-Australian full-forward and won the Kevin Sheedy Medal as club champion. In 2015 he was runner-up for the Coleman with 63. As the Giants grew into a finals side from 2016, he was the constant.',
      '2019 was the peak. He kicked 67 goals in the home-and-away season, nine of them in his 150th game against Gold Coast in the final round, to win the Coleman Medal. A month later he became the first Giant to kick a goal in a grand final.',
    ],
  },
  {
    kicker: 'Chapter 03: The trade',
    when: '2020',
    slip: ['2020', 'The trade'],
    slipColour: 'var(--sc-paper)',
    slipRotate: -1.5,
    title: (
      <>
        Done with <em>seconds</em> to spare
      </>
    ),
    standfirst: 'He wanted to go home. GWS made Geelong pay a price no club had paid before.',
    collage: (
      <Stage label="Collage: a lined notepad listing the trade, picks 13, 15 and 20 circled in red, a stopwatch sketch and a LODGED stamp">
        <div
          className="sc-tornTop sc-lined sc-hand"
          style={{
            ...place({ left: '3%', top: '3%', width: '55%', height: '92%', rotate: -1.5, z: 1 }),
            boxSizing: 'border-box',
            padding: '5% 6%',
            boxShadow: '0 1px 3px color-mix(in srgb, var(--sc-ink) 18%, transparent)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.2rem',
            fontWeight: 600,
          }}
        >
          <p style={noteLine}>12 Nov 2020: last day of trade period</p>
          <p style={noteLine}>
            Cameron → <b>Geelong</b> (+ 2 × future 2nds)
          </p>
          <p style={{ ...noteLine, marginTop: '0.2rem' }}>
            → <b>GWS</b> gets picks:
          </p>
          <div
            style={{
              display: 'flex',
              gap: '1.2rem',
              alignItems: 'center',
              padding: '0.4rem 0 0.2rem 1rem',
            }}
          >
            <CircledPick pick="13" />
            <CircledPick pick="15" />
            <CircledPick pick="20" />
          </div>
          <p style={noteLine}>+ a future 4th</p>
          <p
            style={{
              ...noteLine,
              marginTop: '0.3rem',
              textDecoration: 'line-through',
              textDecorationColor: 'var(--sc-red)',
              textDecorationThickness: 3,
            }}
          >
            pre-season draft??
          </p>
        </div>
        <Tape left="20%" top="0%" width="16%" rotate={-4} z={5} />
        <Sketch name="stopwatch" left="66%" top="1%" width="21%" rotate={7} z={2} />
        <div
          style={{
            ...place({ left: '62%', top: '52%', rotate: -8, z: 4 }),
            border: '4px solid var(--sc-red)',
            padding: '0.4rem 1rem',
            color: 'var(--sc-red)',
            textAlign: 'center',
          }}
        >
          <p
            className="sc-label"
            style={{ margin: 0, fontSize: 'clamp(28px, 3.4vw, 50px)', lineHeight: 1 }}
          >
            Lodged
          </p>
          <p
            className="sc-label"
            style={{ margin: '0.2rem 0 0', fontWeight: 500, fontSize: 'clamp(11px, 1vw, 14px)' }}
          >
            in the dying seconds
          </p>
        </div>
        <Hand size="md" left="61%" top="76%" width="36%" rotate={2} weight={600}>
          GWS matched the RFA bid: first club ever to do it
        </Hand>
      </Stage>
    ),
    body: [
      'At the end of 2020, after nine seasons, Cameron asked to return to Victoria and join Geelong. The Cats lodged a restricted free-agency offer, and the Giants did something no club had done: they matched it. Geelong could no longer simply sign him. It had to trade for him.',
      'His manager made it clear he would not go back to the Giants, and raised the pre-season draft as a possible way out. The negotiation ran all the way to the final day of the trade period.',
      'On 12 November the deal went in during the dying seconds. Geelong sent picks 13, 15 and 20 and a future fourth-round pick to GWS; Cameron came with two future second-round picks. No player had ever been traded for three first-round picks. The Cats later traced the deal’s paper trail all the way back to a draft pick from 2004.',
    ],
  },
  {
    kicker: 'Chapter 04: New stripes',
    when: '2021',
    slip: ['2021', 'New stripes'],
    slipColour: 'var(--sc-slip-blue)',
    slipRotate: 3,
    title: (
      <>
        The weight of the <em>price tag</em>
      </>
    ),
    standfirst:
      'A record deal brings a record level of expectation, and year one didn’t go to plan.',
    collage: (
      <Stage label="Collage: a price tag reading three first-round picks, strapping tape noting 15 games in 2021, and a sketch of a Kardinia Park light tower">
        <div
          aria-hidden="true"
          className="sc-tornC sc-hoops"
          style={place({ left: '70%', top: '0%', width: '26%', height: '100%', rotate: 2, z: 0 })}
        />
        <Sketch name="light-tower" left="49%" top="40%" width="12%" z={2} />
        <div
          className="sc-pricetag"
          style={{
            ...place({ left: '4%', top: '3%', width: '40%', rotate: -6, z: 3 }),
            boxSizing: 'border-box',
            padding: '4% 5% 4% 12%',
            background: 'var(--sc-paper)',
            boxShadow: '0 1px 3px color-mix(in srgb, var(--sc-ink) 20%, transparent)',
          }}
        >
          <p
            className="sc-label"
            style={{ margin: 0, fontSize: 'clamp(12px, 1.1vw, 15px)', color: 'var(--sc-grey)' }}
          >
            Price paid
          </p>
          <p
            className="sc-marker"
            style={{ margin: '0.3rem 0 0', fontSize: 'clamp(24px, 3vw, 46px)', lineHeight: 1.02 }}
          >
            3 × first-round picks
          </p>
          <p
            className="sc-hand sc-hand-md"
            style={{ margin: '0.3rem 0 0', fontWeight: 600, color: 'var(--sc-red)' }}
          >
            + a future fourth
          </p>
        </div>
        <div
          className="sc-tape"
          style={{
            ...place({ left: '3%', top: '80%', width: '44%', height: '64px', rotate: 3, z: 4 }),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span className="sc-hand sc-hand-xl">2021: 15 games. Injuries.</span>
        </div>
        <Hand left="47%" top="5%" width="20%" rotate={-3} weight={600}>
          + Tom Hawkins up forward
        </Hand>
        <Sketch name="arrow" left="50%" top="22%" width="16%" rotate={-8} z={1} />
      </Stage>
    ),
    body: [
      'Cameron arrived at Geelong to partner Tom Hawkins in attack, a pairing the Cats had paid heavily to put together.',
      'His first season in the hoops was interrupted by injury, and he managed 15 games. In 2021 the move was still more promise than proof.',
    ],
  },
  {
    kicker: 'Chapter 05: The season',
    when: '2022',
    slip: ['2022', 'The season'],
    slipColour: 'var(--sc-paper)',
    slipRotate: -2,
    title: (
      <>
        Fit, firing, and <em>sure</em>
      </>
    ),
    standfirst:
      'Healthy again, he played some of the best football of his career and decided early that this team would win it.',
    collage: (
      <Stage label="Collage: ink sketches of the Geelong hooped guernsey and a football with notes on his 2022 awards and two close wins">
        <div
          aria-hidden="true"
          className="sc-tornC sc-halftone-n"
          style={place({ left: '1%', top: '14%', width: '34%', height: '74%', rotate: 3, z: 0 })}
        />
        <Sketch name="guernsey-hoops" left="4%" top="2%" width="29%" rotate={4} z={2} />
        <Tape left="12%" top="0%" width="12%" rotate={-5} z={5} />
        <Sketch name="football" left="38%" top="4%" width="24%" rotate={-10} z={2} />
        <Hand size="xl" left="66%" top="6%" rotate={-2}>
          Carji Greeves Medal
        </Hand>
        <Sketch name="star" left="89%" top="2%" width="7%" z={1} />
        <Hand left="66%" top="20%" rotate={1} weight={600}>
          All-Australian, his 3rd
        </Hand>
        <Sketch name="underline" left="66%" top="29%" width="26%" z={1} />
        <Note value="3" left="38%" top="50%" width="27%" rotate={-3}>
          point win v Richmond, round 15: the moment he believed
        </Note>
        <Note value="6" left="69%" top="48%" width="27%" rotate={3}>
          point qualifying final win v Collingwood
        </Note>
      </Stage>
    ),
    body: [
      'Fit in 2022, Cameron played some of the best football of his career, with a string of five-goal hauls through the season.',
      'He later picked a three-point win over Richmond in round 15 as the moment he thought Geelong would be premiers. The qualifying final against Collingwood was won by six points.',
      'By the end of the year he had won the Carji Greeves Medal as Geelong’s best and fairest and earned his third All-Australian selection.',
    ],
  },
  {
    kicker: 'Chapter 06: Grand final',
    when: '24.09.22',
    slip: ['24.09.22', 'Premiers'],
    slipColour: 'var(--sc-slip-blue)',
    slipRotate: 2.5,
    title: (
      <>
        Premiers, by <em>81</em> points
      </>
    ),
    standfirst: 'Sixteen wins in a row, and the last one wasn’t close.',
    collage: (
      <Stage label="Collage: ink sketch of a premiership cup in falling confetti, a scoreboard stub reading Geelong 20.13 (133), Sydney 8.4 (52), and PREMIERS in red marker">
        {CONFETTI.map(([left, top, width, height, background, rotate], index) => (
          <span
            key={index}
            aria-hidden="true"
            style={{
              ...place({
                left: `${left}%`,
                top: `${top}%`,
                width: `${width}%`,
                height: `${height}%`,
                rotate,
                z: 0,
              }),
              background,
            }}
          />
        ))}
        <Sketch name="cup" left="2%" top="3%" width="30%" rotate={-2} z={2} />
        <div
          className="sc-tornB sc-label sc-wide"
          style={{
            ...place({ left: '34%', top: '8%', width: '42%', rotate: -2, z: 3 }),
            boxSizing: 'border-box',
            padding: '4% 5%',
            background: 'var(--sc-ink)',
            color: 'var(--sc-paper)',
          }}
        >
          <p
            style={{
              margin: 0,
              fontWeight: 500,
              fontSize: 'clamp(11px, 1vw, 14px)',
              color: 'var(--brand-hairline)',
            }}
          >
            Grand final · MCG · 24.09.22
          </p>
          <p
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '1rem',
              margin: '0.8rem 0 0',
              fontSize: 'clamp(18px, 2.05vw, 31px)',
              lineHeight: 1.1,
              whiteSpace: 'nowrap',
            }}
          >
            <span>Geelong</span>
            <span>20.13 (133)</span>
          </p>
          <p
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '1rem',
              margin: '0.3rem 0 0',
              fontWeight: 500,
              fontSize: 'clamp(18px, 2vw, 30px)',
              lineHeight: 1.1,
              color: 'color-mix(in srgb, var(--sc-paper) 62%, var(--sc-ink))',
            }}
          >
            <span>Sydney</span>
            <span>8.4 (52)</span>
          </p>
        </div>
        <p
          className="sc-marker"
          style={{
            ...place({ left: '3%', top: '68%', rotate: -4, z: 6 }),
            margin: 0,
            fontSize: 'clamp(44px, 5.6vw, 88px)',
            lineHeight: 1.05,
            color: 'var(--sc-red)',
          }}
        >
          Premiers!
        </p>
        <Note value="81" left="78%" top="6%" width="19%" rotate={4}>
          point margin
        </Note>
        <Note value="2 · 18" left="78%" top="38%" width="20%" rotate={-3}>
          goals · disposals from Cameron
        </Note>
        <Note value="100,024" left="71%" top="70%" width="28%" rotate={2}>
          people at the MCG
        </Note>
      </Stage>
    ),
    body: [
      'Geelong finished its season with a 16th straight win, beating Sydney 20.13 (133) to 8.4 (52) in front of 100,024 people at the MCG. Cameron kicked two goals and had 18 disposals.',
      'His family were there for all of it: the parade, the grand final from the stands, and the Cats’ family day back in Geelong. The club’s decision to pay a record price had been vindicated, and so had his own decision to leave.',
      'In the rooms afterwards, he looked back on the decade in Sydney.',
    ],
    quote: {
      words: '“A place that I’d never thought I’d spend two years.”',
      by: 'Jeremy Cameron, AFL.com.au, 24 Sep 2022',
    },
  },
];

export const CAMERON_SOURCES =
  'Sources: AFL.com.au (trade coverage, 2022 grand final report and post-match interview) · Geelong Cats and GWS Giants club sites · AFL Tables · Wikipedia (career record) · South East Voice (family at the grand final). Illustrations are original ink sketches.';
