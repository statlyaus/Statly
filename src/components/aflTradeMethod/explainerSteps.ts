import { DAWSON_TRADE, type DawsonSeason, type Pool } from './dawsonExample';
import { f0, f1, f2 } from './explainerFormat';

/*
 * The story of "How Statly values trades", one step per screen (owner, 2026-11-20). Copy is plain
 * words for footy fans and exact against hpnPavCore.ts and the value-line method
 * (docs/architecture/afl-trade-value-line-method.md). [n] marks a citation to REFERENCES.
 * Story facts are from HPN's introduction of PAV (hpnfooty.com/?p=21810, 31 Aug 2017).
 */

export type Stage = 'idea' | 'meet' | 'pot' | 'club' | 'player' | 'season' | 'trade';
export type StepId =
  | 'what'
  | 'why'
  | 'use'
  | 'meet'
  | 'pot'
  | 'season'
  | 'stint'
  | 'line'
  | 'expected'
  | 'picks'
  | 'final'
  | 'misses';

export type Step = {
  stage: Stage;
  id?: StepId;
  pool?: Pool;
  short: string;
  kicker: string;
  title: string | ((d: DawsonSeason) => string);
  copy: readonly string[] | ((d: DawsonSeason) => readonly string[]);
};

export const REFERENCES: readonly { n: number; text: string; href: string | null }[] = [
  {
    n: 1,
    text: 'HPN, "Introducing Player Approximate Value (PAV)", 31 August 2017. The method, its history, its testing and its limits. HPN invites others to use it, with credit.',
    href: 'https://www.hpnfooty.com/?p=21810',
  },
  {
    n: 2,
    text: 'AFL Tables, player and match statistics, 2016–2026. Points are goals × 6 + behinds; free kick difference is frees for minus frees against.',
    href: 'https://afltables.com/afl/afl_index.html',
  },
  {
    n: 3,
    text: 'Statly, Jordan Dawson trade (Sydney to Adelaide, 2021): value lines to the end of 2026.',
    href: null,
  },
  {
    n: 4,
    text: 'Footywire and the AFL: a second copy of the same player statistics, used only to confirm the AFL Tables numbers.',
    href: null,
  },
  {
    n: 5,
    text: 'Draftguru and the AFL: trades, draft selections and which club held each pick.',
    href: null,
  },
  { n: 6, text: 'Footyinfo: draft boards, including the picks spent to match a bid.', href: null },
  {
    n: 7,
    text: "Michael Lewis, Moneyball: The Art of Winning an Unfair Game (2003), on Bill James's influence on the Oakland A's.",
    href: null,
  },
];

const pick = DAWSON_TRADE.pickOutcome;

export const STEPS: readonly Step[] = [
  {
    stage: 'idea',
    id: 'what',
    short: 'What is PAV?',
    kicker: 'The idea',
    title: "PAV puts one number on a player's season",
    copy: [
      "PAV, short for Player Approximate Value, measures what a player's season was worth to his club.",
      'HPN, a group of independent footy analysts, built it in 2017 and named it after Fremantle great Matthew Pavlich.[1] The idea goes back to Bill James, the baseball writer whose stats thinking Moneyball made famous.[1][7]',
    ],
  },
  {
    stage: 'idea',
    id: 'why',
    short: 'Why it works',
    kicker: 'The idea',
    title: 'PAV rates the team first',
    copy: [
      'Stats count how often a player was involved. PAV asks how much that helped his team.',
      "It rates the club's attack, midfield and defence, then shares that value between the players by what each one did.[1]",
    ],
  },
  {
    stage: 'idea',
    id: 'use',
    short: 'Why we use it',
    kicker: 'The idea',
    title: 'We use it to measure what a trade delivered',
    copy: ['To judge a trade, we need one measure that works for every player in it.'],
  },
  {
    stage: 'meet',
    id: 'meet',
    short: 'Meet Jordan Dawson',
    kicker: 'Our example',
    title: 'Follow one real player: Jordan Dawson',
    copy: [
      `Sydney traded him to Adelaide in ${DAWSON_TRADE.tradeYear}, and he has played five seasons there since.[3] Pick a season at the top to follow.`,
    ],
  },
  {
    stage: 'pot',
    id: 'pot',
    short: 'The pot',
    kicker: 'The pot',
    title: 'Every season starts with the same pot of value',
    copy: (d) => [
      'Each season has a pot of value, split into attack, midfield and defence.',
      `Each part holds 100 PAV per club. In ${d.season}, ${d.clubs} clubs made ${f0(d.clubs * 100)} a part and ${f0(d.clubs * 300)} in all. The pot grows only when clubs join, so seasons from different years can be compared.[1]`,
    ],
  },
  {
    stage: 'club',
    pool: 'off',
    short: "Adelaide's attack",
    kicker: "Adelaide's share · Attack",
    title: 'Clubs that attack well get more of the attack value',
    copy: (d) => [
      `Each part is then shared between the ${d.clubs} clubs by how well each one did it.`,
      "For attack, we divide the club's points per inside 50 by the competition's. Matching the competition gives a rating of 1.00.[1]",
      `Its share is its rating out of all ${d.clubs} ratings added together. Those add up to about ${d.clubs}, so a rating of 1.00 earns close to 100.`,
    ],
  },
  {
    stage: 'club',
    pool: 'mid',
    short: "Adelaide's midfield",
    kicker: "Adelaide's share · Midfield",
    title: 'Clubs that win the ball forward get more of the midfield value',
    copy: [
      "For midfield, we divide the club's inside 50s by its opponents'. Getting the ball inside 50 more often than the opposition rates above 1.00, and the share is worked out as for attack.",
    ],
  },
  {
    stage: 'club',
    pool: 'def',
    short: "Adelaide's defence",
    kicker: "Adelaide's share · Defence",
    title: 'Clubs that stop scores get more of the defence value',
    copy: [
      'For defence, we compare the points opponents scored per inside 50 with the competition. Conceding less rates above 1.00.',
      "Add the three shares and you have the club's value for the season. The average club gets 300.",
    ],
  },
  {
    stage: 'player',
    pool: 'off',
    short: "Dawson's attack",
    kicker: "Dawson's share · Attack",
    title: "Players share their club's value by what they did",
    copy: [
      "Adelaide's value is then shared between its players, one part at a time.",
      "Each part has its own score sheet. Each stat is worth a set amount, and some count for more than others.[1][2][4] His share of the club's score is his share of the club's value.",
    ],
  },
  {
    stage: 'player',
    pool: 'mid',
    short: "Dawson's midfield",
    kicker: "Dawson's share · Midfield",
    title: 'Clearances and inside 50s count most in midfield',
    copy: ['A clearance adds 20 and an inside 50 adds 15, far more than any other midfield stat.'],
  },
  {
    stage: 'player',
    pool: 'def',
    short: "Dawson's defence",
    kicker: "Dawson's share · Defence",
    title: 'Rebound 50s and one-percenters count most in defence',
    copy: [
      'Marks inside 50 and hitouts take score away, so a player can finish below zero and get a negative share of the defence value.',
    ],
  },
  {
    stage: 'season',
    id: 'season',
    short: 'His season',
    kicker: 'His season',
    title: (d) => `His ${d.season} season in one number`,
    copy: (d) => [
      'Add his attack, midfield and defence value and you have his PAV for the season.',
      `Dawson played ${d.games} games.[2]`,
    ],
  },
  {
    stage: 'trade',
    id: 'stint',
    short: 'His time at Adelaide',
    kicker: 'The trade',
    title: 'A trade is judged on the seasons it delivered',
    copy: [
      'We add up his PAV for the club that traded for him, from the season after the trade until he leaves. A second stint after coming back does not count for the original trade.',
    ],
  },
  {
    stage: 'trade',
    id: 'line',
    short: 'The value line',
    kicker: 'The trade',
    title: "His trade isn't finished yet",
    copy: [
      'Dawson is still at Adelaide. His value line adds the PAV he has produced there to the PAV he is expected to add before he leaves.[3]',
      `The pick Adelaide gave up became ${pick.player} at ${pick.club}, and it has a value line too.`,
    ],
  },
  {
    stage: 'trade',
    id: 'expected',
    short: `The ${f1(DAWSON_TRADE.expected2026.total)} still to come`,
    kicker: 'The trade',
    title: 'How his expected PAV is worked out',
    copy: [
      "For each future season we multiply three things: the chance he's still at Adelaide, his expected games and his expected PAV a game.",
      `For 2027, a typical traded player at his career stage would expect ${f1(DAWSON_TRADE.expected2026.typical.games)} games at ${f2(DAWSON_TRADE.expected2026.typical.pavPerGame)} PAV a game. Dawson's own record adds about ${f1(DAWSON_TRADE.expected2026.hisEdge.games)} games and ${f2(DAWSON_TRADE.expected2026.hisEdge.pavPerGame)} PAV a game, and counts for more the longer he plays.`,
      'The chance he stays falls each year. Adding up every season gives the expected part of his value line.[3]',
    ],
  },
  {
    stage: 'trade',
    id: 'picks',
    short: 'Picks and bids',
    kicker: 'The trade',
    title: 'Picks follow the player they became',
    copy: [
      'An unused pick is worth what its draft slot has usually been worth. Once used, it is worth what the drafted player gives the club that took him, in his first stint there.[5]',
      'A pick spent matching an academy or father-son bid owns a share of that player.[6]',
    ],
  },
  {
    stage: 'trade',
    id: 'final',
    short: "What isn't final",
    kicker: 'The trade',
    title: "What isn't final yet",
    copy: [
      "Dawson's numbers will move every season he stays at Adelaide. A trade settles only once every player in it has left the club that got him.",
    ],
  },
  {
    stage: 'trade',
    id: 'misses',
    short: 'What PAV misses',
    kicker: 'The limits',
    title: "What PAV doesn't see",
    copy: ['HPN names the first three of these limits itself.[1]'],
  },
];

export const STAGES: readonly { stage: Stage; label: string }[] = [
  { stage: 'idea', label: 'The idea' },
  { stage: 'meet', label: 'Meet Dawson' },
  { stage: 'pot', label: 'The pot' },
  { stage: 'club', label: "Adelaide's share" },
  { stage: 'player', label: "Dawson's share" },
  { stage: 'season', label: 'His season' },
  { stage: 'trade', label: 'The trade' },
];
