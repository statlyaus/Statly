import { expect, type Page } from '@playwright/test';

/**
 * Brand conformance (docs/product/style-guide.md), checked element by element in the browser: no
 * pills, square tiles and lists, flat page things, red only for live and errors, text at 4.5:1 or
 * better and never under 11px, Geist only for short lines, no side stripe but the sun one, club
 * colour only in the 13px club square, and no typeface but Geist, Saira and Caveat.
 *
 * Skipped: anything inside `[data-collage]` (the story collage exception and the trade page head the
 * owner is redesigning, ticket 06h), and anything inside an element matching one of `exclusions`
 * (area palettes a later ticket still owns). Inside `[data-illustration]` (the My Team field, owner
 * 2026-11-21) club-colour fills are allowed but text on one is not, and the drawing itself (its
 * `aria-hidden` parts) may be round; text on a club fill fails only when one element carries both. A `[data-provider-logo]` (Google and Facebook
 * on the sign-in page) keeps its owner's colours.
 */

export interface Findings {
  pills: string[];
  roundedBlocks: string[];
  blurredShadows: string[];
  red: string[];
  sideStripes: string[];
  geistSentences: string[];
  lowContrast: string[];
  smallText: string[];
  clubFills: string[];
  offBrandFonts: string[];
}

export interface AuditResult {
  findings: Findings;
  /** Elements skipped by each exclusion, in the order given. */
  skipped: number[];
}

export const EMPTY: Findings = {
  pills: [],
  roundedBlocks: [],
  blurredShadows: [],
  red: [],
  sideStripes: [],
  geistSentences: [],
  lowContrast: [],
  smallText: [],
  clubFills: [],
  offBrandFonts: [],
};

// Runs in the page: everything it uses is defined inside it.
function audit(exclusions: readonly string[]): AuditResult {
  const out: Findings = {
    pills: [],
    roundedBlocks: [],
    blurredShadows: [],
    red: [],
    sideStripes: [],
    geistSentences: [],
    lowContrast: [],
    smallText: [],
    clubFills: [],
    offBrandFonts: [],
  };
  const skipped = exclusions.map(() => 0);
  // Computed colours come as rgb(), oklab() or color(srgb …) (Tailwind's opacity modifiers), so a
  // 1px canvas turns any of them into 0–255 RGB and a 0–1 alpha.
  const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const rgba = (colour: string): [number, number, number, number] => {
    canvas.clearRect(0, 0, 1, 1);
    canvas.fillStyle = '#000';
    canvas.fillStyle = colour;
    canvas.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 0] = canvas.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const over = (top: [number, number, number, number], under: number[]) =>
    under.map((value, index) => top[index]! * top[3] + value * (1 - top[3]));
  const luminance = (rgb: number[]) => {
    const [r = 0, g = 0, b = 0] = rgb.map((value) => {
      const unit = value / 255;
      return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const transparent = (colour: string) => rgba(colour)[3] === 0;
  // The colour behind an element: every translucent layer composited down to the first opaque one
  // (or the white page).
  const backgroundOf = (start: Element): number[] => {
    const layers: [number, number, number, number][] = [];
    for (let element: Element | null = start; element; element = element.parentElement) {
      const layer = rgba(getComputedStyle(element).backgroundColor);
      if (layer[3] === 0) continue;
      layers.push(layer);
      if (layer[3] === 1) break;
    }
    return layers.reduceRight<number[]>((under, layer) => over(layer, under), [255, 255, 255]);
  };
  const contrastOf = (element: Element, colour: string) => {
    const behind = backgroundOf(element);
    const [light, dark] = [luminance(over(rgba(colour), behind)), luminance(behind)].sort(
      (a, b) => b - a
    );
    return (light! + 0.05) / (dark! + 0.05);
  };
  const isRed = (colour: string) => {
    const [r, g, b, a] = rgba(colour);
    return a > 0 && r > 150 && g < 90 && b < 90;
  };
  const name = (element: Element) => {
    const classes =
      typeof element.className === 'string'
        ? element.className.trim().split(/\s+/).slice(0, 3).join('.')
        : '';
    const text = (element.textContent ?? '').trim().slice(0, 30);
    return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''} «${text}»`;
  };
  const controls = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A', 'SUMMARY']);

  // One check per rule, each reading the element's computed style and box.
  type Ctx = {
    element: Element;
    style: CSSStyleDeclaration;
    box: DOMRect;
    ownText: string;
    drawing: boolean;
  };

  const checkShape = ({ element, style, box, drawing }: Ctx) => {
    if (drawing) return;
    const corners = [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
    ].map((corner) => parseFloat(corner) || 0);
    const radius = Math.max(...corners);
    // A pill rounds every corner alike. The hand-cut edge (rounded-cut) is elliptical ("a b / c d")
    // and uneven by design, so it is never a pill or a rounded block.
    const handCut = style.borderRadius.includes('/');
    const even = !handCut && corners.every((corner) => corner === corners[0]);
    const isControl = controls.has(element.tagName) || element.getAttribute('role') === 'button';
    const pill =
      even &&
      radius > 6 &&
      radius >= Math.min(box.width, box.height) / 2 - 1 &&
      box.width > box.height * 1.4;
    if (pill) out.pills.push(name(element));
    // `rounded-lg` is 4px here (--radius), so anything above 2px on a tile, card or table counts.
    else if (!handCut && !isControl && radius > 2 && box.width > 120 && box.height > 60)
      out.roundedBlocks.push(`${name(element)} r=${radius}`);
  };

  // Hard shadows only ("5px 6px 0 ink"): a layer whose third length (the blur) is above zero is soft.
  const checkShadow = ({ element, style }: Ctx) => {
    if (style.boxShadow === 'none') return;
    const blurred = style.boxShadow
      .replace(/rgba?\([^)]*\)/g, '')
      .split(',')
      .some((layer) => parseFloat(layer.match(/-?[\d.]+px/g)?.[2] ?? '0') > 0);
    if (blurred) out.blurredShadows.push(name(element));
  };

  const checkRed = ({ element, style, box, ownText }: Ctx) => {
    if (element.closest('[role="alert"], [data-status="live"]')) return;
    if (ownText.length > 0 && isRed(style.color)) out.red.push(name(element));
    // A red club's 13px square is club colour, not a status.
    const square = box.width <= 14 && box.height <= 14;
    if (!square && isRed(style.backgroundColor)) out.red.push(`fill ${name(element)}`);
  };

  const checkStripe = ({ element, style }: Ctx) => {
    const left = parseFloat(style.borderLeftWidth);
    if (left >= 3 && style.borderLeftStyle !== 'none' && parseFloat(style.borderRightWidth) < 1)
      out.sideStripes.push(`${name(element)} ${left}px`);
  };

  // Only the three brand faces (style guide, "Typefaces"), SVG labels included.
  const checkFont = ({ element, style, ownText }: Ctx) => {
    const face = style.fontFamily.split(',')[0]!.replace(/["']/g, '').trim();
    if (ownText.length > 0 && !/^(__)?(Geist|Saira|Caveat)(\b|_)/i.test(face))
      out.offBrandFonts.push(`${name(element)} ${face}`);
  };

  // SVG text scales with its chart: its rendered size is the font size times the screen scale.
  const checkSvgText = ({ element, style }: Ctx) => {
    if (!(element instanceof SVGTextContentElement)) return;
    const rendered = parseFloat(style.fontSize) * (element.getScreenCTM()?.a ?? 1);
    if (rendered < 10.95) out.smallText.push(`svg ${name(element)} ${rendered.toFixed(1)}px`);
  };

  const checkText = ({ element, style, ownText }: Ctx) => {
    const size = parseFloat(style.fontSize);
    if (/Geist/i.test(style.fontFamily) && ownText.split(/\s+/).length > 9 && size < 28)
      out.geistSentences.push(name(element));
    if (size < 11) out.smallText.push(`${name(element)} ${size}px`);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    const contrast = contrastOf(element, style.color);
    if (contrast < (large ? 3 : 4.5))
      out.lowContrast.push(`${name(element)} ${contrast.toFixed(2)}`);
  };

  // Club colour comes from clubGuernseys.ts as an inline background or a literal SVG fill or
  // stroke (tokens are always var()); only the 13px club square may carry it.
  const checkClubColour = ({ element, style, box, ownText }: Ctx) => {
    const dims = `${Math.round(box.width)}x${Math.round(box.height)}`;
    const inline = element.getAttribute('style') ?? '';
    // The My Team field is an illustration (owner 2026-11-21): guernseys may wear club colours,
    // but text never sits on one. Third-party sign-in logos keep Google's and Facebook's colours.
    if (element.closest('[data-illustration]')) {
      if (ownText.length > 0 && /background/.test(inline) && !transparent(style.backgroundColor))
        out.clubFills.push(`text on a club fill ${name(element)} ${dims}`);
      return;
    }
    if (element.closest('[data-provider-logo]')) return;
    if (box.width <= 14 && box.height <= 14) return;
    if (/background/.test(inline) && !transparent(style.backgroundColor))
      out.clubFills.push(`${name(element)} ${dims}`);
    const paint = `${element.getAttribute('fill') ?? ''} ${element.getAttribute('stroke') ?? ''}`;
    if (element.closest('svg') && /#[0-9a-f]{3,8}\b/i.test(paint))
      out.clubFills.push(`svg ${name(element)} ${paint.trim()} ${dims}`);
  };

  for (const element of document.querySelectorAll('main *')) {
    if (element.closest('[data-collage]')) continue;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    if (box.width < 2 || box.height < 2 || style.visibility === 'hidden') continue;
    const excludedBy = exclusions.findIndex((selector) => element.closest(selector));
    if (excludedBy >= 0) {
      skipped[excludedBy]! += 1;
      continue;
    }
    const ownText = [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? '')
      .join('')
      .trim();
    const drawing = element.closest('[data-illustration] [aria-hidden="true"]') !== null;
    const ctx: Ctx = { element, style, box, ownText, drawing };
    checkShape(ctx);
    checkShadow(ctx);
    checkRed(ctx);
    checkStripe(ctx);
    checkClubColour(ctx);
    if (ownText.length === 0) continue;
    checkFont(ctx);
    if (element.closest('svg')) checkSvgText(ctx);
    else checkText(ctx);
  }
  return { findings: out, skipped };
}

/** Audits the settled page: fonts loaded, motion off, no skeleton still pulsing. */
export async function auditPage(
  page: Page,
  exclusions: readonly string[] = []
): Promise<AuditResult> {
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('main .animate-pulse')).toHaveCount(0);
  // Fonts change line boxes and measured sizes.
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(audit, exclusions);
}
