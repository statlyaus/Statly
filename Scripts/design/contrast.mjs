// WCAG 2.2 contrast for the design tokens in src/index.css. Shared by the design unit tests so every
// colour pair the style guide names is checked against the values the app actually ships.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Reads the custom properties declared directly in the first `selector {` block of a stylesheet. */
export function readTokenBlock(css, selector) {
  const blockStart = css.indexOf(`${selector} {`);
  if (blockStart < 0) throw new Error(`Missing ${selector} block.`);
  const declarationStart = css.indexOf('{', blockStart) + 1;
  const declarations = css.slice(declarationStart, css.indexOf('}', declarationStart));
  return new Map(
    [...declarations.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((match) => [
      match[1],
      match[2].replace(/\/\*.*?\*\//g, '').trim(),
    ])
  );
}

/** The `:root` tokens of src/index.css. */
export function readRootTokens(root = process.cwd()) {
  return readTokenBlock(readFileSync(join(root, 'src/index.css'), 'utf8'), ':root');
}

function oklchToHex(lightness, chroma, hueDegrees) {
  const hue = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${linear
    .map((channel) => {
      const clipped = Math.min(1, Math.max(0, channel));
      const encoded = clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055;
      return Math.round(encoded * 255)
        .toString(16)
        .padStart(2, '0');
    })
    .join('')}`;
}

/** Resolves a token (following `var()` references) or a literal to a six-digit hex colour. */
export function resolveColour(tokens, value, seen = new Set()) {
  if (value.startsWith('--')) {
    if (seen.has(value)) throw new Error(`Circular colour token: ${value}`);
    const declared = tokens.get(value);
    if (!declared) throw new Error(`Missing colour token: ${value}`);
    return resolveColour(tokens, declared, new Set(seen).add(value));
  }
  const reference = value.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (reference) return resolveColour(tokens, reference[1], seen);
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return `#${[...value.slice(1)].map((digit) => digit.repeat(2)).join('')}`.toLowerCase();
  }
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const oklch = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i);
  if (oklch) return oklchToHex(Number(oklch[1]), Number(oklch[2]), Number(oklch[3]));
  throw new Error(`Not an opaque colour: ${value}`);
}

function relativeLuminance(hex) {
  const [red, green, blue] = (hex.slice(1).match(/.{2}/g) ?? []).map((pair) => {
    const channel = Number.parseInt(pair, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG contrast ratio between two six-digit hex colours. */
export function contrastRatio(first, second) {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (a, b) => b - a
  );
  return (lighter + 0.05) / (darker + 0.05);
}
