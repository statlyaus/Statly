import { describe, expect, it } from 'vitest';

import { clubStyle } from '@/components/aflTradeStory/tradePageModel';
import { FALLBACK_GUERNSEY } from '@/lib/clubGuernseys';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { contrastRatio, readRootTokens, resolveColour } from '../../Scripts/design/contrast.mjs';

// Every colour pair the style guide names must hold in the values the app ships
// (docs/product/style-guide.md, "Colour roles"). Text needs 4.5:1; focus rings and control edges
// need 3:1 against their surface (WCAG 1.4.11). Add a pair here when a token gains a job.
const tokens = readRootTokens();
const ratio = (foreground: string, background: string) =>
  contrastRatio(resolveColour(tokens, foreground), resolveColour(tokens, background));

describe('design token contrast', () => {
  it.each([
    ['body text', '--foreground', '--background', 4.5],
    ['card text', '--card-foreground', '--card', 4.5],
    ['menu and dialog text', '--popover-foreground', '--popover', 4.5],
    ['secondary text', '--muted-foreground', '--background', 4.5],
    ['secondary text on a quiet panel', '--muted-foreground', '--muted', 4.5],
    ['primary action label', '--primary-foreground', '--primary', 4.5],
    ['secondary action label', '--secondary-foreground', '--secondary', 4.5],
    ['accent label', '--accent-foreground', '--accent', 4.5],
    ['brand bar label', '--brand-bar-foreground', '--brand-bar', 4.5],
    ['warning label', '--warning-foreground', '--warning', 4.5],
    ['amber words on the page', '--warning-text', '--background', 4.5],
    ['win label', '--result-win-foreground', '--result-win', 4.5],
    ['loss label', '--result-loss-foreground', '--result-loss', 4.5],
    ['draw label', '--result-draw-foreground', '--result-draw', 4.5],
    ['live label', '--status-live-foreground', '--status-live', 4.5],
    ['destructive text on the page', '--destructive', '--background', 4.5],
    ['destructive action label', '--destructive-foreground', '--destructive', 4.5],
    ['success text on the page', '--success', '--background', 4.5],
    ['link text on a tint panel', '--primary', '--secondary', 4.5],
    ['field text', '--field-foreground', '--field', 4.5],
    ['field placeholder', '--field-placeholder', '--field', 4.5],
    ['focus ring', '--ring', '--background', 3],
    ['primary action against the page', '--primary', '--background', 3],
    ['field edge on the page', '--input', '--background', 3],
    ['field edge on the field', '--input', '--field', 3],
    ['floating edge on the page', '--foreground', '--background', 3],
    ['menu row on the highlighter', '--popover-foreground', '--warning', 4.5],
    ['secondary text on the highlighter', '--muted-foreground', '--warning', 4.5],
  ])('%s holds %s on %s', (_role, foreground, background, minimum) => {
    expect(ratio(foreground, background)).toBeGreaterThanOrEqual(minimum);
  });
});

// The light grounds from the style guide ("Colour"). Ticket 03a adds them as tokens; until then the
// club squares are checked against the approved values.
const LIGHT_GROUNDS = { white: '#ffffff', stone: '#e8e6e1', tint: '#d9ddff' } as const;

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

describe('club squares', () => {
  // A club square is a graphic, so it needs 3:1 against the ground it sits on (WCAG 1.4.11).
  it.each(CLUBS)('%s square stands out on every light ground', (club) => {
    const { fill } = clubStyle(club);
    expect(fill).not.toBe(FALLBACK_GUERNSEY.base);
    for (const [ground, hex] of Object.entries(LIGHT_GROUNDS)) {
      expect({ ground, ratio: contrastRatio(fill, hex) >= 3 }).toEqual({ ground, ratio: true });
    }
  });
});

// Each ground redefines the roles a component reads (style guide, "Grounds"); every pair must hold
// on every ground.
const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
const GROUNDS = ['white', 'stone', 'tint', 'cobalt', 'ink', 'sun'] as const;

// Every top-level rule whose selector list names the ground, in source order.
function groundTokens(ground: string): Map<string, string> {
  const merged = new Map(tokens);
  for (const match of css.matchAll(/^([.\w\s,-]+)\{([^}]*)\}/gm)) {
    const selectors = match[1].split(',').map((selector) => selector.trim());
    if (!selectors.includes(`.ground-${ground}`)) continue;
    for (const [, name, value] of match[2].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      merged.set(name, value.trim());
    }
  }
  return merged;
}

describe.each(GROUNDS)('the %s ground', (ground) => {
  const tokensOnGround = groundTokens(ground);
  const onGround = (foreground: string, background: string) =>
    contrastRatio(
      resolveColour(tokensOnGround, foreground),
      resolveColour(tokensOnGround, background)
    );

  it.each([
    ['text', '--foreground', '--background', 4.5],
    ['secondary text', '--muted-foreground', '--background', 4.5],
    ['primary as text or mark', '--primary', '--background', 4.5],
    ['primary action label', '--primary-foreground', '--primary', 4.5],
    ['focus ring', '--ring', '--background', 3],
  ])('%s holds', (_role, foreground, background, minimum) => {
    expect(onGround(foreground, background)).toBeGreaterThanOrEqual(minimum);
  });
});
