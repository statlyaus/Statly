import type { LineupFieldSpot } from '../matchups/lineupBuilderTypes';

/** One line across the ground, as a team sheet reads: full-forward line down to full-back line. */
export interface FieldLine {
  key: string;
  label: string;
  /** Team-sheet abbreviation shown beside the line: FF, HF, C, FOL, HB, FB. */
  short: string;
  zone: 'FWD' | 'CENTRE' | 'DEF';
  spots: LineupFieldSpot[];
  /** Side padding in percent, so lines near the goals sit inside the narrower ends of the oval. */
  inset: number;
}

export interface FieldLayout {
  /** Top (attacking end) to bottom. */
  lines: FieldLine[];
  /** Utility spots: they score but have no fixed place on the ground. */
  utility: LineupFieldSpot[];
  interchange: LineupFieldSpot[];
}

/** Lines of at most three (5 → 3 + 2, 4 → 2 + 2). */
export function splitIntoLines(count: number): number[] {
  const lines: number[] = [];
  let left = Math.max(0, count);
  while (left > 0) {
    const size = left === 4 ? 2 : Math.min(3, left);
    lines.push(size);
    left -= size;
  }
  return lines;
}

/** Lines closer to goal, and lines of two, sit further in. */
function insetFor(fromGoal: number, size: number): number {
  const base = fromGoal === 0 ? 12 : fromGoal === 1 ? 6 : 3;
  return size === 2 ? base + 10 : base;
}

function endLines(
  spots: LineupFieldSpot[],
  zone: 'FWD' | 'DEF',
  names: readonly string[],
  shorts: readonly string[]
): FieldLine[] {
  const sizes = splitIntoLines(spots.length);
  let next = 0;
  return sizes.map((size, index) => {
    const lineSpots = spots.slice(next, next + size);
    next += size;
    return {
      key: `${zone}-${index}`,
      label: names[index] ?? names.at(-1) ?? zone,
      short: shorts[index] ?? shorts.at(-1) ?? zone,
      zone,
      spots: lineSpots,
      inset: insetFor(index, size),
    };
  });
}

/**
 * The centre: wings and centre on one line, then the followers with the ruck in the middle.
 */
function centreLines(mids: LineupFieldSpot[], rucks: LineupFieldSpot[]): FieldLine[] {
  const lines: FieldLine[] = [];
  const centre = rucks.length > 0 ? mids.slice(0, 3) : [];
  const rest = mids.slice(centre.length);
  if (centre.length > 0) {
    lines.push({
      key: 'CENTRE-0',
      label: 'Centre line',
      short: 'C',
      zone: 'CENTRE',
      spots: centre,
      inset: 0,
    });
  }
  if (rucks.length > 0) {
    const half = Math.floor(rest.length / 2);
    const followers = [...rest.slice(0, half), ...rucks, ...rest.slice(half)];
    lines.push({
      key: 'CENTRE-1',
      label: 'Followers',
      short: 'FOL',
      zone: 'CENTRE',
      spots: followers,
      inset: followers.length <= 2 ? 16 : 4,
    });
    return lines;
  }
  splitIntoLines(rest.length).reduce((start, size, index) => {
    lines.push({
      key: `CENTRE-${index}`,
      label: index === 0 ? 'Centre line' : 'Midfield',
      short: index === 0 ? 'C' : 'M',
      zone: 'CENTRE',
      spots: rest.slice(start, start + size),
      inset: size === 2 ? 16 : 0,
    });
    return start + size;
  }, 0);
  return lines;
}

/** Forwards at the top, defence at the bottom, midfield and ruck through the middle. */
export function layoutField(spots: readonly LineupFieldSpot[]): FieldLayout {
  const of = (slot: LineupFieldSpot['slot']) => spots.filter((spot) => spot.slot === slot);
  const forwards = endLines(
    of('FWD'),
    'FWD',
    ['Full-forward line', 'Half-forward line', 'Forwards'],
    ['FF', 'HF', 'F']
  );
  const backs = endLines(
    of('DEF'),
    'DEF',
    ['Full-back line', 'Half-back line', 'Backs'],
    ['FB', 'HB', 'B']
  ).reverse();
  return {
    lines: [...forwards, ...centreLines(of('MID'), of('RUC')), ...backs],
    utility: of('UTIL'),
    interchange: of('INTERCHANGE'),
  };
}
