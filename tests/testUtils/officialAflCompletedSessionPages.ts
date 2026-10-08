/**
 * Synthetic pages with the exact structure of the reviewed 2019-2021 Official AFL completed-session
 * articles, so local capture tests can stub afl.com.au without live network access. The 2020 and
 * 2021 pages use the live `article__byline-date` wrapper; 2019 keeps `article__date`, the only
 * wrapper its dedicated parser reads.
 */
const clubs2019: Array<[string, number[]]> = [
  ['ADELAIDE', [6, 24, 28, 42, 48]],
  ['BRISBANE', [22, 33, 37, 59]],
  ['CARLTON', [17, 20, 47]],
  ['COLLINGWOOD', [40, 45, 55]],
  ['ESSENDON', [30, 38, 56, 63]],
  ['FREMANTLE', [7, 8, 9, 61]],
  ['GEELONG', [16, 19, 41, 50]],
  ['GOLD COAST', [1, 2, 11, 27, 60]],
  ['GREATER WESTERN SYDNEY', [4, 10, 51, 65]],
  ['HAWTHORN', [13, 29, 57]],
  ['MELBOURNE', [3, 12, 32]],
  ['NORTH MELBOURNE', [31, 34, 35]],
  ['PORT ADELAIDE', [14, 18, 23, 25]],
  ['RICHMOND', [21, 43, 44, 46, 54]],
  ['ST KILDA', [52, 64]],
  ['SYDNEY', [5, 26, 36, 39]],
  ['WEST COAST', [49, 58]],
  ['WESTERN BULLDOGS', [15, 53, 62]],
];
const names2019: Record<number, string> = {
  21: 'Thomson Dow',
  22: 'Deven Robertson',
  15: 'Cody Weightman',
};
const narratives2019: Record<string, string[]> = {
  RICHMOND: [
    "Verdict: The Tigers secured that with Dow to end the draft's first round. From there, it turned into a bidding fest on the second night.",
  ],
  BRISBANE: [
    "What the club says: (Deven Robertson's) selection was that first selection on the second night.",
    'Verdict: The Lions waited overnight to enter the draft on the second night and grab Larke Medal winner Robertson.',
  ],
  'ST KILDA': ['Verdict: After waiting, the Saints got into the action on Thursday night.'],
  'WESTERN BULLDOGS': ['What the club says: We were pleased getting Cody Weightman last night.'],
};

function page2019(): string {
  const section = ([club, numbers]: [string, number[]]) =>
    `<h6>${club}</h6><p>Who they picked: ${numbers.map((number) => `${number}. ${names2019[number] ?? 'Synthetic Player'}${[51, 65].includes(number) ? '' : ' (Feeder Club)'}`).join(', ')}</p>${(narratives2019[club] ?? []).map((text) => `<p>${text}</p>`).join('')}`;
  return `<div class="article__date"><time datetime="2019-11-28T12:22:00Z"></time></div><div class="article-body">${clubs2019.map(section).join('')}</div>`;
}

function page2020(): string {
  const selection = (n: number) =>
    `<p><strong>${n}${n === 28 ? ':' : '.'} Synthetic Club: ${n === 19 ? 'Finlay</strong><strong>Macrae' : [21, 22, 27].includes(n) ? '</strong><strong>Synthetic Player' : 'Synthetic Player'}${n === 44 ? '<br>' : ''}</strong><br>DOB: unknown<br>Predicted draft range: 1–3</p>`;
  return `<div class="article__byline-date"><time datetime="2020-12-09T12:30:00Z"></time></div><div class="article-body"><p>JAMARRA Ugle-Hagan is the No.1 selection in the 2020 NAB AFL Draft.</p><p>Take a look at every pick in a draft full of twists and turns, trades and loads of Academy bids.</p>${Array.from({ length: 59 }, (_, i) => selection(i + 1)).join('')}</div>`;
}

const rows = (first: number, last: number) =>
  `<p>${Array.from({ length: last - first + 1 }, (_, i) => `${first + i}. Synthetic player (Synthetic club)`).join('<br>')}</p>`;

function page2021(night: 1 | 2): string {
  return night === 1
    ? `<div class="article__byline-date"><time datetime="2021-11-24T10:36:00Z"></time></div><div class="article-body"><p>The No.1 pick in Wednesday night's NAB AFL Draft. With the final selection of the first round, No.20, Brisbane added Kai Lohmann.</p><h4>2021 NAB AFL Draft - First Round</h4>${rows(1, 20)}</div>`
    : `<div class="article__byline-date"><time datetime="2021-11-25T11:45:00Z"></time></div><div class="article-body"><p>NIGHT two of the NAB AFL Draft started with Fremantle snapping up West Australian slider Matthew Johnson and ended with Taj Woewodin becoming a Melbourne father-son selection. There were surprises as 65 players found their way on to AFL lists.</p><p><strong>NAB AFL DRAFT NIGHT TWO</strong></p>${rows(21, 65)}</div>`;
}

export const OFFICIAL_AFL_COMPLETED_SESSION_PAGES: Readonly<Record<string, () => string>> = {
  'https://www.afl.com.au/news/149305/who-smashed-it-our-say-on-your-clubs-draft-performance':
    page2019,
  'https://www.afl.com.au/news/528411/every-pick-every-player-check-out-who-your-club-drafted':
    page2020,
  'https://www.afl.com.au/news/688959/the-horne-supremacy-north-melbourne-makes-jason-horne-francis-its-no1-pick-for-the-2021-nab-afl-draft':
    () => page2021(1),
  'https://www.afl.com.au/news/689491/matt-johnson-wa-product-lands-at-fremantle-after-nervous-wait':
    () => page2021(2),
};
