import { getTeamName } from '@/lib/teamLogos';

/**
 * Simplified club guernseys for the lineup field: a base colour, a trim colour and the pattern
 * that makes the jumper recognisable at a glance. Colours only, no club marks.
 */
export type GuernseyPattern =
  'plain' | 'hoops' | 'band' | 'stripes' | 'sash' | 'yoke' | 'vee' | 'halves' | 'panels';

export interface Guernsey {
  base: string;
  trim: string;
  pattern: GuernseyPattern;
  /** A third colour for patterns that need one (St Kilda's panels, Adelaide's hoops). */
  accent?: string;
}

export const FALLBACK_GUERNSEY: Guernsey = { base: '#64748b', trim: '#cbd5e1', pattern: 'plain' };

const GUERNSEYS: Record<string, Guernsey> = {
  Adelaide: { base: '#002b5c', trim: '#e21937', accent: '#ffd200', pattern: 'hoops' },
  Brisbane: { base: '#7a0019', trim: '#fdbe57', accent: '#0055a3', pattern: 'yoke' },
  Carlton: { base: '#0e1e2d', trim: '#ffffff', pattern: 'plain' },
  Collingwood: { base: '#000000', trim: '#ffffff', pattern: 'stripes' },
  Essendon: { base: '#000000', trim: '#cc2031', pattern: 'sash' },
  Fremantle: { base: '#2a0d54', trim: '#ffffff', pattern: 'vee' },
  Geelong: { base: '#ffffff', trim: '#001f3d', pattern: 'hoops' },
  'Gold Coast': { base: '#d71920', trim: '#ffdd00', pattern: 'yoke' },
  GWS: { base: '#313c42', trim: '#f47920', pattern: 'yoke' },
  Hawthorn: { base: '#4d2004', trim: '#fbbf15', pattern: 'stripes' },
  Melbourne: { base: '#0f1131', trim: '#cc2031', pattern: 'yoke' },
  'North Melbourne': { base: '#ffffff', trim: '#1a3b8e', pattern: 'stripes' },
  'Port Adelaide': { base: '#000000', trim: '#008aab', accent: '#ffffff', pattern: 'vee' },
  Richmond: { base: '#000000', trim: '#fed102', pattern: 'sash' },
  'St Kilda': { base: '#000000', trim: '#ed0f05', accent: '#ffffff', pattern: 'panels' },
  Sydney: { base: '#ffffff', trim: '#e1251b', pattern: 'yoke' },
  'West Coast': { base: '#003087', trim: '#f2a900', pattern: 'vee' },
  'Western Bulldogs': { base: '#014896', trim: '#e21937', accent: '#ffffff', pattern: 'band' },
};
GUERNSEYS['GWS Giants'] = GUERNSEYS.GWS;
GUERNSEYS['Greater Western Sydney'] = GUERNSEYS.GWS;

export function guernseyFor(club: string | null | undefined): Guernsey {
  if (!club?.trim()) return FALLBACK_GUERNSEY;
  return GUERNSEYS[getTeamName(club)] ?? GUERNSEYS[club.trim()] ?? FALLBACK_GUERNSEY;
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/**
 * The 13px club square (style guide, "Club colours"): the guernsey's two colours split on the
 * diagonal, its main colour top left, inside a 1px ink edge. A near-white guernsey (Geelong, North
 * Melbourne, Sydney) leads with its trim, so the club reads as a colour and black clubs (Essendon,
 * Richmond, Port Adelaide, Collingwood) tell apart by their second colour.
 */
export function clubSquare(club: string): { readonly main: string; readonly second: string } {
  const { base, trim } = guernseyFor(club);
  return relativeLuminance(base) > 0.7
    ? { main: trim, second: base }
    : { main: base, second: trim };
}

/** The club square as a CSS background. */
export function clubSquareBackground(club: string): string {
  const { main, second } = clubSquare(club);
  return `linear-gradient(135deg, ${main} 50%, ${second} 50%)`;
}
