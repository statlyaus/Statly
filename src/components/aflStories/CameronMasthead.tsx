import { Caveat, Newsreader, Oswald, Permanent_Marker } from 'next/font/google';

import { CAMERON_CHAPTERS } from './cameronChapters';
import { Hand, Sketch, Stage, Tape, place } from './collageParts';
import './storyCollage.css';

/** The top of the Jeremy Cameron story, shared by its own page and the home page that leads to it. */

const marker = Permanent_Marker({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-sc-marker',
});
const hand = Caveat({ weight: ['600', '700'], subsets: ['latin'], variable: '--font-sc-hand' });
const serif = Newsreader({
  weight: ['400', '500'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-sc-serif',
});
const label = Oswald({ weight: ['500', '600'], subsets: ['latin'], variable: '--font-sc-label' });

/** The class every story collage sits under: the paper background and the four typefaces. */
export const STORY_COLLAGE_CLASS = `sc ${marker.variable} ${hand.variable} ${serif.variable} ${label.variable}`;

export const CAMERON_STORY_PATH = '/afl/stories/jeremy-cameron';

export const CAMERON_STANDFIRST =
  'How a 17-year-old from a town of 150 became a brand-new club’s first great forward, then went home at a record price and won a premiership.';

/** "From Giant to Cat", each club's name on a torn strip of its colour. */
export function CameronTitle({ as: Tag = 'h1' }: { as?: 'h1' | 'p' }) {
  return (
    <Tag className="sc-title sc-marker">
      From{' '}
      <span
        className="sc-tornB"
        style={{ background: 'var(--sc-orange)', transform: 'rotate(-2deg)' }}
      >
        Giant
      </span>
      <br />
      to{' '}
      <span
        className="sc-tornB"
        style={{ background: 'var(--sc-navy)', transform: 'rotate(2deg)' }}
      >
        Cat
      </span>
    </Tag>
  );
}

/** The two guernseys joined by the road from Dartmoor to Geelong. */
export function CameronHeroCollage() {
  return (
    <Stage label="Collage: ink sketches of an orange guernsey and a navy and white hooped guernsey, joined by a dotted route from Dartmoor to Geelong, with a football and handwritten notes">
      <div
        aria-hidden="true"
        className="sc-tornD"
        style={{
          ...place({ left: '5%', top: '6%', width: '88%', height: '86%', rotate: 1.5, z: 0 }),
          background: '#F7F5EF',
        }}
      />
      <Sketch name="route" left="10%" top="3%" width="80%" z={1} />
      <Hand left="3%" top="15%" rotate={-4}>
        Dartmoor
      </Hand>
      <Hand left="80%" top="15%" rotate={4}>
        Geelong
      </Hand>
      <Hand size="md" red left="34%" top="0%" rotate={-2}>
        the price: 3 first-round picks
      </Hand>
      <Sketch name="guernsey-orange" left="6%" top="22%" width="36%" rotate={-7} z={2} />
      <Tape left="16%" top="21%" width="13%" rotate={5} z={5} />
      <Sketch name="guernsey-hoops" left="56%" top="25%" width="37%" rotate={6} z={3} />
      <Tape left="66%" top="24%" width="13%" rotate={-6} z={5} />
      <Sketch name="football" left="33%" top="68%" width="28%" rotate={-12} z={4} />
      <Hand size="md" left="2%" top="82%" rotate={-4} weight={600}>
        9 seasons as
        <br />
        top goalkicker
      </Hand>
      <Hand red left="72%" top="86%" rotate={3}>
        premiers, 2022
      </Hand>
      <Sketch name="star" left="90%" top="80%" width="7%" z={1} />
    </Stage>
  );
}

/** The six chapters as paper slips. `onOpen` lets the story page open the chapter it jumps to. */
export function ChapterSlips({
  base = '',
  label: navLabel,
  onOpen,
}: {
  base?: string;
  label: string;
  onOpen?: (chapter: number) => void;
}) {
  return (
    <nav aria-label={navLabel} style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
      {CAMERON_CHAPTERS.map(({ slip, slipColour, slipRotate }, index) => (
        <a
          key={slip[0]}
          href={`${base}#ch${index + 1}`}
          className="sc-slip sc-tornB"
          onClick={onOpen ? () => onOpen(index) : undefined}
          style={{ background: slipColour, transform: `rotate(${slipRotate}deg)` }}
        >
          <b className="sc-label">{slip[0]}</b>
          <span>{slip[1]}</span>
        </a>
      ))}
    </nav>
  );
}
