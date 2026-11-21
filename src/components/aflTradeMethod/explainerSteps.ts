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
    text: 'HPN, "Introducing Player Approximate Value (PAV)", 31 August 2017. The method, its history, its testing and its limits.',
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
      "PAV stands for Player Approximate Value. It answers an old footy question: what was a player's season really worth to his club?",
      'It was created in 2017 by HPN, a group of independent footy analysts, and named after Fremantle great Matthew Pavlich.[1]',
      "If you've seen Moneyball, you know the idea. Baseball writer Bill James, whose stats thinking Moneyball made famous, came up with approximate value in 1982.[1][7] Pro-Football-Reference adapted it for the NFL in 2008, and HPN rebuilt it for the AFL.[1]",
    ],
  },
  {
    stage: 'idea',
    id: 'why',
    short: 'Why it works',
    kicker: 'The idea',
    title: 'It starts with the team, not the stat sheet',
    copy: [
      "Raw stats show how often a player was involved. They don't show how much that helped his team.",
      'PAV measures the club first: how well it attacked, won the ball forward and defended. Then it shares that value between the players by what each one did.',
      "HPN checked the results against Brownlow votes, All-Australian teams, club best and fairests and Champion Data's player ratings. PAV largely agreed with them.[1]",
    ],
  },
  {
    stage: 'idea',
    id: 'use',
    short: 'Why we use it',
    kicker: 'The idea',
    title: 'We use it to measure what a trade delivered',
    copy: [
      'A trade swaps players and picks. To judge one, we need a single measure that works for any player, in any position, in any year.',
      'PAV is built from public stats with a published formula, so anyone can check our numbers. HPN invites others to use it, with credit.[1]',
      'The best way to see how it works is to follow one real player through it.',
    ],
  },
  {
    stage: 'meet',
    id: 'meet',
    short: 'Meet Jordan Dawson',
    kicker: 'Our example',
    title: 'Follow one real player: Jordan Dawson',
    copy: [
      `In the ${DAWSON_TRADE.tradeYear} trade period, Sydney traded Jordan Dawson to Adelaide for ${DAWSON_TRADE.pickLabel}.[3]`,
      'He has played five seasons for Adelaide since. Every number from here on is his.',
      'Pick a season at the top to follow. In 2022 he had 150 rebound 50s and 15 clearances. In 2023 he had 52 rebound 50s and 88 clearances.[2]',
    ],
  },
  {
    stage: 'pot',
    id: 'pot',
    short: 'The pot',
    kicker: 'The pot',
    title: 'Every season starts with the same pot of value',
    copy: (d) => [
      'Here is how the number is built. It starts with the whole competition: each season has a pot of value, split into attack, midfield and defence.',
      `Each part holds 100 PAV for every club. In ${d.season} there were ${d.clubs} clubs, so each part held ${f0(d.clubs * 100)} PAV and the pot ${f0(d.clubs * 300)}.`,
      'The pot only changes when clubs join, so seasons from different years can be compared.[1]',
    ],
  },
  {
    stage: 'club',
    pool: 'off',
    short: "Adelaide's attack",
    kicker: "Adelaide's share · Attack",
    title: 'Clubs that attack well get more of the attack value',
    copy: (d) => [
      `Next, each part is shared between the ${d.clubs} clubs. Clubs that did that part better get a bigger share.`,
      'For attack, we ask how many points the club scored each time it went inside 50, compared with the whole competition. Matching the competition is a rating of 1.00. Better is above, worse is below.[1]',
      `The club's share is its rating out of all ${d.clubs} ratings added together. The ratings add up to about ${d.clubs}, so a club rated 1.00 gets close to 100.`,
    ],
  },
  {
    stage: 'club',
    pool: 'mid',
    short: "Adelaide's midfield",
    kicker: "Adelaide's share · Midfield",
    title: 'Clubs that win the ball forward get more of the midfield value',
    copy: [
      'For midfield, we ask whether the club got the ball inside 50 more often than its opponents.',
      "Its inside 50s divided by its opponents' inside 50s gives the rating. More entries than the opposition means a rating above 1.00.",
      'Its share of the midfield value is worked out the same way as attack.',
    ],
  },
  {
    stage: 'club',
    pool: 'def',
    short: "Adelaide's defence",
    kicker: "Adelaide's share · Defence",
    title: 'Clubs that stop scores get more of the defence value',
    copy: [
      'For defence, we ask how many points opponents scored each time they went inside 50, compared with the whole competition.',
      'Conceding less per entry than the competition rates above 1.00; conceding more rates below. The exact sum is on the right.',
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
      "Now Adelaide's value is shared between its players, one part at a time.",
      'Each part has a score sheet. Every stat a player records adds to his score, and some stats are worth more than others. On the right is his attack sheet.[1][2]',
      "His share of the club's attack score is his share of the club's attack value.",
    ],
  },
  {
    stage: 'player',
    pool: 'mid',
    short: "Dawson's midfield",
    kicker: "Dawson's share · Midfield",
    title: 'Clearances and inside 50s count most in midfield',
    copy: [
      'Two stats are worth far more than the rest here. A clearance adds 20 and an inside 50 adds 15.',
      "Same rule as attack: his share of the club's midfield score is his share of the club's midfield value.",
    ],
  },
  {
    stage: 'player',
    pool: 'def',
    short: "Dawson's defence",
    kicker: "Dawson's share · Defence",
    title: 'Rebound 50s and one-percenters count most in defence',
    copy: [
      'Two stats take score away: marks inside 50 and hitouts. A player whose defence score falls below zero gets a negative share of the defence value.',
      'Same rule again: his share of the score is his share of the value.',
    ],
  },
  {
    stage: 'season',
    id: 'season',
    short: 'His season',
    kicker: 'His season',
    title: (d) => `His ${d.season} season in one number`,
    copy: (d) => [
      "Add his attack, midfield and defence value together. That's his PAV for the season.",
      `To see where it sits, compare it with every player who played 10 or more games in ${d.season}: ${f0(d.rank.of)} of them. Dawson played ${d.games}.[2]`,
    ],
  },
  {
    stage: 'trade',
    id: 'stint',
    short: 'His time at Adelaide',
    kicker: 'The trade',
    title: 'A trade is judged on the seasons it delivered',
    copy: [
      'When a club trades for a player, we add up his PAV for that club in every season from the one after the trade until he leaves.',
      "If he later comes back to the same club, that second stint doesn't count for the original trade.",
    ],
  },
  {
    stage: 'trade',
    id: 'line',
    short: 'The value line',
    kicker: 'The trade',
    title: "His trade isn't finished yet",
    copy: [
      'Dawson is still at Adelaide, so the trade page shows a value line: the PAV he has produced there so far, plus the PAV he is expected to add before he leaves.[3]',
      'The expected part starts from what traded players at the same career stage usually produce. Each season his own games and PAV per game move it up or down, and it allows for the chance he leaves. The longer he plays, the more his own record counts.',
      `The pick Adelaide gave up works the same way. Before the draft it was valued at its expected slot. It ended up with ${pick.club}, who used it at pick ${pick.selection} on ${pick.player}, so its value now follows his time there.`,
    ],
  },
  {
    stage: 'trade',
    id: 'expected',
    short: 'The 67.0 still to come',
    kicker: 'The trade',
    title: 'How his expected PAV is worked out',
    copy: [
      "For each future season we multiply three things: the chance he's still playing for Adelaide, the games he's expected to play, and the PAV he's expected to earn a game.",
      `For 2027, a typical traded player at his career stage would expect ${f1(DAWSON_TRADE.expected2026.typical.games)} games at ${f2(DAWSON_TRADE.expected2026.typical.pavPerGame)} PAV a game. Dawson's own record adds about ${f1(DAWSON_TRADE.expected2026.hisEdge.games)} games and ${f2(DAWSON_TRADE.expected2026.hisEdge.pavPerGame)} PAV a game.`,
      "The chance he's still there falls each year as players retire or move on. Add up every season and you get the expected part of his value line.[3]",
    ],
  },
  {
    stage: 'trade',
    id: 'picks',
    short: 'Picks, bids and chains',
    kicker: 'The trade',
    title: 'Picks follow the player they became',
    copy: [
      "A pick that hasn't been used yet is valued at what its draft position has usually been worth.",
      `Once it's used, it's worth what the drafted player gives the club that took him, during his first stint there. Adelaide's pick ended up with ${pick.club}, who took ${pick.player} with it.[3][5]`,
      'A pick spent matching a bid for an academy or father-son player takes a share of that player, by the draft points it covered.[6]',
      'Every trade balances: what one club gains, the others give up. When a pick is traded on, the trades are linked in a chain.',
    ],
  },
  {
    stage: 'trade',
    id: 'final',
    short: "What isn't final",
    kicker: 'The trade',
    title: "What isn't final yet",
    copy: [
      "Dawson's numbers will move every season he stays at Adelaide. A trade only settles once every player in it has left the club that got him.",
      'The expected part is an estimate from how similar stints have gone. It is not a prediction about any one player.',
    ],
  },
  {
    stage: 'trade',
    id: 'misses',
    short: 'What PAV misses',
    kicker: 'Fair warning',
    title: "What PAV doesn't see",
    copy: [
      "PAV is approximate, and HPN says so. It is a strong guide over a season, but it isn't the last word.[1]",
    ],
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
