import { describe, expect, it } from 'vitest';

import { clampLines, wrapText } from '@/components/aflTradeStory/scarfTimeline';
import {
  clubStyle,
  formatPav,
  formatSigned,
  inkOn,
  tradeHash,
  tradeIdFromHash,
  tradeStoryHref,
} from '@/components/aflTradeStory/tradePageModel';

const CLUBS = [
  'Adelaide',
  'Brisbane',
  'Carlton',
  'Collingwood',
  'Essendon',
  'Fremantle',
  'Geelong',
  'Gold Coast',
  'GWS',
  'Hawthorn',
  'Melbourne',
  'North Melbourne',
  'Port Adelaide',
  'Richmond',
  'St Kilda',
  'Sydney',
  'West Coast',
  'Western Bulldogs',
];

function contrast(left: string, right: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((at) => {
      const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [high, low] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (high! + 0.05) / (low! + 0.05);
}

describe('trade page model helpers', () => {
  it('writes values with a true minus sign, and no sign on zero', () => {
    expect(formatSigned(50.9)).toBe('+50.9');
    expect(formatSigned(-57.64)).toBe('−57.6');
    expect(formatSigned(-0.01)).toBe('0.0');
    expect(formatPav(9.3417, 2)).toBe('9.34');
  });

  it('gives every club badge text that meets WCAG AA on its colour', () => {
    for (const club of CLUBS) {
      const style = clubStyle(club);
      expect(contrast(style.fill, style.ink), club).toBeGreaterThanOrEqual(4.5);
    }
    expect(inkOn('#ffffff')).toBe('#000000');
    expect(inkOn('#001f3d')).toBe('#ffffff');
  });

  it('shows a near-white guernsey by its trim, so the club reads as a colour', () => {
    expect(clubStyle('Geelong')).toMatchObject({ abbreviation: 'GEE', fill: '#001f3d' });
    expect(clubStyle('North Melbourne').fill).toBe('#1a3b8e');
  });

  it('round-trips a trade id through its hash, and keeps pages on the private path', () => {
    expect(tradeHash('trade:2021-gee-wbd')).toBe('#trade=trade%3A2021-gee-wbd');
    expect(tradeIdFromHash('#trade=trade%3A2021-gee-wbd')).toBe('trade:2021-gee-wbd');
    expect(tradeIdFromHash('#trade=%E0%A4%A')).toBeNull();
    expect(tradeIdFromHash('#bid-pick-1')).toBeNull();
    expect(tradeStoryHref('trade:2021-gee-wbd')).toBe(
      '/dev/afl-trade-stories/trade%3A2021-gee-wbd'
    );
  });

  it('wraps scarf callouts and marks cut text with an ellipsis', () => {
    expect(wrapText('Geelong get Jeremy Cameron and 2 more.', 19)).toEqual([
      'Geelong get Jeremy',
      'Cameron and 2 more.',
    ]);
    expect(clampLines(['one', 'two,', 'three'], 2)).toEqual(['one', 'two…']);
    expect(clampLines(['one'], 2)).toEqual(['one']);
  });
});
