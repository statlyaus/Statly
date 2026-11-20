import { expect, test, type Page } from '@playwright/test';

/**
 * Brand conformance of the public trade pages (docs/product/style-guide.md), checked element by
 * element in the browser: no pills, square tiles and lists, flat page things, red only for live and
 * errors, text at 4.5:1 or better and never under 11px, Geist only for short lines, no side stripe
 * but the sun one, club colour only in the 13px club square, and no typeface but Geist, Saira and
 * Caveat. Anything inside `[data-collage]` is
 * skipped: the story collage exception (home hero, the Cameron story teaser) and the trade page head,
 * scarf and tower that the owner is redesigning (ticket 06h).
 */

interface Findings {
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

function audit(): Findings {
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
  const channels = (colour: string) => (colour.match(/[\d.]+/g) ?? []).map(Number);
  const luminance = (colour: string) => {
    const [r = 0, g = 0, b = 0] = channels(colour)
      .slice(0, 3)
      .map((value) => {
        const unit = value / 255;
        return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (left: string, right: string) => {
    const [light, dark] = [luminance(left), luminance(right)].sort((a, b) => b - a);
    return (light! + 0.05) / (dark! + 0.05);
  };
  const transparent = (colour: string) => colour === 'transparent' || channels(colour)[3] === 0;
  const backgroundOf = (start: Element) => {
    for (let element: Element | null = start; element; element = element.parentElement) {
      const colour = getComputedStyle(element).backgroundColor;
      if (!transparent(colour)) return colour;
    }
    return 'rgb(255, 255, 255)';
  };
  const isRed = (colour: string) => {
    const [r = 0, g = 0, b = 0, a = 1] = channels(colour);
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

  for (const element of document.querySelectorAll('main *')) {
    if (element.closest('[data-collage]')) continue;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    if (box.width < 2 || box.height < 2 || style.visibility === 'hidden') continue;
    const inSvg = !!element.closest('svg');
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

    if (
      even &&
      radius > 6 &&
      radius >= Math.min(box.width, box.height) / 2 - 1 &&
      box.width > box.height * 1.4
    )
      out.pills.push(name(element));
    else if (!handCut && !isControl && radius >= 6 && box.width > 120 && box.height > 60)
      out.roundedBlocks.push(`${name(element)} r=${radius}`);

    // Hard shadows only ("5px 6px 0 ink"): a layer whose third length (the blur) is above zero is soft.
    const blurred = style.boxShadow
      .replace(/rgba?\([^)]*\)/g, '')
      .split(',')
      .some((layer) => parseFloat(layer.match(/-?[\d.]+px/g)?.[2] ?? '0') > 0);
    if (style.boxShadow !== 'none' && blurred) out.blurredShadows.push(name(element));

    const ownText = [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? '')
      .join('')
      .trim();
    const statusAllowsRed = !!element.closest('[role="alert"], [data-status="live"]');
    if (!statusAllowsRed && ownText.length > 0 && isRed(style.color)) out.red.push(name(element));
    // A red club's 13px square is club colour, not a status.
    const square = box.width <= 14 && box.height <= 14;
    if (!statusAllowsRed && !square && isRed(style.backgroundColor))
      out.red.push(`fill ${name(element)}`);

    const left = parseFloat(style.borderLeftWidth);
    if (left >= 3 && style.borderLeftStyle !== 'none' && parseFloat(style.borderRightWidth) < 1)
      out.sideStripes.push(`${name(element)} ${left}px`);

    // Only the three brand faces (style guide, "Typefaces"), SVG labels included.
    const face = style.fontFamily.split(',')[0]!.replace(/["']/g, '').trim();
    if (ownText.length > 0 && !/^(__)?(Geist|Saira|Caveat)(\b|_)/i.test(face))
      out.offBrandFonts.push(`${name(element)} ${face}`);

    // SVG text scales with its chart: its rendered size is the font size times the screen scale.
    if (ownText.length > 0 && element instanceof SVGTextContentElement) {
      const rendered = parseFloat(style.fontSize) * (element.getScreenCTM()?.a ?? 1);
      if (rendered < 10.95) out.smallText.push(`svg ${name(element)} ${rendered.toFixed(1)}px`);
    }

    if (ownText.length > 0 && !inSvg) {
      const size = parseFloat(style.fontSize);
      if (/Geist/i.test(style.fontFamily) && ownText.split(/\s+/).length > 9 && size < 28)
        out.geistSentences.push(name(element));
      if (size < 11) out.smallText.push(`${name(element)} ${size}px`);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      const contrast = ratio(style.color, backgroundOf(element));
      if (contrast < (large ? 3 : 4.5))
        out.lowContrast.push(`${name(element)} ${contrast.toFixed(2)}`);
    }

    // Club colour comes from clubGuernseys.ts as an inline background or a literal SVG fill or
    // stroke (tokens are always var()); only the 13px club square may carry it.
    const dims = `${Math.round(box.width)}x${Math.round(box.height)}`;
    const big = box.width > 14 || box.height > 14;
    const inline = element.getAttribute('style') ?? '';
    if (/background/.test(inline) && !transparent(style.backgroundColor) && big)
      out.clubFills.push(`${name(element)} ${dims}`);
    const paint = `${element.getAttribute('fill') ?? ''} ${element.getAttribute('stroke') ?? ''}`;
    if (inSvg && /#[0-9a-f]{3,8}\b/i.test(paint) && big)
      out.clubFills.push(`svg ${name(element)} ${paint.trim()} ${dims}`);
  }
  return out;
}

const EMPTY: Findings = {
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

async function expectConformant(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('main')).toBeVisible();
  // Fonts change line boxes and measured sizes; audit the settled page.
  await page.evaluate(() => document.fonts.ready);
  expect.soft(await page.evaluate(audit), path).toEqual(EMPTY);
}

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 1024, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  test.describe(`public trade pages follow the brand at ${viewport.width}px`, () => {
    test.use({ viewport });

    test('front page, trade list, a trade, a club and the method', async ({ page }) => {
      test.setTimeout(240_000);

      await page.goto('/afl/trades');
      const trade = await page
        .locator('main a[href^="/afl/trades/"]:not([href*="/clubs/"]):not([href$="/method"])')
        .first()
        .getAttribute('href');
      expect(trade, 'a trade link on the list').toBeTruthy();
      await page.goto(trade!);
      const club = await page
        .locator('main a[href^="/afl/trades/clubs/"]')
        .first()
        .getAttribute('href');
      expect(club, 'a club chains link on the trade page').toBeTruthy();

      for (const path of ['/', '/afl/trades', trade!, club!, '/afl/trades/method']) {
        await test.step(path, () => expectConformant(page, path));
      }
    });
  });
}
