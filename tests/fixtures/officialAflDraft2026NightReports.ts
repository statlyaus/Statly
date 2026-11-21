/**
 * Synthetic stand-ins for the two reviewed 2026 night reports (parser v21). They keep the real
 * pages' structure (one `article__byline-date` time, one `<meta name="description">`, an
 * `.article-body` of paragraphs between widgets) and the reviewed boundary sentences as read on
 * 2026-11-21; every other word is invented. The raw pages are not stored here: the repository is
 * public and the source rights allow no raw redistribution.
 */

export interface NightOneNumbers {
  first?: number;
  size?: number;
  last?: number;
  next?: number;
}

export interface NightTwoNumbers {
  first?: number;
  total?: number;
  last?: number;
}

const page = (input: {
  stamp: string | null;
  descriptions: readonly string[];
  paragraphs: readonly string[];
}) =>
  `<html><head>${input.descriptions
    .map((text) => `<meta name="description" content="${text}"/>`)
    .join(
      ''
    )}<meta property="og:description" content="${input.descriptions[0] ?? ''}"/></head><body>${
    input.stamp === null
      ? ''
      : `<div class="article__byline-date"><time class="js-datetime" datetime="${input.stamp}"></time></div>`
  }<div class="article-body"><figure>A synthetic picture caption.</figure>${input.paragraphs
    .map((text) => `<p>${text}</p>`)
    .join('<div class="articleWidget">A synthetic video.</div>')}</div></body></html>`;

export const nightOneParagraphs = (numbers: NightOneNumbers = {}) => [
  `SYNTHETIC Club has crowned a synthetic player as its first ever No.${numbers.first ?? 1} pick in the 2026 Telstra AFL Draft on Thursday night, matching a synthetic bid.`,
  `In an exciting opening round that included a flurry of pick trades, four academy and father-son bids and ${numbers.size ?? 19} overall selections, a synthetic club launched a raid.`,
  'A synthetic paragraph about a synthetic player at pick No.7.',
  `Synthetic Club bookended the draft and had the final selection, using No.${numbers.last ?? 19} to select a synthetic defender, with the club also holding pick No.${numbers.next ?? 20}, which will be the first selection of the second night of the draft on Friday.`,
];

export const nightTwoParagraphs = (numbers: NightTwoNumbers = {}) => [
  'SYNTHETIC Club completed a synthetic draft crop on Friday after a synthetic exit, welcoming a synthetic forward among four new players on night two of the Telstra AFL Draft.',
  `Synthetic Club was the biggest player in a draft that saw ${numbers.total ?? 65} total selections, with synthetic players earning a chance.`,
  'A synthetic paragraph about a synthetic player at pick No.21.',
  `Synthetic Club then used pick No.${numbers.last ?? 65} as the final selection to add a synthetic midfielder.`,
];

export const nightTwoDescription = (first = 20) =>
  `Synthetic Club has drafted a synthetic forward at pick No.${first}, the opening selection on night two`;

export const NIGHT_ONE_STAMP = '2026-11-19T08:33:00Z';
export const NIGHT_TWO_STAMP = '2026-11-20T08:52:00Z';

export const nightOnePage = (
  input: { stamp?: string | null; paragraphs?: readonly string[] } = {}
) =>
  page({
    stamp: input.stamp === undefined ? NIGHT_ONE_STAMP : input.stamp,
    descriptions: ['A synthetic player has been taken at pick No.1 in the 2026 Telstra AFL Draft'],
    paragraphs: input.paragraphs ?? nightOneParagraphs(),
  });

export const nightTwoPage = (
  input: {
    stamp?: string | null;
    descriptions?: readonly string[];
    paragraphs?: readonly string[];
  } = {}
) =>
  page({
    stamp: input.stamp === undefined ? NIGHT_TWO_STAMP : input.stamp,
    descriptions: input.descriptions ?? [nightTwoDescription()],
    paragraphs: input.paragraphs ?? nightTwoParagraphs(),
  });
